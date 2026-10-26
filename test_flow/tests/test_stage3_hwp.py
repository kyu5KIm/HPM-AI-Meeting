import os
from pathlib import Path

import pytest

import kordoc_parser as kp

APP_DIR = Path(__file__).resolve().parent.parent
TEMPLATE = APP_DIR / "kordoc" / "node_modules" / "kordoc" / "templates" / "일반기안문_서식.hwpx"


def test_upload_service_and_route_accept_hwp(tmp_path):
    from internal_docs import routes
    from internal_docs.service import ALLOWED_EXTENSIONS, UploadedDocument, _prepare_uploads

    assert {".hwp", ".hwpx"} <= ALLOWED_EXTENSIONS
    assert routes.ALLOWED_EXTENSIONS is ALLOWED_EXTENSIONS
    assert ALLOWED_EXTENSIONS <= kp.SUPPORTED_EXTENSIONS
    files = [UploadedDocument("보고서.hwp", b"HWP"), UploadedDocument("기안.hwpx", b"PK")]
    prepared = _prepare_uploads(files, tmp_path / "raw", tmp_path / "parse", {})
    assert sorted(p.suffix for p in (tmp_path / "parse").iterdir()) == [".hwp", ".hwpx"]
    assert len(prepared["metadata_by_source_filename"]) == 2
    with pytest.raises(ValueError, match="Allowed"):
        _prepare_uploads([UploadedDocument("a.exe", b"x")], tmp_path / "raw2", tmp_path / "parse2", {})


@pytest.mark.skipif(not TEMPLATE.exists(), reason="kordoc not installed")
def test_real_hancom_hwpx_with_relative_path(monkeypatch):
    # kordoc은 임시 폴더를 cwd로 실행되므로 상대 경로도 절대 경로로 바뀌어야 한다(회귀 테스트).
    monkeypatch.chdir(APP_DIR)
    rows, record = kp.parse_file(Path(os.path.relpath(TEMPLATE, APP_DIR)))
    assert record["status"] == "success" and record["parser"] == "kordoc"
    assert any("수신" in row["text"] for row in rows)
