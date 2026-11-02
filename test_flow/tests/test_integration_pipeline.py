"""전체 파이프라인 통합 테스트.

KURE·OpenAI API는 로컬 가짜 HTTP 서버로, Qdrant는 메모리 모드로 대신한다.
코드는 실제 HTTP 요청 경로(KureClient, OpenAI SDK)를 그대로 탄다.

문서 업로드(kordoc) -> 청킹 -> KURE 임베딩 -> Qdrant -> 검색(Dense+BM25+RRF+KURE 리랭크)
-> rag_eval 지표 -> /chat(Luna) -> /generate-minutes(Luna) -> 회의록 적재
"""
import hashlib
import importlib
import json
import math
import re
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from qdrant_client import QdrantClient

APP_DIR = Path(__file__).resolve().parent.parent
kordoc_ready = (APP_DIR / "kordoc" / "node_modules" / ".bin" / "kordoc").exists() and shutil.which("node")
pytestmark = pytest.mark.skipif(not kordoc_ready, reason="kordoc not installed")

HWPX_MD = """# 2026 사업계획

## 2장 예산

### 2.1 마케팅 예산

올해 마케팅 예산 총액은 10억 원이며 분기별로 나누어 집행한다. 집행 결과는 매 분기 경영회의에 보고한다.

### 2.2 보안 점검

보안 점검은 분기마다 실시하고 결과를 정보보호위원회에 보고한다. 담당자는 보안팀장이다.
"""


def bigrams(text):
    text = re.sub(r"\s+", "", str(text))
    return [text[i : i + 2] for i in range(len(text) - 1)]


def fake_vector(text, dim):
    vec = [0.0] * dim
    for gram in bigrams(text):
        vec[int(hashlib.md5(gram.encode()).hexdigest(), 16) % dim] += 1.0
    norm = math.sqrt(sum(v * v for v in vec)) or 1.0
    return [v / norm for v in vec]


class FakeServices(BaseHTTPRequestHandler):
    log = {"kure_embeddings": [], "kure_rerank": [], "openai_chat": []}

    def log_message(self, *args):
        pass

    def _json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get("Content-Length", 0))) or b"{}")
        if self.path == "/kure/embeddings":
            assert self.headers["Authorization"] == "Bearer fake-kure-key"
            assert len(body["input"]) <= 8, "KURE 요청당 8개 제한 위반"
            self.log["kure_embeddings"].append(body)
            dim = int(body.get("dimensions") or 2048)
            data = [{"index": i, "embedding": fake_vector(t, dim)} for i, t in enumerate(body["input"])]
            return self._json({"data": data, "model": body["model"]})
        if self.path == "/kure/rerank":
            self.log["kure_rerank"].append(body)
            q = set(bigrams(body["query"]))
            scores = [len(q & set(bigrams(d))) / (len(q) or 1) for d in body["documents"]]
            ranked = sorted(range(len(scores)), key=lambda i: -scores[i])
            return self._json({"results": [{"index": i, "relevance_score": scores[i]} for i in ranked]})
        if self.path == "/openai/v1/chat/completions":
            self.log["openai_chat"].append(body)
            text = json.dumps(body["messages"], ensure_ascii=False)
            if "document_question" in text and "general_chat" in text:
                content = json.dumps({"intent": "document_question", "reason": "문서 질문"}, ensure_ascii=False)
            elif "todo_list" in text:
                content = json.dumps(
                    {
                        "summary": "배포일을 11월 3일로 확정했다.",
                        "content": "## 결정 사항\n- 배포일은 11월 3일",
                        "todo_list": [{"title": "배포 준비", "owner": "김규호", "due_date": "2026-11-01", "priority": "high", "content": ""}],
                    },
                    ensure_ascii=False,
                )
            else:
                content = "근거에 따르면 마케팅 예산 총액은 10억 원입니다.\n출처: [1] 사업계획.hwpx"
            return self._json(
                {
                    "id": "c1",
                    "object": "chat.completion",
                    "created": 0,
                    "model": body["model"],
                    "choices": [{"index": 0, "message": {"role": "assistant", "content": content}, "finish_reason": "stop"}],
                    "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2},
                }
            )
        return self._json({"error": self.path}, 404)


@pytest.fixture(scope="module")
def services():
    server = ThreadingHTTPServer(("127.0.0.1", 0), FakeServices)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_port}"
    server.shutdown()


@pytest.fixture
def env(services, monkeypatch, tmp_path):
    import model_runtime
    import retrieval

    monkeypatch.setenv("KURE_API_KEY", "fake-kure-key")
    monkeypatch.setenv("KURE_BASE_URL", f"{services}/kure")
    monkeypatch.setenv("KURE_MIN_INTERVAL_SEC", "0")
    monkeypatch.setenv("RAG_SKIP_RERANK", "false")
    monkeypatch.setattr(model_runtime, "OPENAI_API_KEY", "sk-fake")
    monkeypatch.setattr(model_runtime, "OPENAI_BASE_URL", f"{services}/openai/v1")
    monkeypatch.setattr(model_runtime, "_document_embedder", None)
    monkeypatch.setattr(model_runtime, "embedding_bundle", None)
    monkeypatch.setattr(model_runtime, "text_bundle", None)
    retrieval.feature_chat_rag_bundles.clear()
    for log in FakeServices.log.values():
        log.clear()

    qdrant = QdrantClient(":memory:")
    monkeypatch.setattr("qdrant_client.QdrantClient", lambda *a, **k: qdrant)
    feature_chat = str(APP_DIR / "feature_chat")
    if feature_chat not in sys.path:
        sys.path.insert(0, feature_chat)
    store = importlib.import_module("rag.qdrant_store")
    monkeypatch.setattr(store, "make_client", lambda config: qdrant)
    yield qdrant
    retrieval.feature_chat_rag_bundles.clear()


def make_docs(directory):
    script = (
        "const {markdownToHwpx}=require('kordoc');const fs=require('fs');"
        "markdownToHwpx(fs.readFileSync(0,'utf8')).then(b=>fs.writeFileSync(process.argv[1],Buffer.from(b)));"
    )
    subprocess.run(["node", "-e", script, str(directory / "사업계획.hwpx")], input=HWPX_MD, text=True, check=True, cwd=APP_DIR / "kordoc")
    import fitz

    doc = fitz.open()
    for text in ["1장 운영 일정\n서비스 정식 오픈은 2026년 12월 1일이다. 베타 테스트는 11월에 진행한다.",
                 "2장 인력\n개발 인력은 6명이며 AI 담당 2명, 백엔드 2명, 프론트엔드 2명으로 구성된다."]:
        page = doc.new_page()
        page.insert_text((72, 90), text, fontname="korea", fontsize=12)
    doc.save(directory / "운영안.pdf")


def test_full_pipeline(env, tmp_path):
    from fastapi.testclient import TestClient

    import app as app_module
    from internal_docs.service import UploadedDocument, ingest_uploaded_documents
    from rag_eval.metrics import aggregate
    from rag_eval.run_eval import run
    from retrieval import feature_chat_ranked_hits

    qdrant = env
    make_docs(tmp_path)
    files = [UploadedDocument(p.name, p.read_bytes()) for p in sorted(tmp_path.iterdir())]

    # 1) 문서 적재: kordoc 파싱 -> 부모-자식 청킹 -> KURE 임베딩 -> Qdrant(dense + sparse 자리)
    result = ingest_uploaded_documents(files, project_id="77")
    assert result["qdrant_collection"] == "hpm_project_kure_77"
    assert result["parser"]["mode"] == "kordoc" and result["parser"]["failed"] == 0
    assert result["upserted"] >= 3
    params = qdrant.get_collection("hpm_project_kure_77").config.params
    assert params.vectors.size == 1024 and "kure_sparse" in params.sparse_vectors
    doc_calls = [c for c in FakeServices.log["kure_embeddings"] if c["input_type"] == "document"]
    assert doc_calls and all(c["dimensions"] == 1024 and c["model"] == "kure-v3" for c in doc_calls)

    # 2) 검색: 질문은 input_type=query, KURE 리랭커 사용, 제목 경로 헤더가 붙은 청크가 1위
    hits = feature_chat_ranked_hits("마케팅 예산 총액은 얼마인가요?", top_k=5, project_id="77")
    assert hits and "10억" in hits[0].document
    assert "[위치: 2026 사업계획 > 2장 예산 > 2.1 마케팅 예산]" in hits[0].document
    assert hits[0].rerank_score is not None
    assert any(c["input_type"] == "query" for c in FakeServices.log["kure_embeddings"])
    assert FakeServices.log["kure_rerank"] and FakeServices.log["kure_rerank"][0]["model"] == "kure-reranker-nano"

    pdf_hit = feature_chat_ranked_hits("개발 인력은 몇 명인가요?", top_k=5, project_id="77")[0]
    assert "6명" in pdf_hit.document and pdf_hit.metadata["page_start"] == 2

    # 3) 평가 도구가 같은 검색 경로로 지표를 낸다.
    items = [
        {"id": "q1", "question": "마케팅 예산 총액은?", "project_id": "77", "relevant": [{"source": "사업계획", "contains": "10억"}]},
        {"id": "q2", "question": "보안 점검 주기는?", "project_id": "77", "relevant": [{"source": "사업계획", "contains": "분기마다 실시"}]},
        {"id": "q3", "question": "정식 오픈일은 언제야?", "project_id": "77", "relevant": [{"source": "운영안", "page": 1}]},
    ]
    report = run(items, top_k=10, default_project_id=None)
    summary = aggregate([row["scores"] for row in report["queries"]])
    assert summary["recall@10"] == 1.0 and summary["mrr"] >= 0.5, report

    # 4) /chat: Luna(GPT-5 계열) 파라미터로 호출하고, 검색된 근거를 프롬프트에 넣는다.
    client = TestClient(app_module.app)
    FakeServices.log["openai_chat"].clear()
    response = client.post("/chat", json={"question": "마케팅 예산 총액은 얼마야?", "project_id": "77"})
    assert response.status_code == 200, response.text
    calls = FakeServices.log["openai_chat"]
    assert calls and all(c["model"] == "gpt-5.6-luna" for c in calls)
    assert all("max_tokens" not in c and "max_completion_tokens" in c and "reasoning_effort" in c for c in calls)
    answer_call = calls[-1]
    assert "10억" in json.dumps(answer_call["messages"], ensure_ascii=False)

    # 5) /generate-minutes: 회의록 생성 후 회의 헤더가 붙은 청크로 같은 컬렉션에 적재된다.
    response = client.post(
        "/generate-minutes",
        json={"text": "SPEAKER_00: 배포일은 11월 3일로 하죠.", "meeting_id": "5", "project_id": "77", "title": "스프린트 회의", "meeting_datetime": "2026-10-20 10:00"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["result"]["qdrant_ingest"]["upserted_points"] >= 2
    meeting_hits = feature_chat_ranked_hits("스프린트 회의에서 정한 배포일은?", top_k=5, project_id="77", source_scope="meeting")
    assert meeting_hits and meeting_hits[0].document.startswith("[회의: 스프린트 회의 / 2026-10-20 10:00]")
