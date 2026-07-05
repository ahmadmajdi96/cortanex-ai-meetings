from __future__ import annotations

from typing import Any

import httpx

from rag.config import get_settings


def _url(base: str, path: str) -> str:
    return f"{base.rstrip('/')}/{path.lstrip('/')}"


class EmbeddingClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    def embed(self, texts: list[str]) -> list[list[float]]:
        with httpx.Client(timeout=self.settings.rag_query_timeout_seconds) as client:
            response = client.post(
                _url(str(self.settings.embedding_base_url), "/v1/embeddings"),
                json={"model": self.settings.embedding_model, "input": texts},
            )
            response.raise_for_status()
            data = response.json()["data"]
            return [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]

    async def aembed(self, texts: list[str]) -> list[list[float]]:
        async with httpx.AsyncClient(timeout=self.settings.rag_query_timeout_seconds) as client:
            response = await client.post(
                _url(str(self.settings.embedding_base_url), "/v1/embeddings"),
                json={"model": self.settings.embedding_model, "input": texts},
            )
            response.raise_for_status()
            data = response.json()["data"]
            return [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]


class RerankerClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def arerank(self, query: str, documents: list[str], top_n: int) -> list[dict[str, Any]]:
        async with httpx.AsyncClient(timeout=self.settings.rag_query_timeout_seconds) as client:
            response = await client.post(
                _url(str(self.settings.embedding_base_url), "/v1/rerank"),
                json={"query": query, "documents": documents, "top_n": top_n, "normalize": True},
            )
            response.raise_for_status()
            return response.json()["results"]


class LLMClient:
    def __init__(self) -> None:
        self.settings = get_settings()

    async def achat(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
    ) -> str:
        async with httpx.AsyncClient(timeout=self.settings.rag_query_timeout_seconds) as client:
            response = await client.post(
                _url(str(self.settings.llm_base_url), "/chat/completions"),
                json={
                    "model": self.settings.llm_model,
                    "messages": messages,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"].strip()
