"""잘못된 입력은 LLM·Qdrant를 부르기 전에 4xx로 거절한다."""
import shutil

import pytest
from fastapi.testclient import TestClient

import app as app_module
import document_ingest
import internal_docs.routes as docs_routes
import unified_routes

client = TestClient(app_module.app, raise_server_exceptions=False)


@pytest.fixture(autouse=True)
def no_llm(monkeypatch):
    def fail(*args, **kwargs):
        raise AssertionError("LLM must not be called for invalid input")

    monkeypatch.setattr(app_module, "generate_json", fail)


@pytest.mark.parametrize("path", ["/generate-minutes", "/generate-minutes/jobs"])
@pytest.mark.parametrize("text", ["", "   \n "])
def test_minutes_require_transcript(path, text):
    res = client.post(path, json={"text": text, "project_id": "p"})
    assert res.status_code == 400
    assert res.json()["detail"] == "text is required."


@pytest.mark.parametrize("path", ["/internal-docs/ingest", "/internal-docs/ingest/jobs"])
@pytest.mark.parametrize("field", ["qdrant_url", "qdrant_api_key"])
def test_ingest_rejects_qdrant_override(path, field):
    res = client.post(path, files=[("files", ("a.txt", b"hello", "text/plain"))], data={"project_id": "p", field: "http://127.0.0.1:1"})
    assert res.status_code == 400
    assert field.split("_")[0] in res.json()["detail"]


@pytest.mark.parametrize(
    "path,field,target",
    [
        ("/ocr", "file", unified_routes),
        ("/ocr/jobs", "file", unified_routes),
        ("/internal-docs/ingest", "files", docs_routes),
        ("/internal-docs/ingest/jobs", "files", docs_routes),
    ],
)
def test_document_upload_limit(monkeypatch, path, field, target):
    monkeypatch.setattr(target, "MAX_DOCUMENT_UPLOAD_MB", 1)
    big = b"a" * (1024 * 1024 + 1)
    res = client.post(path, files=[(field, ("big.txt", big, "text/plain"))], data={"project_id": "p"})
    assert res.status_code == 413


@pytest.mark.parametrize("path", ["/stt", "/stt/jobs", "/transcribe", "/transcribe/jobs"])
def test_audio_upload_limit(monkeypatch, path):
    monkeypatch.setattr(unified_routes, "MAX_AUDIO_UPLOAD_MB", 1)
    res = client.post(path, files={"file": ("big.mp3", b"a" * (1024 * 1024 + 1), "audio/mpeg")})
    assert res.status_code == 413


def test_upload_at_limit_is_accepted(monkeypatch):
    monkeypatch.setattr(unified_routes, "MAX_DOCUMENT_UPLOAD_MB", 1)
    res = client.post("/ocr", files={"file": ("ok.txt", b"a" * (1024 * 1024), "text/plain")})
    assert res.status_code == 200


def test_ocr_unsupported_type_is_400():
    res = client.post("/ocr", files={"file": ("a.zip", b"PK\x03\x04zip", "application/zip")})
    assert res.status_code == 400
    assert "Unsupported" in res.json()["detail"]


def test_ocr_corrupt_docx_is_400():
    res = client.post("/ocr", files={"file": ("a.docx", b"PK not a docx", "application/octet-stream")})
    assert res.status_code == 400


def test_ocr_corrupt_pdf_is_400():
    res = client.post("/ocr", files={"file": ("a.pdf", b"%PDF-1.4 not really", "application/pdf")})
    assert res.status_code == 400


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg required")
def test_stt_non_audio_is_400():
    res = client.post("/stt", files={"file": ("fake.mp3", b"this is not audio" * 50, "audio/mpeg")})
    assert res.status_code == 400
    assert "ffmpeg" in res.json()["detail"]


def test_ingest_blank_document_is_400():
    res = client.post("/internal-docs/ingest", files=[("files", ("blank.txt", b"   \n\n ", "text/plain"))], data={"project_id": "p"})
    assert res.status_code == 400
    assert "no_extractable_text" in res.json()["detail"]


def test_parse_failure_from_server_problem_stays_server_error(monkeypatch, tmp_path):
    import kordoc_parser

    def unavailable(path):
        raise kordoc_parser.KordocUnavailable("kordoc is not installed")

    monkeypatch.setattr(kordoc_parser, "parse_file", unavailable)
    (tmp_path / "a.pdf").write_bytes(b"%PDF")
    with pytest.raises(RuntimeError, match="KordocUnavailable"):
        document_ingest.run_kordoc_parser(tmp_path, tmp_path / "out")


def test_ingest_job_reports_invalid_document_type():
    res = client.post("/internal-docs/ingest/jobs", files=[("files", ("blank.txt", b"   \n ", "text/plain"))], data={"project_id": "p", "metadata": '{"document_ids": [7]}'})
    assert res.status_code == 202
    job_id = res.json()["job_id"]
    docs_routes.INGEST_JOB_EXECUTOR.submit(lambda: None).result(timeout=30)  # 앞선 작업이 끝나길 기다린다
    job = client.get(f"/internal-docs/ingest/jobs/{job_id}").json()
    assert job["status"] == "failed"
    assert job["error_type"] == "invalid_document"
    assert '"document_ids": [7]' in job["metadata"]


@pytest.mark.parametrize(
    "path,body",
    [
        ("/chat", {"question": ""}),
        ("/chat", {"question": "   \n "}),
        ("/chat", {"question": "예산은?", "max_previous_meetings": -1}),
        ("/generate-agendas", {"title": ""}),
        ("/generate-agendas", {"title": "  "}),
        ("/generate-preparation", {"title": ""}),
        ("/generate-preparation", {"title": "예산", "max_previous_meetings": -5}),
    ],
)
def test_blank_text_and_negative_counts_are_422(path, body):
    res = client.post(path, json=body)
    assert res.status_code == 422


def test_zero_previous_meetings_is_allowed():
    from schemas import ChatRequest, PreparationRequest

    assert ChatRequest(question="예산은?", max_previous_meetings=0).max_previous_meetings == 0
    assert PreparationRequest(title="예산", max_previous_meetings=0).max_previous_meetings == 0
