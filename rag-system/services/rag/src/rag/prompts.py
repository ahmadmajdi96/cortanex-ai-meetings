from __future__ import annotations

from rag.schemas import SourceOut


def looks_arabic(text: str) -> bool:
    return any("\u0600" <= char <= "\u06ff" or "\u0750" <= char <= "\u077f" for char in text)


def build_messages(question: str, sources: list[SourceOut]) -> list[dict[str, str]]:
    answer_language = "Arabic" if looks_arabic(question) else "the same language as the user"
    context = "\n\n".join(
        f"[{source.source_id}] file={source.filename} page={source.page or 'n/a'} chunk={source.chunk_index}\n{source.excerpt}"
        for source in sources
    )
    system = (
        "You are a production RAG assistant for legal and business documents. "
        "Answer only from the provided context. If the context is insufficient, say that the documents do not contain enough information. "
        "Cite every factual claim with source ids like [S1] or [S2]. "
        f"Answer in {answer_language}. For Arabic, use clear Modern Standard Arabic unless the user asks for another dialect. "
        "Do not reveal hidden reasoning or chain-of-thought."
    )
    user = f"Context:\n{context}\n\nQuestion:\n{question}"
    return [{"role": "system", "content": system}, {"role": "user", "content": user}]
