from rag.qdrant_store import _query_filter


def test_query_filter_scopes_to_tenant_and_metadata():
    result = _query_filter("tenant-a", {"case_id": "case-1", "metadata.language": "ar"})

    assert result == {
        "must": [
            {"key": "tenant_id", "match": {"value": "tenant-a"}},
            {"key": "metadata.case_id", "match": {"value": "case-1"}},
            {"key": "metadata.language", "match": {"value": "ar"}},
        ]
    }
