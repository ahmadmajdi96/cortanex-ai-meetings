from __future__ import annotations

from fastapi import Header, HTTPException, status

from rag.config import get_settings


def require_api_key(
    x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    authorization: str | None = Header(default=None),
) -> None:
    settings = get_settings()
    valid_keys = set(settings.rag_api_keys)
    if not valid_keys:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="RAG_API_KEYS is not configured")

    bearer = None
    if authorization and authorization.lower().startswith("bearer "):
        bearer = authorization.split(" ", 1)[1].strip()

    if x_api_key in valid_keys or bearer in valid_keys:
        return
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid API key")
