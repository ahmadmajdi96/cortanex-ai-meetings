from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import tiktoken

from rag.extractors import TextSection


@dataclass(frozen=True)
class TextChunk:
    text: str
    token_count: int
    metadata: dict[str, Any]


def _encoding():
    try:
        return tiktoken.get_encoding("cl100k_base")
    except Exception:  # pragma: no cover - tiktoken always ships this encoding, keep fallback defensive.
        return None


def count_tokens(text: str) -> int:
    enc = _encoding()
    if enc is None:
        return max(1, len(text) // 4)
    return len(enc.encode(text))


def chunk_sections(sections: list[TextSection], chunk_tokens: int, overlap_tokens: int) -> list[TextChunk]:
    if chunk_tokens <= 0:
        raise ValueError("chunk_tokens must be positive")
    if overlap_tokens >= chunk_tokens:
        raise ValueError("overlap_tokens must be smaller than chunk_tokens")

    enc = _encoding()
    chunks: list[TextChunk] = []
    for section in sections:
        text = section.text.strip()
        if not text:
            continue

        if enc is None:
            words = text.split()
            step = max(1, chunk_tokens - overlap_tokens)
            for start in range(0, len(words), step):
                part = " ".join(words[start : start + chunk_tokens]).strip()
                if part:
                    chunks.append(TextChunk(text=part, token_count=count_tokens(part), metadata=dict(section.metadata)))
            continue

        tokens = enc.encode(text)
        start = 0
        while start < len(tokens):
            end = min(start + chunk_tokens, len(tokens))
            part = enc.decode(tokens[start:end]).strip()
            if part:
                chunks.append(TextChunk(text=part, token_count=end - start, metadata=dict(section.metadata)))
            if end == len(tokens):
                break
            start = max(start + 1, end - overlap_tokens)
    return chunks
