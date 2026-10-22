import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

import kure_api
from kure_api import KureAPIError, KureClient, parse_rerank_response

APP_DIR = Path(__file__).resolve().parent.parent


class FakeResponse:
    def __init__(self, status, payload=None, headers=None, text=""):
        self.status_code = status
        self._payload = payload
        self.headers = headers or {}
        self.text = text

    def json(self):
        return self._payload


@pytest.fixture
def client(monkeypatch):
    monkeypatch.setenv("KURE_API_KEY", "test-key")
    monkeypatch.setenv("KURE_MIN_INTERVAL_SEC", "0")
    monkeypatch.setenv("KURE_RETRY_BASE_SEC", "0")
    monkeypatch.setattr(kure_api.time, "sleep", lambda _s: None)
    return KureClient()


def test_embed_splits_into_batches_of_8_and_sends_input_type(client, monkeypatch):
    calls = []

    def post(url, json, headers, timeout):
        calls.append((url, json, headers))
        data = [{"index": i, "embedding": [float(i), 1.0]} for i in reversed(range(len(json["input"])))]
        return FakeResponse(200, {"data": data})

    monkeypatch.setattr(client.session, "post", post)
    vectors = client.embed([f"t{i}" for i in range(19)], model="kure-v3", input_type="document", dimensions=1024)
    assert [len(c[1]["input"]) for c in calls] == [8, 8, 3]
    assert all(c[0].endswith("/api/v1/embeddings") for c in calls)
    assert all(c[1]["input_type"] == "document" and c[1]["dimensions"] == 1024 for c in calls)
    assert calls[0][2]["Authorization"] == "Bearer test-key"
    assert len(vectors) == 19 and vectors[1] == [1.0, 1.0]  # index 순서로 정렬


def test_embed_retries_on_429_then_succeeds(client, monkeypatch):
    responses = iter([FakeResponse(429, text="rate"), FakeResponse(200, {"data": [{"index": 0, "embedding": [0.5]}]})])
    monkeypatch.setattr(client.session, "post", lambda *a, **k: next(responses))
    assert client.embed(["q"], model="kure-v3", input_type="query") == [[0.5]]


def test_embed_does_not_retry_on_401(client, monkeypatch):
    calls = []
    monkeypatch.setattr(client.session, "post", lambda *a, **k: calls.append(1) or FakeResponse(401, text="bad key"))
    with pytest.raises(KureAPIError, match="HTTP 401"):
        client.embed(["q"], model="kure-v3", input_type="query")
    assert len(calls) == 1


def test_embed_rejects_wrong_input_type(client):
    with pytest.raises(ValueError):
        client.embed(["q"], model="kure-v3", input_type="passage")


def test_missing_key_raises(monkeypatch):
    monkeypatch.delenv("KURE_API_KEY", raising=False)
    with pytest.raises(KureAPIError):
        KureClient()


@pytest.mark.parametrize(
    "payload",
    [
        {"results": [{"index": 1, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.1}]},
        {"data": [{"index": 0, "score": 0.1}, {"index": 1, "score": 0.9}]},
        [{"index": 1, "score": 0.9}, {"index": 0, "score": 0.1}],
        {"documents": [{"document": "b", "relevance_score": 0.9}, {"text": "a", "relevance_score": 0.1}]},
        {"results": [{"document": {"text": "b"}, "relevance_score": 0.9}, {"index": 0, "relevance_score": 0.1}]},
    ],
)
def test_parse_rerank_response_formats(payload):
    assert parse_rerank_response(payload, ["a", "b"]) == [(1, 0.9), (0, 0.1)]


def test_parse_rerank_response_rejects_garbage():
    with pytest.raises(KureAPIError):
        parse_rerank_response({"unexpected": 1}, ["a"])


def test_rerank_sends_documented_fields(client, monkeypatch):
    seen = {}

    def post(url, json, headers, timeout):
        seen.update(url=url, body=json)
        return FakeResponse(200, {"results": [{"index": 0, "relevance_score": 0.7}]})

    monkeypatch.setattr(client.session, "post", post)
    assert client.rerank("질문", ["문서"], model="kure-reranker-nano") == [(0, 0.7)]
    assert seen["url"].endswith("/rerank")
    assert seen["body"] == {"model": "kure-reranker-nano", "query": "질문", "documents": ["문서"]}


@pytest.mark.parametrize("module_path", ["feature_chat.rag.embeddings", "internal_docs.rag.embeddings"])
def test_embedder_kure_uses_query_and_document_types(module_path, monkeypatch):
    monkeypatch.setenv("KURE_API_KEY", "k")
    module = importlib.import_module(module_path)
    embedder = module.make_embedder(provider="kure", model="kure-v3")
    assert embedder.dimensions == 1024
    seen = []
    embedder._client = SimpleNamespace(embed=lambda texts, **kw: seen.append(kw) or [[0.0]] * len(texts))
    embedder.embed_texts(["a", "b"])
    embedder.embed_query("q")
    assert [s["input_type"] for s in seen] == ["document", "query"]
    assert all(s["dimensions"] == 1024 and s["model"] == "kure-v3" for s in seen)


def test_embedding_copies_stay_in_sync():
    a = (APP_DIR / "feature_chat/rag/embeddings.py").read_text(encoding="utf-8")
    b = (APP_DIR / "internal_docs/rag/embeddings.py").read_text(encoding="utf-8")
    start = a.index("def _use_local_packages")
    a = a[: start] + a[a.index("@dataclass"):]
    assert a.replace("        _use_local_packages()\n", "", 1) == b


def test_reasoning_model_kwargs():
    import model_runtime as mr

    assert mr.chat_completion_kwargs("gpt-4.1-mini", 100) == {"temperature": 0, "max_tokens": 100}
    low = mr.chat_completion_kwargs("gpt-5.6-luna", 100, reasoning_effort="low")
    assert low == {"reasoning_effort": "low", "max_completion_tokens": 100 + mr.TEXT_REASONING_EXTRA_TOKENS}
    none = mr.chat_completion_kwargs("openai/gpt-5.6-luna", 100, reasoning_effort="none")
    assert none == {"reasoning_effort": "none", "max_completion_tokens": 100, "temperature": 0}


def test_create_chat_completion_drops_unsupported_param_once():
    import model_runtime as mr

    calls = []

    class Completions:
        def create(self, **kwargs):
            calls.append(kwargs)
            if "reasoning_effort" in kwargs:
                raise RuntimeError("Unsupported parameter: 'reasoning_effort' is not supported with this model.")
            return "ok"

    client = SimpleNamespace(chat=SimpleNamespace(completions=Completions()))
    assert mr.create_chat_completion(client, "gpt-5.6-luna", [], 10) == "ok"
    assert len(calls) == 2 and "reasoning_effort" not in calls[1]

    def always_fail(**kwargs):
        raise RuntimeError("rate limit")

    client.chat.completions.create = always_fail
    with pytest.raises(RuntimeError, match="rate limit"):
        mr.create_chat_completion(client, "gpt-5.6-luna", [], 10)


def test_config_defaults_point_to_new_models():
    import config

    assert config.TEXT_MODEL_ID == "gpt-5.6-luna"
    assert config.EMBEDDING_PROVIDER == "kure" and config.EMBEDDING_MODEL_ID == "kure-v3"
    assert config.EMBEDDING_DIMENSIONS_INT == 1024
    assert config.RERANK_PROVIDER == "kure" and config.RERANK_MODEL == "kure-reranker-nano"
    assert config.qdrant_collection_for_project("7") == "hpm_project_kure_7"
    import os

    assert os.environ["RAG_EMBEDDING_DIMENSIONS"] == "1024"


def _rag_search():
    feature_chat = str(APP_DIR / "feature_chat")
    if feature_chat not in sys.path:
        sys.path.insert(0, feature_chat)
    return importlib.import_module("rag_search")


def test_rerank_dispatch_kure(monkeypatch):
    rs = _rag_search()
    hits = [
        rs.SearchHit(rank=i + 1, chunk_id=f"c{i}", document=f"doc {i}", metadata={"source_filename": "a.pdf"}, source="rrf", score=0.0)
        for i in range(3)
    ]
    monkeypatch.setattr(rs, "_kure_client", SimpleNamespace(rerank=lambda q, docs, model: [(2, 0.9), (0, 0.5), (1, 0.1)]))
    args = SimpleNamespace(rerank_provider="kure", rerank_model=None, rerank_top_n=2)
    out = rs.rerank_hits("q", hits, args)
    assert [h.chunk_id for h in out] == ["c2", "c0"]
    assert [h.rank for h in out] == [1, 2] and out[0].rerank_score == 0.9
    with pytest.raises(ValueError):
        rs.rerank_hits("q", hits, SimpleNamespace(rerank_provider="jev", rerank_top_n=2))


def test_retrieval_skip_rerank_follows_provider(monkeypatch):
    import retrieval

    monkeypatch.delenv("RAG_SKIP_RERANK", raising=False)
    monkeypatch.setenv("RERANK_PROVIDER", "kure")
    monkeypatch.delenv("KURE_API_KEY", raising=False)
    assert retrieval._skip_rerank_default() is True
    monkeypatch.setenv("KURE_API_KEY", "k")
    assert retrieval._skip_rerank_default() is False


def test_switching_provider_keeps_ingest_and_search_in_sync():
    """제공자만 바꿔도 모델명·차원·검색 설정이 같이 바뀌어야 한다(.env.example 기본값에 묶이면 안 됨)."""
    import json
    import os
    import subprocess

    script = (
        "import config, os, json;"
        "print(json.dumps([config.EMBEDDING_PROVIDER, config.EMBEDDING_MODEL_ID, config.EMBEDDING_DIMENSIONS,"
        "os.environ['RAG_EMBEDDING_PROVIDER'], os.environ['RAG_EMBEDDING_MODEL'], os.environ['RAG_EMBEDDING_DIMENSIONS'],"
        "config.RERANK_PROVIDER, config.RERANK_MODEL]))"
    )
    clean = {k: v for k, v in os.environ.items() if not k.startswith(("TEST_FLOW_", "EMBEDDING_", "RAG_", "RERANK_"))}

    def run(extra):
        out = subprocess.run([sys.executable, "-c", script], cwd=APP_DIR, env={**clean, **extra}, capture_output=True, text=True, check=True)
        return json.loads(out.stdout.strip().splitlines()[-1])

    assert run({}) == ["kure", "kure-v3", "1024", "kure", "kure-v3", "1024", "kure", "kure-reranker-nano"]
    old = run({"TEST_FLOW_EMBEDDING_PROVIDER": "openai", "TEST_FLOW_RERANK_PROVIDER": "cohere"})
    assert old == ["openai", "text-embedding-3-small", "", "openai", "text-embedding-3-small", "", "cohere", "rerank-v3.5"]
