from __future__ import annotations

import logging
import os
import uuid
from datetime import timezone

from rq import Worker, get_current_job
from sqlalchemy import delete, select

from rag.chunking import chunk_sections
from rag.clients import EmbeddingClient
from rag.config import get_settings
from rag.db import SessionLocal
from rag.extractors import extract_text
from rag.models import Chunk, Document, Job, utcnow
from rag.qdrant_store import QdrantStore
from rag.queue import ingest_queue, redis_connection
from rag.storage import get_object

logger = logging.getLogger("rag-worker")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")


def ingest_document(document_id: str) -> None:
    settings = get_settings()
    current = get_current_job()
    job_id = uuid.UUID(current.id) if current else None

    with SessionLocal() as db:
        document = db.get(Document, uuid.UUID(document_id))
        if document is None:
            raise ValueError(f"document {document_id} not found")
        job = db.get(Job, job_id) if job_id else None
        if job:
            job.status = "running"
            job.started_at = utcnow()
            job.attempts += 1
        document.status = "processing"
        document.error = None
        db.commit()

    try:
        with SessionLocal() as db:
            document = db.get(Document, uuid.UUID(document_id))
            if document is None:
                raise ValueError(f"document {document_id} not found")

            raw = get_object(document.object_key)
            sections = extract_text(document.filename, document.content_type, raw)
            if not sections:
                raise ValueError("no extractable text found")

            chunks = chunk_sections(sections, settings.rag_chunk_tokens, settings.rag_chunk_overlap_tokens)
            if not chunks:
                raise ValueError("no chunks created from extracted text")

            logger.info("embedding document=%s chunks=%s", document_id, len(chunks))
            vectors = EmbeddingClient().embed([chunk.text for chunk in chunks])
            if len(vectors) != len(chunks):
                raise ValueError("embedding service returned an unexpected number of vectors")

            store = QdrantStore()
            store.ensure_collection(len(vectors[0]))
            store.delete_document(document.tenant_id, str(document.id))

            db.execute(delete(Chunk).where(Chunk.document_id == document.id))
            db.flush()

            points = []
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True)):
                chunk_id = uuid.uuid4()
                metadata = {
                    **chunk.metadata,
                    "filename": document.filename,
                    "source_sha256": document.sha256,
                    "document_metadata": document.metadata_json,
                }
                db.add(
                    Chunk(
                        id=chunk_id,
                        document_id=document.id,
                        tenant_id=document.tenant_id,
                        chunk_index=index,
                        text=chunk.text,
                        token_count=chunk.token_count,
                        vector_id=str(chunk_id),
                        metadata_json=metadata,
                    )
                )
                payload = {
                    "tenant_id": document.tenant_id,
                    "document_id": str(document.id),
                    "chunk_id": str(chunk_id),
                    "chunk_index": index,
                    "filename": document.filename,
                    "page": chunk.metadata.get("page"),
                    "slide": chunk.metadata.get("slide"),
                    "sheet": chunk.metadata.get("sheet"),
                    "metadata": document.metadata_json,
                    "chunk_metadata": chunk.metadata,
                    "text": chunk.text,
                }
                points.append({"id": str(chunk_id), "vector": vector, "payload": payload})

            store.upsert(points)

            document.status = "ready"
            document.chunk_count = len(chunks)
            document.updated_at = utcnow()
            if job_id:
                job = db.get(Job, job_id)
                if job:
                    job.status = "succeeded"
                    job.finished_at = utcnow()
                    job.updated_at = utcnow()
            db.commit()
            logger.info("ingested document=%s chunks=%s", document_id, len(chunks))
    except Exception as exc:
        logger.exception("ingestion failed document=%s", document_id)
        with SessionLocal() as db:
            document = db.get(Document, uuid.UUID(document_id))
            if document:
                document.status = "failed"
                document.error = str(exc)
                document.updated_at = utcnow()
            if job_id:
                job = db.get(Job, job_id)
                if job:
                    job.status = "failed"
                    job.error = str(exc)
                    job.finished_at = utcnow().astimezone(timezone.utc)
                    job.updated_at = utcnow()
            db.commit()
        raise


def main() -> None:
    queue = ingest_queue()
    worker = Worker([queue], connection=redis_connection())
    worker.work(with_scheduler=False)


if __name__ == "__main__":
    main()
