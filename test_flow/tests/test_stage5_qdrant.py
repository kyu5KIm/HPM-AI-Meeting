from types import SimpleNamespace

import pytest
from qdrant_client import QdrantClient, models

import qdrant_schema


@pytest.fixture
def memory_qdrant(monkeypatch):
    client = QdrantClient(":memory:")
    monkeypatch.setattr("qdrant_client.QdrantClient", lambda *a, **k: client)
    return client


def test_ensure_collection_creates_dense_and_sparse_slot():
    client = QdrantClient(":memory:")
    assert qdrant_schema.ensure_collection(client, models, "c", 1024) is True
    params = client.get_collection("c").config.params
    assert params.vectors.size == 1024
    assert qdrant_schema.SPARSE_VECTOR_NAME in params.sparse_vectors
    assert qdrant_schema.ensure_collection(client, models, "c", 1024) is False
    with pytest.raises(RuntimeError, match="1024-dim"):
        qdrant_schema.ensure_collection(client, models, "c", 1536)


def test_document_upsert_uses_new_schema(memory_qdrant, monkeypatch):
    import document_ingest as di

    monkeypatch.setattr(di, "load_embedding_model", lambda: SimpleNamespace(dimensions=4))
    monkeypatch.setattr(di, "embed_texts", lambda texts: [[1.0, 0.0, 0.0, float(i)] for i, _ in enumerate(texts)])
    chunks = [{"chunk_id": f"c{i}", "document": f"문서 {i}", "metadata": {"source_filename": "a.hwp"}} for i in range(3)]
    assert di.upsert_chunks_to_qdrant(chunks, {"project_id": "9"}) == 3
    name = "hpm_project_kure_9"
    assert memory_qdrant.count(name).count == 3
    assert qdrant_schema.SPARSE_VECTOR_NAME in memory_qdrant.get_collection(name).config.params.sparse_vectors


def test_meeting_reingest_endpoint(memory_qdrant, monkeypatch):
    from fastapi.testclient import TestClient

    import app as app_module
    import meeting_ingest

    monkeypatch.setattr(meeting_ingest, "load_embedding_model", lambda: SimpleNamespace(dimensions=4))
    monkeypatch.setattr(meeting_ingest, "embed_texts", lambda texts: [[0.5, 0.5, 0.0, 0.0] for _ in texts])
    client = TestClient(app_module.app)
    payload = {
        "meeting_id": "12",
        "project_id": "3",
        "title": "스프린트 회의",
        "meeting_datetime": "2026-10-20 10:00",
        "content": "배포일을 11월 3일로 정했다.",
        "todo_list": [{"title": "배포 준비", "owner": "김규호", "due_date": "2026-11-01"}],
    }
    response = client.post("/meeting-minutes/ingest", json=payload)
    assert response.status_code == 200, response.text
    data = response.json()
    assert data["qdrant_collection"] == "hpm_project_kure_3" and data["upserted_points"] == 2
    points, _ = memory_qdrant.scroll("hpm_project_kure_3", with_payload=True)
    documents = sorted(p.payload["document"] for p in points)
    assert all(doc.startswith("[회의: 스프린트 회의 / 2026-10-20 10:00]") for doc in documents)

    # 같은 회의를 다시 넣으면 기존 청크를 지우고 다시 쓴다(중복 없음).
    assert client.post("/meeting-minutes/ingest", json=payload).json()["upserted_points"] == 2
    assert memory_qdrant.count("hpm_project_kure_3").count == 2

    assert client.post("/meeting-minutes/ingest", json={"meeting_id": "1"}).status_code == 400
