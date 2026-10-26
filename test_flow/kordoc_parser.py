"""kordoc 기반 문서 파서.

kordoc(Node.js)으로 PDF·HWP·HWPX·DOCX·이미지를 블록(제목·문단·표, 페이지 번호)으로 바꾸고,
청커(internal_docs/chunker.py)가 읽는 all_blocks.jsonl 형식으로 변환한다.

- 스캔 페이지는 kordoc 내장 로컬 OCR(PP-OCRv5 Korean)로 읽는다. 첫 실행 때 모델(~18MB)을 내려받는다.
- kordoc OCR이 실패하거나 글자가 너무 적은 페이지만 OpenAI vision(Luna)으로 보조 OCR한다.
"""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent
KORDOC_VERSION = "4.24.1"
KORDOC_EXTENSIONS = {".pdf", ".hwp", ".hwpx", ".docx", ".png", ".jpg", ".jpeg", ".webp"}
TEXT_EXTENSIONS = {".txt"}
SUPPORTED_EXTENSIONS = KORDOC_EXTENSIONS | TEXT_EXTENSIONS
IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp"}


class KordocUnavailable(RuntimeError):
    pass


class KordocError(RuntimeError):
    pass


def _env_bool(name: str, default: bool) -> bool:
    return os.getenv(name, "true" if default else "false").strip().lower() == "true"


def min_page_chars() -> int:
    return int(os.getenv("LOCAL_PDF_MIN_PAGE_CHARS", "30"))


def kordoc_command() -> list[str]:
    configured = os.getenv("KORDOC_BIN", "").strip()
    candidates = [configured] if configured else []
    candidates += [str(APP_DIR / "kordoc" / "node_modules" / ".bin" / "kordoc"), "kordoc"]
    for candidate in candidates:
        resolved = shutil.which(candidate) or (candidate if Path(candidate).is_file() else None)
        if resolved:
            return [resolved]
    raise KordocUnavailable(
        "kordoc is not installed. Run `cd test_flow/kordoc && npm ci` (Node.js 20+), "
        "or set KORDOC_BIN to the kordoc CLI path."
    )


def run_kordoc(path: Path, *, ocr: bool | None = None, timeout: float | None = None) -> dict[str, Any]:
    """kordoc CLI를 실행해 JSON 결과(blocks, pages, pageQuality, warnings)를 반환한다."""
    command = kordoc_command()
    ocr = _env_bool("KORDOC_OCR", True) if ocr is None else ocr
    timeout = timeout or float(os.getenv("KORDOC_TIMEOUT_SEC", "600"))
    env = dict(os.environ)
    # Node 내장 fetch는 HTTPS_PROXY를 읽지 않는다. 사내 프록시 환경에서도 OCR 모델을 받을 수 있게 켠다.
    env.setdefault("NODE_USE_ENV_PROXY", "1")
    with tempfile.TemporaryDirectory(prefix="kordoc_") as work:
        out_path = Path(work) / "result.json"
        args = command + [str(path), "--format", "json", "--no-images", "--silent", "-o", str(out_path)]
        if ocr:
            args.append("--ocr")
        try:
            completed = subprocess.run(args, cwd=work, env=env, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as exc:
            raise KordocError(f"kordoc timed out after {timeout:.0f}s: {path.name}") from exc
        if not out_path.exists():
            detail = (completed.stderr or completed.stdout or "").strip()[-800:]
            raise KordocError(f"kordoc failed for {path.name} (exit {completed.returncode}): {detail}")
        result = json.loads(out_path.read_text(encoding="utf-8"))
    if not result.get("success", False):
        raise KordocError(f"kordoc could not parse {path.name}: {result.get('error') or result.get('code') or 'unknown'}")
    return result


def table_markdown(table: dict[str, Any]) -> str:
    """kordoc 표 셀을 GFM 표로 만든다. 병합 셀은 덮인 칸마다 같은 값을 채워 검색에서 빠지지 않게 한다."""
    cells = table.get("cells") or []
    rows = int(table.get("rows") or len(cells))
    cols = int(table.get("cols") or max((sum(int(c.get("colSpan") or 1) for c in row) for row in cells), default=0))
    if not rows or not cols:
        return ""
    grid: list[list[str | None]] = [[None] * cols for _ in range(rows)]
    for r, row in enumerate(cells[:rows]):
        c = 0
        for cell in row:
            while c < cols and grid[r][c] is not None:
                c += 1
            if c >= cols:
                break
            text = " ".join(str(cell.get("text") or "").split()).replace("|", "\\|")
            for dr in range(int(cell.get("rowSpan") or 1)):
                for dc in range(int(cell.get("colSpan") or 1)):
                    if r + dr < rows and c + dc < cols and grid[r + dr][c + dc] is None:
                        grid[r + dr][c + dc] = text
            c += int(cell.get("colSpan") or 1)
    lines = ["| " + " | ".join(value or "" for value in grid_row) + " |" for grid_row in grid]
    lines.insert(1, "| " + " | ".join(["---"] * cols) + " |")
    return "\n".join(lines)


def _block_text(block: dict[str, Any]) -> str:
    if block.get("type") == "table" and isinstance(block.get("table"), dict):
        return table_markdown(block["table"])
    if isinstance(block.get("items"), list):
        return "\n".join(f"- {item.get('text') if isinstance(item, dict) else item}" for item in block["items"])
    return str(block.get("text") or "").strip()


def blocks_from_kordoc(result: dict[str, Any], *, doc_id: str, source_path: Path, source_sha256: str) -> list[dict[str, Any]]:
    """kordoc 블록을 청커 입력 형식으로 바꾸고, 각 블록에 제목 경로(heading_path)를 붙인다."""
    rows: list[dict[str, Any]] = []
    heading_stack: list[tuple[int, str]] = []
    for index, block in enumerate(result.get("blocks") or []):
        kind = str(block.get("type") or "paragraph")
        if kind in {"image", "separator", "page_break"}:
            continue
        text = _block_text(block)
        if not text:
            continue
        if kind == "heading":
            level = int(block.get("level") or 1)
            heading_stack = [(lvl, name) for lvl, name in heading_stack if lvl < level]
            heading_stack.append((level, text))
        page = block.get("pageNumber")
        is_table = kind == "table"
        rows.append(
            {
                "doc_id": doc_id,
                "source_pdf": str(source_path),
                "source_filename": source_path.name,
                "source_sha256": source_sha256,
                "parser": "kordoc",
                "page_no": int(page) if page is not None else None,
                "block_id": f"{doc_id}::kordoc_{index:05d}",
                "block_type": "table" if is_table else "text",
                "content_category": "table" if is_table else kind,
                "text": text,
                "heading_path": [name for _, name in heading_stack],
                "raw": {"original_block_index": index, "kordoc_type": kind},
                "quality_flags": [],
                "ocr_suspicious": False,
            }
        )
    return rows


def _pages_needing_fallback(result: dict[str, Any], rows: list[dict[str, Any]]) -> list[int]:
    chars_by_page: dict[int, int] = {}
    for row in rows:
        if row.get("page_no") is not None:
            chars_by_page[int(row["page_no"])] = chars_by_page.get(int(row["page_no"]), 0) + len(row["text"])
    pages: list[int] = []
    for quality in result.get("pageQuality") or []:
        page = int(quality.get("page") or 0)
        if page and quality.get("needsOcr") and chars_by_page.get(page, 0) < min_page_chars():
            pages.append(page)
    return pages


def _render_pdf_page(path: Path, page_number: int) -> bytes:
    import fitz

    scale = float(os.getenv("OCR_RENDER_SCALE", "2.0"))
    with fitz.open(str(path)) as doc:
        pixmap = doc.load_page(page_number - 1).get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
        return pixmap.tobytes("png")


def _luna_ocr(image_bytes: bytes, name: str, content_type: str) -> str:
    from model_runtime import _ocr_image_bytes

    return _ocr_image_bytes(image_bytes, name, content_type).strip()


def _fallback_row(doc_id: str, path: Path, sha: str, page: int | None, text: str) -> dict[str, Any]:
    return {
        "doc_id": doc_id,
        "source_pdf": str(path),
        "source_filename": path.name,
        "source_sha256": sha,
        "parser": "openai_ocr_fallback",
        "page_no": page,
        "block_id": f"{doc_id}::ocr_fallback_p{page or 0:04d}",
        "block_type": "text",
        "content_category": "ocr_text",
        "text": text,
        "heading_path": [],
        "raw": {"original_block_index": 10**6},
        "quality_flags": ["ocr_fallback"],
        "ocr_suspicious": True,
    }


def luna_fallback_rows(path: Path, result: dict[str, Any], rows: list[dict[str, Any]], *, doc_id: str, sha: str) -> list[dict[str, Any]]:
    """kordoc OCR로 못 읽은 페이지만 Luna로 읽는다."""
    if not _env_bool("KORDOC_LUNA_FALLBACK", True):
        return []
    ext = path.suffix.lower()
    if ext in IMAGE_EXTENSIONS:
        if sum(len(row["text"]) for row in rows) >= min_page_chars():
            return []
        text = _luna_ocr(path.read_bytes(), path.name, f"image/{ext.lstrip('.').replace('jpg', 'jpeg')}")
        return [_fallback_row(doc_id, path, sha, 1, text)] if text else []
    if ext != ".pdf":
        return []
    max_pages = int(os.getenv("OCR_MAX_PDF_PAGES", "10"))
    fallback: list[dict[str, Any]] = []
    for page in _pages_needing_fallback(result, rows)[:max_pages]:
        text = _luna_ocr(_render_pdf_page(path, page), f"{path.stem}-p{page}.png", "image/png")
        if text:
            fallback.append(_fallback_row(doc_id, path, sha, page, text))
    return fallback


def text_file_rows(path: Path, *, doc_id: str, sha: str) -> list[dict[str, Any]]:
    from model_runtime import _decode_text

    text, _encoding = _decode_text(path.read_bytes())
    paragraphs = [part.strip() for part in text.replace("\r\n", "\n").split("\n\n") if part.strip()]
    return [
        {
            "doc_id": doc_id,
            "source_pdf": str(path),
            "source_filename": path.name,
            "source_sha256": sha,
            "parser": "text",
            "page_no": None,
            "block_id": f"{doc_id}::text_{index:05d}",
            "block_type": "text",
            "content_category": "text",
            "text": paragraph,
            "heading_path": [],
            "raw": {"original_block_index": index},
            "quality_flags": [],
            "ocr_suspicious": False,
        }
        for index, paragraph in enumerate(paragraphs)
    ]


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def parse_file(path: Path) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """파일 하나를 청커 입력 블록으로 바꾼다. (블록, 파싱 기록)을 반환한다."""
    sha = file_sha256(path)
    doc_id = f"doc_{sha[:16]}"
    ext = path.suffix.lower()
    record: dict[str, Any] = {"doc_id": doc_id, "source_pdf": str(path), "source_filename": path.name, "source_sha256": sha}
    if ext in TEXT_EXTENSIONS:
        rows = text_file_rows(path, doc_id=doc_id, sha=sha)
        record.update(parser="text", warnings=[])
    elif ext in KORDOC_EXTENSIONS:
        result = run_kordoc(path)
        rows = blocks_from_kordoc(result, doc_id=doc_id, source_path=path, source_sha256=sha)
        fallback = luna_fallback_rows(path, result, rows, doc_id=doc_id, sha=sha)
        rows.extend(fallback)
        record.update(
            parser="kordoc",
            kordoc_version=KORDOC_VERSION,
            page_mode=(result.get("metadata") or {}).get("pageMode"),
            page_count=result.get("pageCount"),
            warnings=[w.get("code") for w in result.get("warnings") or [] if isinstance(w, dict)],
            luna_fallback_pages=[row["page_no"] for row in fallback],
        )
    else:
        raise ValueError(f"Unsupported document type: {path.name}")
    rows.sort(key=lambda row: (row["page_no"] if row["page_no"] is not None else 10**9, row["raw"]["original_block_index"]))
    record.update(status="success" if rows else "failed", reason=None if rows else "no_extractable_text", blocks=len(rows))
    return rows, record


def extract_text(file_bytes: bytes, filename: str) -> str:
    """/ocr 엔드포인트용: 파일에서 페이지 순서대로 텍스트만 뽑는다."""
    suffix = Path(filename or "").suffix.lower() or ".bin"
    with tempfile.TemporaryDirectory(prefix="kordoc_ocr_") as work:
        path = Path(work) / f"input{suffix}"
        path.write_bytes(file_bytes)
        rows, _record = parse_file(path)
    pages: dict[Any, list[str]] = {}
    for row in rows:
        pages.setdefault(row["page_no"], []).append(row["text"])
    if len(pages) <= 1:
        return "\n\n".join(text for texts in pages.values() for text in texts).strip()
    return "\n\n".join(f"[page {page}]\n" + "\n\n".join(texts) for page, texts in pages.items()).strip()
