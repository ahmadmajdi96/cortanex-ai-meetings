from rag.chunking import chunk_sections
from rag.extractors import TextSection


def test_chunk_sections_preserves_metadata_and_overlap():
    sections = [TextSection(text=" ".join(f"word{i}" for i in range(80)), metadata={"page": 3})]

    chunks = chunk_sections(sections, chunk_tokens=40, overlap_tokens=8)

    assert len(chunks) >= 2
    assert all(chunk.metadata["page"] == 3 for chunk in chunks)
    assert all(chunk.token_count <= 40 for chunk in chunks)
