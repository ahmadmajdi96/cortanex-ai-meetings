from __future__ import annotations

import hashlib
import json
import logging
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
from fastapi import APIRouter, Depends, FastAPI, File, Form, HTTPException, Query, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import ORJSONResponse, Response
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from rag.clients import EmbeddingClient, LLMClient, RerankerClient
from rag.config import get_settings
from rag.db import get_db
from rag.extractors import supported_file
from rag.models import Document, Job, QueryLog, utcnow
from rag.prompts import build_messages, looks_arabic
from rag.qdrant_store import QdrantStore
from rag.queue import ingest_queue, redis_connection
from rag.schemas import DocumentOut, JobOut, QueryRequest, QueryResponse, SourceOut, UploadResponse
from rag.security import require_api_key
from rag.storage import delete_object, ensure_bucket, put_object, s3_client
from rag.worker import ingest_document

logger = logging.getLogger("rag-api")
logging.basicConfig(level="INFO", format="%(asctime)s %(levelname)s %(name)s %(message)s")

HTTP_REQUESTS = Counter("rag_http_requests_total", "HTTP requests", ["method", "path", "status"])
HTTP_LATENCY = Histogram("rag_http_request_seconds", "HTTP request latency", ["method", "path"])
QUERY_LATENCY = Histogram("rag_query_seconds", "End-to-end query latency")
INGEST_ENQUEUED = Counter("rag_ingest_jobs_enqueued_total", "Ingestion jobs enqueued")


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_bucket()
    yield


settings = get_settings()
app = FastAPI(
    title="Mohkam Production RAG API",
    version="0.1.0",
    default_response_class=ORJSONResponse,
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.rag_allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def metrics_middleware(request, call_next):
    start = time.perf_counter()
    status_code = 500
    try:
        response = await call_next(request)
        status_code = response.status_code
        return response
    finally:
        path = request.scope.get("route").path if request.scope.get("route") else request.url.path
        HTTP_REQUESTS.labels(request.method, path, str(status_code)).inc()
        HTTP_LATENCY.labels(request.method, path).observe(time.perf_counter() - start)


router = APIRouter(prefix="/v1", dependencies=[Depends(require_api_key)])


@app.get("/healthz")
def healthz() -> dict[str, bool]:
    return {"ok": True}


@app.get("/readyz")
def readyz(db: Session = Depends(get_db)) -> dict[str, Any]:
    checks: dict[str, Any] = {}
    try:
        db.execute(text("select 1"))
        checks["postgres"] = True
    except Exception as exc:
        checks["postgres"] = str(exc)

    try:
        redis_connection().ping()
        checks["redis"] = True
    except Exception as exc:
        checks["redis"] = str(exc)

    try:
        s3_client().head_bucket(Bucket=settings.minio_bucket)
        checks["minio"] = True
    except Exception as exc:
        checks["minio"] = str(exc)

    try:
        headers = {"api-key": settings.qdrant_api_key} if settings.qdrant_api_key else {}
        response = httpx.get(f"{settings.qdrant_url.rstrip('/')}/readyz", headers=headers, timeout=5)
        checks["qdrant"] = response.status_code == 200
    except Exception as exc:
        checks["qdrant"] = str(exc)

    ok = all(value is True for value in checks.values())
    return {"ok": ok, "checks": checks}


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@router.post("/documents", response_model=UploadResponse, status_code=status.HTTP_202_ACCEPTED)
def upload_documents(
    files: list[UploadFile] = File(...),
    tenant_id: str | None = Form(default=None),
    metadata: str | None = Form(default=None),
    db: Session = Depends(get_db),
) -> UploadResponse:
    tenant = _tenant(tenant_id)
    metadata_json = _parse_metadata(metadata)
    documents: list[Document] = []
    jobs: list[Job] = []

    for upload in files:
        filename = _sanitize_filename(upload.filename)
        if not supported_file(filename):
            raise HTTPException(status_code=415, detail=f"unsupported file type: {filename}")
        content = upload.file.read(settings.max_upload_bytes + 1)
        if len(content) > settings.max_upload_bytes:
            raise HTTPException(status_code=413, detail=f"{filename} exceeds {settings.rag_max_upload_mb} MB")
        if not content:
            raise HTTPException(status_code=422, detail=f"{filename} is empty")

        document_id = uuid.uuid4()
        object_key = f"{tenant}/{document_id}/{filename}"
        digest = hashlib.sha256(content).hexdigest()
        put_object(object_key, content, upload.content_type)

        document = Document(
            id=document_id,
            tenant_id=tenant,
            filename=filename,
            content_type=upload.content_type,
            object_key=object_key,
            sha256=digest,
            size_bytes=len(content),
            status="queued",
            metadata_json=metadata_json,
            chunk_count=0,
        )
        job_id = uuid.uuid4()
        job = Job(
            id=job_id,
            tenant_id=tenant,
            kind="ingest_document",
            status="queued",
            payload={"document_id": str(document_id), "filename": filename},
        )
        document.latest_job_id = job_id
        db.add(document)
        db.add(job)
        documents.append(document)
        jobs.append(job)

    db.commit()

    queue = ingest_queue()
    for document, job in zip(documents, jobs, strict=True):
        queue.enqueue(ingest_document, str(document.id), job_id=str(job.id))
        INGEST_ENQUEUED.inc()

    return UploadResponse(
        documents=[_document_out(document) for document in documents],
        jobs=[_job_out(job) for job in jobs],
    )


@router.get("/documents", response_model=list[DocumentOut])
def list_documents(
    tenant_id: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> list[DocumentOut]:
    tenant = _tenant(tenant_id)
    stmt = select(Document).where(Document.tenant_id == tenant).order_by(Document.created_at.desc()).limit(limit).offset(offset)
    if status_filter:
        stmt = stmt.where(Document.status == status_filter)
    return [_document_out(document) for document in db.scalars(stmt).all()]


@router.get("/documents/{document_id}", response_model=DocumentOut)
def get_document(document_id: uuid.UUID, tenant_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> DocumentOut:
    document = _get_document(db, document_id, _tenant(tenant_id))
    return _document_out(document)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(document_id: uuid.UUID, tenant_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> Response:
    tenant = _tenant(tenant_id)
    document = _get_document(db, document_id, tenant)
    QdrantStore().delete_document(tenant, str(document.id))
    delete_object(document.object_key)
    db.delete(document)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/jobs/{job_id}", response_model=JobOut)
def get_job(job_id: uuid.UUID, tenant_id: str | None = Query(default=None), db: Session = Depends(get_db)) -> JobOut:
    tenant = _tenant(tenant_id)
    job = db.get(Job, job_id)
    if job is None or job.tenant_id != tenant:
        raise HTTPException(status_code=404, detail="job not found")
    return _job_out(job)


@router.post("/query", response_model=QueryResponse)
async def query_documents(payload: QueryRequest, db: Session = Depends(get_db)) -> QueryResponse:
    start = time.perf_counter()
    tenant = _tenant(payload.tenant_id)
    top_k = payload.top_k or settings.rag_top_k
    rerank_top_n = payload.rerank_top_n or settings.rag_rerank_top_n
    score_threshold = settings.rag_score_threshold if payload.score_threshold is None else payload.score_threshold

    query_vector = (await EmbeddingClient().aembed([payload.question]))[0]
    hits = await QdrantStore().asearch(
        tenant_id=tenant,
        vector=query_vector,
        limit=top_k,
        score_threshold=score_threshold,
        filters=payload.filters,
    )

    if not hits:
        answer = _no_context_answer(payload.question)
        latency_ms = int((time.perf_counter() - start) * 1000)
        db.add(QueryLog(tenant_id=tenant, question=payload.question, answer=answer, sources=[], latency_ms=latency_ms))
        db.commit()
        return QueryResponse(answer=answer, tenant_id=tenant, model=settings.llm_model, sources=[], latency_ms=latency_ms)

    candidates = [_source_from_hit(index, hit) for index, hit in enumerate(hits, start=1)]
    if payload.use_reranker and candidates:
        reranked = await RerankerClient().arerank(
            payload.question,
            [source.excerpt for source in candidates],
            top_n=min(rerank_top_n, len(candidates)),
        )
        selected: list[SourceOut] = []
        for item in reranked:
            source = candidates[item["index"]]
            source.rerank_score = float(item["score"])
            selected.append(source)
    else:
        selected = candidates[:rerank_top_n]

    for source_id, source in enumerate(selected, start=1):
        source.source_id = f"S{source_id}"

    messages = build_messages(payload.question, selected)
    answer = await LLMClient().achat(messages, temperature=payload.temperature, max_tokens=payload.max_tokens)
    latency_ms = int((time.perf_counter() - start) * 1000)
    QUERY_LATENCY.observe(time.perf_counter() - start)

    source_payload = [source.model_dump(mode="json") for source in selected]
    db.add(QueryLog(tenant_id=tenant, question=payload.question, answer=answer, sources=source_payload, latency_ms=latency_ms))
    db.commit()

    return QueryResponse(answer=answer, tenant_id=tenant, model=settings.llm_model, sources=selected, latency_ms=latency_ms)


app.include_router(router)


def _tenant(value: str | None) -> str:
    tenant = (value or settings.rag_default_tenant).strip()
    if not tenant:
        raise HTTPException(status_code=422, detail="tenant_id cannot be empty")
    return tenant


def _parse_metadata(raw: str | None) -> dict[str, Any]:
    if not raw:
        return {}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=422, detail="metadata must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=422, detail="metadata must be a JSON object")
    return parsed


def _sanitize_filename(filename: str | None) -> str:
    clean = Path(filename or "document").name.replace("\x00", "").strip()
    if not clean:
        clean = "document"
    return clean[:512]


def _get_document(db: Session, document_id: uuid.UUID, tenant_id: str) -> Document:
    document = db.get(Document, document_id)
    if document is None or document.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="document not found")
    return document


def _document_out(document: Document) -> DocumentOut:
    return DocumentOut(
        id=document.id,
        tenant_id=document.tenant_id,
        filename=document.filename,
        content_type=document.content_type,
        sha256=document.sha256,
        size_bytes=document.size_bytes,
        status=document.status,
        error=document.error,
        chunk_count=document.chunk_count,
        latest_job_id=document.latest_job_id,
        metadata=document.metadata_json or {},
        created_at=document.created_at,
        updated_at=document.updated_at,
    )


def _job_out(job: Job) -> JobOut:
    return JobOut(
        id=job.id,
        tenant_id=job.tenant_id,
        kind=job.kind,
        status=job.status,
        payload=job.payload or {},
        attempts=job.attempts,
        error=job.error,
        created_at=job.created_at,
        updated_at=job.updated_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


def _source_from_hit(index: int, hit) -> SourceOut:
    payload = hit.payload
    text_value = payload.get("text") or ""
    return SourceOut(
        source_id=f"C{index}",
        document_id=uuid.UUID(payload["document_id"]),
        chunk_id=uuid.UUID(payload["chunk_id"]),
        filename=payload.get("filename") or "unknown",
        page=payload.get("page"),
        chunk_index=int(payload.get("chunk_index") or 0),
        score=hit.score,
        metadata=payload.get("metadata") or {},
        excerpt=_trim(text_value, 2600),
    )


def _trim(text_value: str, limit: int) -> str:
    text_value = " ".join(text_value.split())
    if len(text_value) <= limit:
        return text_value
    return text_value[: limit - 1].rstrip() + "..."


def _no_context_answer(question: str) -> str:
    if looks_arabic(question):
        return "لا تحتوي المستندات المفهرسة على معلومات كافية للإجابة عن هذا السؤال."
    return "The indexed documents do not contain enough information to answer this question."
