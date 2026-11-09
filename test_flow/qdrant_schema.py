"""Qdrant 컬렉션 구조를 한 곳에서 정한다.

- 이름 없는 기본 dense 벡터: 지금 임베딩(KURE-v3 1024차원). 기존 적재·검색 코드가 그대로 쓴다.
- sparse 벡터 자리(kure_sparse): KURE-Sparse를 평가 후 도입할 때 update_vectors로 채운다.
  자리를 미리 만들어 두면 sparse를 붙일 때 컬렉션을 다시 만들고 전체를 재적재하지 않아도 된다.
"""
from __future__ import annotations

import os
from typing import Any

SPARSE_VECTOR_NAME = os.getenv("QDRANT_SPARSE_VECTOR_NAME", "kure_sparse")


def collection_config(models: Any, vector_size: int) -> dict[str, Any]:
    return {
        "vectors_config": models.VectorParams(size=vector_size, distance=models.Distance.COSINE),
        "sparse_vectors_config": {SPARSE_VECTOR_NAME: models.SparseVectorParams()},
    }


def dense_vector_size(client: Any, collection: str) -> int | None:
    vectors = client.get_collection(collection_name=collection).config.params.vectors
    size = getattr(vectors, "size", None)
    if size is None and isinstance(vectors, dict):
        default = vectors.get("") or next(iter(vectors.values()), None)
        size = getattr(default, "size", None)
    return int(size) if size is not None else None


def ensure_collection(client: Any, models: Any, collection: str, vector_size: int) -> bool:
    """없으면 만들고 True를 반환한다. 있으면 dense 차원이 맞는지 확인한다."""
    try:
        exists = bool(client.collection_exists(collection))
    except AttributeError:
        exists = collection in {item.name for item in client.get_collections().collections}
    if not exists:
        client.create_collection(collection_name=collection, **collection_config(models, vector_size))
        return True
    existing = dense_vector_size(client, collection)
    if existing is not None and existing != vector_size:
        raise RuntimeError(
            f"Qdrant collection {collection} has {existing}-dim vectors but the embedding model returns {vector_size}. "
            "임베딩 모델이나 차원을 바꿨다면 QDRANT_COLLECTION_PREFIX를 새 이름으로 바꾸고 재적재하세요."
        )
    return False
