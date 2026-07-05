from __future__ import annotations

from functools import lru_cache

from pydantic import AnyHttpUrl, Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", enable_decoding=False)

    database_url: str
    redis_url: str

    minio_endpoint: str = "http://minio:9000"
    minio_access_key: str
    minio_secret_key: str
    minio_bucket: str = "rag-documents"

    qdrant_url: str = "http://qdrant:6333"
    qdrant_api_key: str | None = None
    rag_collection: str = "rag_chunks"

    rag_api_keys: list[str] = Field(default_factory=list)
    rag_default_tenant: str = "default"
    rag_allowed_origins: list[str] = Field(default_factory=lambda: ["*"])
    rag_max_upload_mb: int = 250
    rag_chunk_tokens: int = 750
    rag_chunk_overlap_tokens: int = 120
    rag_top_k: int = 24
    rag_rerank_top_n: int = 8
    rag_score_threshold: float = 0.15
    rag_query_timeout_seconds: int = 180

    embedding_base_url: AnyHttpUrl
    embedding_model: str = "BAAI/bge-m3"
    embedding_dim: int = 1024
    reranker_model: str = "BAAI/bge-reranker-v2-m3"

    llm_base_url: AnyHttpUrl
    llm_model: str = "local-rag-llm"

    queue_name: str = "rag-ingest"

    @field_validator("rag_api_keys", mode="before")
    @classmethod
    def split_api_keys(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @field_validator("rag_allowed_origins", mode="before")
    @classmethod
    def split_origins(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            return [item.strip() for item in value.split(",") if item.strip()]
        return value

    @property
    def max_upload_bytes(self) -> int:
        return self.rag_max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()
