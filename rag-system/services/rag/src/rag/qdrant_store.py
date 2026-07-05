from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from rag.config import get_settings


@dataclass(frozen=True)
class SearchHit:
    id: str
    score: float
    payload: dict[str, Any]


class QdrantStore:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.collection = self.settings.rag_collection

    @property
    def headers(self) -> dict[str, str]:
        if self.settings.qdrant_api_key:
            return {"api-key": self.settings.qdrant_api_key}
        return {}

    def _url(self, path: str) -> str:
        return f"{self.settings.qdrant_url.rstrip('/')}/{path.lstrip('/')}"

    def ensure_collection(self, vector_size: int) -> None:
        with httpx.Client(timeout=30) as client:
            response = client.get(self._url(f"/collections/{self.collection}"), headers=self.headers)
            if response.status_code == 404:
                create = client.put(
                    self._url(f"/collections/{self.collection}"),
                    headers=self.headers,
                    json={
                        "vectors": {"size": vector_size, "distance": "Cosine"},
                        "hnsw_config": {"m": 32, "ef_construct": 128},
                        "optimizers_config": {"default_segment_number": 2},
                    },
                )
                create.raise_for_status()
                return
            response.raise_for_status()
            result = response.json()["result"]
            current_size = result["config"]["params"]["vectors"]["size"]
            if current_size != vector_size:
                raise ValueError(f"Qdrant collection vector size is {current_size}, expected {vector_size}")

    def upsert(self, points: list[dict[str, Any]]) -> None:
        if not points:
            return
        with httpx.Client(timeout=120) as client:
            for start in range(0, len(points), 64):
                batch = points[start : start + 64]
                response = client.put(
                    self._url(f"/collections/{self.collection}/points"),
                    params={"wait": "true"},
                    headers=self.headers,
                    json={"points": batch},
                )
                response.raise_for_status()

    def delete_document(self, tenant_id: str, document_id: str) -> None:
        with httpx.Client(timeout=60) as client:
            response = client.post(
                self._url(f"/collections/{self.collection}/points/delete"),
                params={"wait": "true"},
                headers=self.headers,
                json={"filter": _document_filter(tenant_id, document_id)},
            )
            if response.status_code != 404:
                response.raise_for_status()

    async def asearch(
        self,
        *,
        tenant_id: str,
        vector: list[float],
        limit: int,
        score_threshold: float | None,
        filters: dict[str, Any] | None = None,
    ) -> list[SearchHit]:
        payload: dict[str, Any] = {
            "vector": vector,
            "filter": _query_filter(tenant_id, filters or {}),
            "limit": limit,
            "with_payload": True,
            "with_vector": False,
            "params": {"hnsw_ef": 128},
        }
        if score_threshold is not None:
            payload["score_threshold"] = score_threshold
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                self._url(f"/collections/{self.collection}/points/search"),
                headers=self.headers,
                json=payload,
            )
            response.raise_for_status()
            return [
                SearchHit(id=str(item["id"]), score=float(item["score"]), payload=item.get("payload") or {})
                for item in response.json().get("result", [])
            ]


def _document_filter(tenant_id: str, document_id: str) -> dict[str, Any]:
    return {
        "must": [
            {"key": "tenant_id", "match": {"value": tenant_id}},
            {"key": "document_id", "match": {"value": document_id}},
        ]
    }


def _query_filter(tenant_id: str, filters: dict[str, Any]) -> dict[str, Any]:
    must: list[dict[str, Any]] = [{"key": "tenant_id", "match": {"value": tenant_id}}]
    for key, value in filters.items():
        if value is None:
            continue
        payload_key = key if key.startswith(("metadata.", "document_", "chunk_", "filename", "page", "slide", "sheet")) else f"metadata.{key}"
        if isinstance(value, list):
            must.append({"key": payload_key, "match": {"any": value}})
        else:
            must.append({"key": payload_key, "match": {"value": value}})
    return {"must": must}
