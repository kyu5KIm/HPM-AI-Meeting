"""KURE API(kure.kullm.ai) 클라이언트.

- /embeddings: kure-v3 (OpenAI 호환, input_type=query|document, dimensions 256~2048)
- /rerank: kure-reranker-nano (요청당 문서 최대 100개)
- 요청당 텍스트 최대 8개, 기본 한도 분당 60회·분당 200,000토큰·일 4,000,000토큰
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any

import requests

DEFAULT_BASE_URL = "https://kure.kullm.ai/api/v1"
MAX_TEXTS_PER_REQUEST = 8
MAX_RERANK_DOCUMENTS = 100
RETRY_STATUS = {408, 409, 425, 429, 500, 502, 503, 504}


class KureAPIError(RuntimeError):
    pass


class _RateLimiter:
    """프로세스 전체에서 KURE 요청 간격을 맞춘다. 분당 요청 한도를 넘지 않게 최소 간격을 둔다."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._next_at = 0.0

    def wait(self, min_interval: float) -> None:
        if min_interval <= 0:
            return
        with self._lock:
            now = time.monotonic()
            delay = self._next_at - now
            self._next_at = max(now, self._next_at) + min_interval
        if delay > 0:
            time.sleep(delay)


_LIMITER = _RateLimiter()


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, str(default)))
    except ValueError:
        return default


class KureClient:
    def __init__(self, api_key: str | None = None, base_url: str | None = None, timeout: float | None = None) -> None:
        self.api_key = api_key or os.getenv("KURE_API_KEY", "")
        if not self.api_key:
            raise KureAPIError("KURE_API_KEY is not configured. Put it in test_flow/.env.")
        self.base_url = (base_url or os.getenv("KURE_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")
        self.timeout = timeout or _env_float("KURE_TIMEOUT_SEC", 60.0)
        self.max_retries = int(_env_float("KURE_MAX_RETRIES", 6))
        self.retry_base = _env_float("KURE_RETRY_BASE_SEC", 2.0)
        # 기본 한도 60 RPM -> 요청 간 1초. 원문 저장 동의(120 RPM)면 0.5로 낮출 수 있다.
        self.min_interval = _env_float("KURE_MIN_INTERVAL_SEC", 1.0)
        self.session = requests.Session()

    def _post(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"{self.base_url}{path}"
        headers = {"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/json"}
        last_error: str = ""
        for attempt in range(1, self.max_retries + 1):
            _LIMITER.wait(self.min_interval)
            try:
                response = self.session.post(url, json=payload, headers=headers, timeout=self.timeout)
            except requests.RequestException as exc:
                last_error = f"{type(exc).__name__}: {exc}"
            else:
                if response.status_code < 400:
                    return response.json()
                last_error = f"HTTP {response.status_code}: {response.text[:500]}"
                if response.status_code not in RETRY_STATUS:
                    raise KureAPIError(f"KURE {path} failed: {last_error}")
                retry_after = response.headers.get("Retry-After")
                if retry_after:
                    try:
                        time.sleep(min(float(retry_after), 60.0))
                        continue
                    except ValueError:
                        pass
            if attempt < self.max_retries:
                time.sleep(min(self.retry_base * (2 ** (attempt - 1)), 60.0))
        raise KureAPIError(f"KURE {path} failed after {self.max_retries} attempts: {last_error}")

    def embed(self, texts: list[str], *, model: str, input_type: str, dimensions: int | None = None) -> list[list[float]]:
        if input_type not in {"query", "document"}:
            raise ValueError(f"input_type must be query or document: {input_type}")
        vectors: list[list[float]] = []
        for start in range(0, len(texts), MAX_TEXTS_PER_REQUEST):
            batch = texts[start : start + MAX_TEXTS_PER_REQUEST]
            payload: dict[str, Any] = {"model": model, "input": batch, "input_type": input_type}
            if dimensions:
                payload["dimensions"] = int(dimensions)
            data = self._post("/embeddings", payload)
            items = sorted(data.get("data") or [], key=lambda item: item.get("index", 0))
            if len(items) != len(batch):
                raise KureAPIError(f"KURE /embeddings returned {len(items)} vectors for {len(batch)} texts.")
            vectors.extend(list(item["embedding"]) for item in items)
        return vectors

    def rerank(self, query: str, documents: list[str], *, model: str) -> list[tuple[int, float]]:
        """(원래 문서 인덱스, relevance_score)를 점수 내림차순으로 반환한다."""
        if not documents:
            return []
        documents = documents[:MAX_RERANK_DOCUMENTS]
        data = self._post("/rerank", {"model": model, "query": query, "documents": documents})
        return parse_rerank_response(data, documents)


def parse_rerank_response(data: Any, documents: list[str]) -> list[tuple[int, float]]:
    """응답 스키마가 문서화돼 있지 않아 Cohere/Jina/TEI 형식을 모두 받아들인다."""
    items = data
    if isinstance(data, dict):
        for key in ("results", "data", "documents", "ranked"):
            if isinstance(data.get(key), list):
                items = data[key]
                break
    if not isinstance(items, list):
        raise KureAPIError(f"Unexpected KURE /rerank response: {str(data)[:300]}")

    text_to_index: dict[str, int] = {}
    for index, text in enumerate(documents):
        text_to_index.setdefault(text, index)

    ranked: list[tuple[int, float]] = []
    seen: set[int] = set()
    for item in items:
        if not isinstance(item, dict):
            continue
        index = item.get("index", item.get("document_index", item.get("corpus_id")))
        if index is None:
            doc = item.get("document")
            text = doc.get("text") if isinstance(doc, dict) else (doc if isinstance(doc, str) else item.get("text"))
            index = text_to_index.get(text) if isinstance(text, str) else None
        score = item.get("relevance_score", item.get("score"))
        if index is None or score is None:
            continue
        index = int(index)
        if 0 <= index < len(documents) and index not in seen:
            seen.add(index)
            ranked.append((index, float(score)))
    ranked.sort(key=lambda pair: pair[1], reverse=True)
    return ranked
