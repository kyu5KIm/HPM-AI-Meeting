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


def qdrant_point_id(chunk_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"hpm-document-v1:{chunk_id}"))


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
