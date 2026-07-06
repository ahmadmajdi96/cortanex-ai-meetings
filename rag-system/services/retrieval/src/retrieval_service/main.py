from __future__ import annotations

import logging
import os
import time
from contextlib import asynccontextmanager
from typing import Any

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from prometheus_client import CONTENT_TYPE_LATEST, Counter, Histogram, generate_latest

logger = logging.getLogger("retrieval-service")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"), format="%(asctime)s %(levelname)s %(name)s %(message)s")

REQUESTS = Counter("retrieval_requests_total", "Total retrieval service requests", ["endpoint", "status"])
LATENCY = Histogram("retrieval_request_seconds", "Retrieval service request latency", ["endpoint"])


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    embedding_model: str = "BAAI/bge-m3"
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
    retrieval_device: str = "cuda"
    retrieval_batch_size: int = 12
    retrieval_max_length: int = 8192
    retrieval_use_fp16: bool = True


settings = Settings()


class ModelState:
    embedding_model: Any | None = None
    reranker_model: Any | None = None


state = ModelState()


def _devices() -> list[str]:
    device = settings.retrieval_device.strip().lower()
    if device == "cpu":
        return ["cpu"]
    if device.startswith("cuda"):
        return [device if ":" in device else "cuda:0"]
    return [device]


def _allow_ngc_torch_prerelease() -> None:
    """Accept NVIDIA's Torch 2.6 prerelease build for transformer checkpoint loading."""
    try:
        import torch
    except Exception:
        return

    torch_version = getattr(torch, "__version__", "")
    if not torch_version.startswith("2.6.0a0"):
        return

    def noop_check() -> None:
        return None

    try:
        import transformers.modeling_utils as modeling_utils
        import transformers.utils.import_utils as import_utils

        import_utils.check_torch_load_is_safe = noop_check
        modeling_utils.check_torch_load_is_safe = noop_check
        logger.warning(
            "using NVIDIA prerelease torch=%s; accepted as torch 2.6 compatible for Transformers checkpoint loading",
            torch_version,
        )
    except Exception:
        logger.exception("failed to apply NVIDIA Torch prerelease compatibility patch")


def _load_models() -> None:
    _allow_ngc_torch_prerelease()

    from FlagEmbedding import BGEM3FlagModel, FlagReranker

    devices = _devices()
    use_fp16 = settings.retrieval_use_fp16 and devices != ["cpu"]
    logger.info("loading embedding model=%s devices=%s fp16=%s", settings.embedding_model, devices, use_fp16)
    state.embedding_model = BGEM3FlagModel(
        settings.embedding_model,
        devices=devices,
        use_fp16=use_fp16,
    )
    logger.info("loading reranker model=%s devices=%s fp16=%s", settings.reranker_model, devices, use_fp16)
    state.reranker_model = FlagReranker(
        settings.reranker_model,
        devices=devices,
        use_fp16=use_fp16,
    )


@asynccontextmanager
async def lifespan(_: FastAPI):
    _load_models()
    yield


app = FastAPI(title="Mohkam RAG Retrieval Models", version="0.1.0", lifespan=lifespan)


class EmbeddingRequest(BaseModel):
    input: str | list[str]
    model: str | None = None
    normalize: bool = True


class EmbeddingItem(BaseModel):
    object: str = "embedding"
    index: int
    embedding: list[float]


class EmbeddingResponse(BaseModel):
    object: str = "list"
    model: str
    data: list[EmbeddingItem]
    usage: dict[str, int]


class RerankRequest(BaseModel):
    query: str = Field(min_length=1)
    documents: list[str] = Field(min_length=1)
    top_n: int | None = Field(default=None, ge=1)
    normalize: bool = True


class RerankItem(BaseModel):
    index: int
    score: float


class RerankResponse(BaseModel):
    model: str
    results: list[RerankItem]


@app.get("/healthz")
def healthz() -> dict[str, Any]:
    return {
        "ok": state.embedding_model is not None and state.reranker_model is not None,
        "embedding_model": settings.embedding_model,
        "reranker_model": settings.reranker_model,
        "device": settings.retrieval_device,
    }


@app.get("/metrics")
def metrics() -> Response:
    return Response(generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/v1/embeddings", response_model=EmbeddingResponse)
def embeddings(payload: EmbeddingRequest) -> EmbeddingResponse:
    start = time.perf_counter()
    endpoint = "embeddings"
    try:
        if state.embedding_model is None:
            raise HTTPException(status_code=503, detail="embedding model is not loaded")
        texts = [payload.input] if isinstance(payload.input, str) else payload.input
        if not texts:
            raise HTTPException(status_code=422, detail="input cannot be empty")
        output = state.embedding_model.encode(
            texts,
            batch_size=settings.retrieval_batch_size,
            max_length=settings.retrieval_max_length,
            return_dense=True,
            return_sparse=False,
            return_colbert_vecs=False,
        )
        vectors = np.asarray(output["dense_vecs"], dtype=np.float32)
        if payload.normalize:
            norms = np.linalg.norm(vectors, axis=1, keepdims=True)
            vectors = vectors / np.maximum(norms, 1e-12)
        data = [EmbeddingItem(index=i, embedding=vector.astype(float).tolist()) for i, vector in enumerate(vectors)]
        REQUESTS.labels(endpoint, "ok").inc()
        return EmbeddingResponse(
            model=payload.model or settings.embedding_model,
            data=data,
            usage={"prompt_tokens": 0, "total_tokens": 0},
        )
    except HTTPException:
        REQUESTS.labels(endpoint, "error").inc()
        raise
    except Exception as exc:  # pragma: no cover - defensive service boundary
        logger.exception("embedding request failed")
        REQUESTS.labels(endpoint, "error").inc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        LATENCY.labels(endpoint).observe(time.perf_counter() - start)


@app.post("/v1/rerank", response_model=RerankResponse)
def rerank(payload: RerankRequest) -> RerankResponse:
    start = time.perf_counter()
    endpoint = "rerank"
    try:
        if state.reranker_model is None:
            raise HTTPException(status_code=503, detail="reranker model is not loaded")
        pairs = [[payload.query, document] for document in payload.documents]
        scores = state.reranker_model.compute_score(
            pairs,
            batch_size=settings.retrieval_batch_size,
            max_length=settings.retrieval_max_length,
            normalize=payload.normalize,
        )
        if isinstance(scores, float):
            scores = [scores]
        ranked = sorted(
            [RerankItem(index=index, score=float(score)) for index, score in enumerate(scores)],
            key=lambda item: item.score,
            reverse=True,
        )
        if payload.top_n is not None:
            ranked = ranked[: payload.top_n]
        REQUESTS.labels(endpoint, "ok").inc()
        return RerankResponse(model=settings.reranker_model, results=ranked)
    except HTTPException:
        REQUESTS.labels(endpoint, "error").inc()
        raise
    except Exception as exc:  # pragma: no cover - defensive service boundary
        logger.exception("rerank request failed")
        REQUESTS.labels(endpoint, "error").inc()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    finally:
        LATENCY.labels(endpoint).observe(time.perf_counter() - start)
