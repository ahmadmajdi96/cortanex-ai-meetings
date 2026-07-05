from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class DocumentOut(BaseModel):
    id: uuid.UUID
    tenant_id: str
    filename: str
    content_type: str | None
    sha256: str
    size_bytes: int
    status: str
    error: str | None
    chunk_count: int
    latest_job_id: uuid.UUID | None
    metadata: dict[str, Any]
    created_at: datetime
    updated_at: datetime


class JobOut(BaseModel):
    id: uuid.UUID
    tenant_id: str
    kind: str
    status: str
    payload: dict[str, Any]
    attempts: int
    error: str | None
    created_at: datetime
    updated_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class UploadResponse(BaseModel):
    documents: list[DocumentOut]
    jobs: list[JobOut]


class SourceOut(BaseModel):
    source_id: str
    document_id: uuid.UUID
    chunk_id: uuid.UUID
    filename: str
    page: int | None = None
    chunk_index: int
    score: float
    rerank_score: float | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)
    excerpt: str


class QueryRequest(BaseModel):
    question: str = Field(min_length=1)
    tenant_id: str | None = None
    top_k: int | None = Field(default=None, ge=1, le=100)
    rerank_top_n: int | None = Field(default=None, ge=1, le=30)
    score_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    filters: dict[str, Any] = Field(default_factory=dict)
    use_reranker: bool = True
    temperature: float = Field(default=0.1, ge=0.0, le=1.0)
    max_tokens: int = Field(default=1200, ge=128, le=4096)


class QueryResponse(BaseModel):
    answer: str
    tenant_id: str
    model: str
    sources: list[SourceOut]
    latency_ms: int


class ErrorResponse(BaseModel):
    detail: str
