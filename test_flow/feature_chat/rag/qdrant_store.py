from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from qdrant_client import QdrantClient
from qdrant_client import models


DEFAULT_QDRANT_COLLECTION = "hpm_kure_chunks"


@dataclass
class QdrantConfig:
    url: str = "http://localhost:6333"
    api_key: str | None = None
    collection: str = DEFAULT_QDRANT_COLLECTION
    prefer_grpc: bool = False


@dataclass
class PointRecord:
    chunk_id: str
    document: str
    metadata: dict[str, Any]


def qdrant_point_id(chunk_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"scenario-pased-v1:{chunk_id}"))


def config_from_env(
    url: str | None = None,
    api_key: str | None = None,
    collection: str | None = None,
    prefer_grpc: bool = False,
) -> QdrantConfig:
    return QdrantConfig(
        url=url or os.getenv("QDRANT_URL") or os.getenv("QDRANT_HOST") or "http://localhost:6333",
        api_key=api_key if api_key is not None else os.getenv("QDRANT_API_KEY"),
        collection=collection or os.getenv("QDRANT_COLLECTION") or DEFAULT_QDRANT_COLLECTION,
        prefer_grpc=prefer_grpc,
    )


def make_client(config: QdrantConfig) -> QdrantClient:
    return QdrantClient(url=config.url, api_key=config.api_key, prefer_grpc=config.prefer_grpc)


def collection_exists(client: QdrantClient, collection: str) -> bool:
    try:
        return bool(client.collection_exists(collection))
    except AttributeError:
        names = {item.name for item in client.get_collections().collections}
        return collection in names


def ensure_collection(client: QdrantClient, collection: str, vector_size: int, reset: bool = False) -> None:
    if reset and collection_exists(client, collection):
        client.delete_collection(collection_name=collection)
        print(f"[INFO] Deleted existing Qdrant collection: {collection}")

    if collection_exists(client, collection):
        return

    # test_flow/qdrant_schema.py와 같은 구조: 기본 dense 벡터 + 나중에 채울 sparse 벡터 자리
    client.create_collection(
        collection_name=collection,
        vectors_config=models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        sparse_vectors_config={os.getenv("QDRANT_SPARSE_VECTOR_NAME", "kure_sparse"): models.SparseVectorParams()},
    )
    print(f"[INFO] Created Qdrant collection: {collection} (size={vector_size}, distance=cosine)")


def payload_to_record(payload: dict[str, Any] | None) -> PointRecord:
    payload = payload or {}
    metadata = payload.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}

    chunk_id = str(payload.get("chunk_id") or metadata.get("chunk_id") or "")
    document = str(payload.get("document") or "")
    clean_metadata = dict(metadata)
    clean_metadata.setdefault("chunk_id", chunk_id)
    if payload.get("parent_id") not in (None, ""):
        clean_metadata.setdefault("parent_id", payload.get("parent_id"))
    if payload.get("parent_text") not in (None, ""):
        clean_metadata.setdefault("parent_text", payload.get("parent_text"))
    return PointRecord(chunk_id=chunk_id, document=document, metadata=clean_metadata)


def scroll_records(client: QdrantClient, collection: str, batch_size: int = 1000) -> list[PointRecord]:
    records: list[PointRecord] = []
    offset: Any = None
    while True:
        points, offset = client.scroll(
            collection_name=collection,
            limit=batch_size,
            offset=offset,
            with_payload=True,
            with_vectors=False,
        )
        for point in points:
            records.append(payload_to_record(getattr(point, "payload", None)))
        if offset is None:
            break
    if not records:
        raise RuntimeError("No documents found in Qdrant collection. Run 03_0_index_qdrant_openai.py first.")
    return records


def count_points(client: QdrantClient, collection: str) -> int:
    result = client.count(collection_name=collection, exact=True)
    return int(result.count)


def existing_chunk_ids(client: QdrantClient, collection: str, chunk_ids: list[str]) -> set[str]:
    if not chunk_ids:
        return set()
    point_ids = [qdrant_point_id(chunk_id) for chunk_id in chunk_ids]
    try:
        points = client.retrieve(collection_name=collection, ids=point_ids, with_payload=True, with_vectors=False)
    except Exception:
        return set()
    existing: set[str] = set()
    for point in points:
        payload = getattr(point, "payload", None) or {}
        chunk_id = payload.get("chunk_id")
        if chunk_id:
            existing.add(str(chunk_id))
    return existing


def _match_values(value: str | int | None) -> list[str | int]:
    if value is None:
        return []
    text = str(value).strip()
    if not text:
        return []
    values: list[str | int] = [text]
    if text.isdigit():
        values.append(int(text))
    return values


def _match_condition(key: str, value: str | int | None) -> models.FieldCondition | None:
    values = _match_values(value)
    if not values:
        return None
    if len(values) == 1:
        return models.FieldCondition(key=key, match=models.MatchValue(value=values[0]))
    try:
        return models.FieldCondition(key=key, match=models.MatchAny(any=values))
    except Exception:
        return models.FieldCondition(key=key, match=models.MatchValue(value=values[0]))


def _match_any_condition(key: str, values: list[str] | None) -> models.FieldCondition | None:
    clean_values = [str(value).strip() for value in values or [] if str(value).strip()]
    if not clean_values:
        return None
    if len(clean_values) == 1:
        return models.FieldCondition(key=key, match=models.MatchValue(value=clean_values[0]))
    try:
        return models.FieldCondition(key=key, match=models.MatchAny(any=clean_values))
    except Exception:
        return None


def make_filter(
    doc_id: str | None = None,
    *,
    project_id: str | int | None = None,
    meeting_id: str | int | None = None,
    exclude_meeting_id: str | int | None = None,
    source_types: list[str] | None = None,
) -> models.Filter | None:
    must: list[Any] = []
    must_not: list[Any] = []

    for condition in [
        _match_condition("metadata.doc_id", doc_id),
        _match_condition("metadata.project_id", project_id),
        _match_condition("metadata.meeting_id", meeting_id),
        _match_any_condition("metadata.source_type", source_types),
    ]:
        if condition is not None:
            must.append(condition)

    exclude_condition = _match_condition("metadata.meeting_id", exclude_meeting_id)
    if exclude_condition is not None:
        must_not.append(exclude_condition)

    if not must and not must_not:
        return None
    return models.Filter(must=must or None, must_not=must_not or None)


def search_points(
    client: QdrantClient,
    collection: str,
    query_vector: list[float],
    limit: int,
    doc_id: str | None = None,
    project_id: str | int | None = None,
    meeting_id: str | int | None = None,
    exclude_meeting_id: str | int | None = None,
    source_types: list[str] | None = None,
) -> list[Any]:
    query_filter = make_filter(
        doc_id,
        project_id=project_id,
        meeting_id=meeting_id,
        exclude_meeting_id=exclude_meeting_id,
        source_types=source_types,
    )
    if hasattr(client, "query_points"):
        result = client.query_points(
            collection_name=collection,
            query=query_vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
        return list(getattr(result, "points", result))

    return list(
        client.search(
            collection_name=collection,
            query_vector=query_vector,
            query_filter=query_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False,
        )
    )
