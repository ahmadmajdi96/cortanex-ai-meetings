from __future__ import annotations

from functools import lru_cache

from redis import Redis
from rq import Queue

from rag.config import get_settings


@lru_cache
def redis_connection() -> Redis:
    return Redis.from_url(get_settings().redis_url)


@lru_cache
def ingest_queue() -> Queue:
    settings = get_settings()
    return Queue(settings.queue_name, connection=redis_connection(), default_timeout=3600)
