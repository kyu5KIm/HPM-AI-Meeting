from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid5

from config import (
    CHUNK_ENCODING,
    CHUNK_MAX_TABLE_TOKENS,
    CHUNK_MIN_CHARS,
    CHUNK_OVERLAP,
    CHUNK_SCRIPT_PATH,
    CHUNK_SIZE,
    CHUNK_VERSION,
    LOCAL_PDF_ENABLE_TABLES,
    LOCAL_PDF_MIN_PAGE_CHARS,
    LOCAL_PDF_OCR_FALLBACK,
    QDRANT_API_KEY,
    QDRANT_COLLECTION,
    QDRANT_URL,
    qdrant_collection_for_project,
)
from model_runtime import embed_texts, load_embedding_model, ocr_file_bytes


def load_script_module(path: Path, module_name: str) -> Any:
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load script module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def clean_text(text: str) -> str:
    text = re.sub(r"\x00", "", text or "")
    text = re.sub(r"[ \t]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _batched(items: list[Any], batch_size: int) -> list[list[Any]]:
    size = max(1, int(batch_size))
    return [items[index : index + size] for index in range(0, len(items), size)]


def _with_retries(label: str, operation: Any) -> Any:
    max_retries = int(os.getenv("QDRANT_MAX_RETRIES", "5"))
    base_seconds = float(os.getenv("QDRANT_RETRY_BASE_SEC", "2"))
    last_exc: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            return operation()
        except Exception as exc:
            last_exc = exc
            if attempt >= max_retries:
                break
            time.sleep(min(base_seconds * (2 ** (attempt - 1)), 30.0))
    raise RuntimeError(f"{label} failed after {max_retries} attempts: {last_exc}") from last_exc


def _write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        for row in rows:
            file.write(json.dumps(row, ensure_ascii=False) + "\n")


def _markdown_table(table: list[list[Any]]) -> str:
    rows: list[list[str]] = []
    for row in table or []:
        values = [clean_text(str(cell or "")).replace("|", "\\|") for cell in row]
        if any(values):
            rows.append(values)
    if not rows:
        return ""

    width = max(len(row) for row in rows)
    normalized = [row + [""] * (width - len(row)) for row in rows]
    header = normalized[0]
    body = normalized[1:] or [[""] * width]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in range(width)) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return "\n".join(lines).strip()


def _local_text_blocks(pdf_path: Path, doc_id: str, source_sha256: str) -> list[dict[str, Any]]:
    import fitz  # PyMuPDF

    blocks: list[dict[str, Any]] = []
    doc = fitz.open(str(pdf_path))
    try:
        for page_index in range(len(doc)):
            page_no = page_index + 1
            text = clean_text(doc.load_page(page_index).get_text("text") or "")
            if len(text) < LOCAL_PDF_MIN_PAGE_CHARS:
                continue
            blocks.append(
                {
                    "doc_id": doc_id,
                    "source_pdf": str(pdf_path),
                    "source_filename": pdf_path.name,
                    "source_sha256": source_sha256,
                    "parser": "local_pdf",
                    "page_no": page_no,
                    "page_idx": page_index,
                    "block_id": f"{doc_id}::page_{page_no:04d}_text",
                    "block_type": "text",
                    "content_category": "text",
                    "text": text,
                    "raw": {"original_block_index": 0},
                    "quality_flags": [],
                    "ocr_suspicious": False,
                }
            )
    finally:
        doc.close()
    return blocks


def _local_table_blocks(pdf_path: Path, doc_id: str, source_sha256: str) -> list[dict[str, Any]]:
    if not LOCAL_PDF_ENABLE_TABLES:
        return []
    try:
        import pdfplumber  # type: ignore
    except Exception:
        return []

    blocks: list[dict[str, Any]] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page_index, page in enumerate(pdf.pages):
            for table_index, table in enumerate(page.extract_tables() or [], start=1):
                text = _markdown_table(table)
                if len(text) < LOCAL_PDF_MIN_PAGE_CHARS:
                    continue
                page_no = page_index + 1
                blocks.append(
                    {
                        "doc_id": doc_id,
                        "source_pdf": str(pdf_path),
                        "source_filename": pdf_path.name,
                        "source_sha256": source_sha256,
                        "parser": "local_pdfplumber",
                        "page_no": page_no,
                        "page_idx": page_index,
                        "block_id": f"{doc_id}::page_{page_no:04d}_table_{table_index:03d}",
                        "block_type": "table",
                        "content_category": "table",
                        "text": text,
                        "raw": {"original_block_index": 1000 + table_index, "table": table},
                        "quality_flags": [],
                        "ocr_suspicious": False,
                    }
                )
    return blocks


def _local_ocr_fallback_block(pdf_path: Path, doc_id: str, source_sha256: str) -> dict[str, Any] | None:
    if not LOCAL_PDF_OCR_FALLBACK:
        return None
    try:
        text = clean_text(ocr_file_bytes(pdf_path.read_bytes(), pdf_path.name, "application/pdf"))
    except Exception:
        return None
    if len(text) < LOCAL_PDF_MIN_PAGE_CHARS:
        return None
    return {
        "doc_id": doc_id,
        "source_pdf": str(pdf_path),
        "source_filename": pdf_path.name,
        "source_sha256": source_sha256,
        "parser": "openai_ocr_fallback",
        "page_no": 1,
        "page_idx": 0,
        "block_id": f"{doc_id}::ocr_fallback",
        "block_type": "text",
        "content_category": "ocr_text",
        "text": text,
        "raw": {"original_block_index": 0},
        "quality_flags": ["ocr_fallback"],
        "ocr_suspicious": True,
    }


def run_local_pdf_parser(input_dir: Path, output_dir: Path) -> dict[str, Any]:
    started = time.perf_counter()
    json_dir = output_dir / "json"
    manifest_dir = output_dir / "manifests"
    json_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    all_blocks: list[dict[str, Any]] = []
    pdfs = sorted(input_dir.rglob("*.pdf"))
    for pdf_path in pdfs:
        source_sha256 = file_sha256(pdf_path)
        doc_id = f"doc_{source_sha256[:16]}"
        blocks = _local_text_blocks(pdf_path, doc_id, source_sha256)
        blocks.extend(_local_table_blocks(pdf_path, doc_id, source_sha256))
        if not blocks:
            fallback = _local_ocr_fallback_block(pdf_path, doc_id, source_sha256)
            if fallback is not None:
                blocks.append(fallback)

        blocks.sort(key=lambda item: (int(item.get("page_no") or 10**9), int((item.get("raw") or {}).get("original_block_index") or 0), str(item.get("block_id") or "")))
        all_blocks.extend(blocks)
        records.append(
            {
                "doc_id": doc_id,
                "source_pdf": str(pdf_path),
                "source_filename": pdf_path.name,
                "source_sha256": source_sha256,
                "status": "success" if blocks else "failed",
                "reason": None if blocks else "no_extractable_text",
                "blocks": len(blocks),
                "parser": "local_pdf",
            }
        )

    all_blocks_path = json_dir / "all_blocks.jsonl"
    _write_jsonl(all_blocks_path, all_blocks)
    _write_jsonl(manifest_dir / "parse_manifest.jsonl", records)
    _write_jsonl(
        manifest_dir / "document_registry.jsonl",
        [
            {
                "doc_id": record["doc_id"],
                "source_pdf": record["source_pdf"],
                "source_filename": record["source_filename"],
                "source_sha256": record["source_sha256"],
                "status": record["status"],
                "created_at": round(time.time(), 3),
            }
            for record in records
        ],
    )
    failed = sum(1 for record in records if record["status"] != "success")
    return {
        "mode": "local_pdf",
        "backend": "pymupdf_pdfplumber_openai_fallback",
        "elapsed_sec": round(time.perf_counter() - started, 3),
        "pdf_count": len(pdfs),
        "success": len(records) - failed,
        "skipped": 0,
        "failed": failed,
        "blocks": len(all_blocks),
        "all_blocks_path": str(all_blocks_path),
        "records": records,
    }


def run_kordoc_parser(input_dir: Path, output_dir: Path) -> dict[str, Any]:
    """kordoc으로 PDF·HWP·HWPX·DOCX·이미지·TXT를 블록으로 바꿔 all_blocks.jsonl을 만든다."""
    from kordoc_parser import KORDOC_VERSION, SUPPORTED_EXTENSIONS, parse_file

    started = time.perf_counter()
    json_dir = output_dir / "json"
    manifest_dir = output_dir / "manifests"
    json_dir.mkdir(parents=True, exist_ok=True)
    manifest_dir.mkdir(parents=True, exist_ok=True)

    records: list[dict[str, Any]] = []
    all_blocks: list[dict[str, Any]] = []
    files = sorted(path for path in input_dir.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS)
    for path in files:
        try:
            blocks, record = parse_file(path)
        except Exception as exc:
            blocks = []
            record = {
                "source_pdf": str(path),
                "source_filename": path.name,
                "status": "failed",
                "reason": f"{type(exc).__name__}: {exc}",
                "blocks": 0,
            }
        all_blocks.extend(blocks)
        records.append(record)

    all_blocks_path = json_dir / "all_blocks.jsonl"
    _write_jsonl(all_blocks_path, all_blocks)
    _write_jsonl(manifest_dir / "parse_manifest.jsonl", records)
    failed = [record for record in records if record.get("status") != "success"]
    if files and len(failed) == len(files):
        reasons = "; ".join(f"{r['source_filename']}: {r.get('reason')}" for r in failed)
        raise RuntimeError(f"Document parsing failed for every file: {reasons}")
    return {
        "mode": "kordoc",
        "backend": f"kordoc {KORDOC_VERSION} + luna_ocr_fallback",
        "elapsed_sec": round(time.perf_counter() - started, 3),
        "pdf_count": len(files),
        "success": len(records) - len(failed),
        "skipped": 0,
        "failed": len(failed),
        "blocks": len(all_blocks),
        "all_blocks_path": str(all_blocks_path),
        "records": records,
    }


def run_parser(input_dir: Path, output_dir: Path, require_cuda: bool = True) -> dict[str, Any]:
    _ = require_cuda
    # DOCUMENT_PARSER=local 이면 예전 PyMuPDF + pdfplumber 경로(PDF 전용)를 쓴다. 비교 측정용.
    if os.getenv("DOCUMENT_PARSER", "kordoc").strip().lower() == "local":
        return run_local_pdf_parser(input_dir, output_dir)
    return run_kordoc_parser(input_dir, output_dir)


def run_chunker(parsed_dir: Path, pdf_dir: Path, chunks_dir: Path) -> dict[str, Any]:
    input_path = parsed_dir / "json" / "all_blocks.jsonl"
    output_path = chunks_dir / "chunks_parent_child.jsonl"
    manifest_path = chunks_dir / "chunk_manifest.json"
    if not input_path.exists():
        raise RuntimeError(f"Parsed all_blocks.jsonl was not found: {input_path}")
    if not CHUNK_SCRIPT_PATH.exists():
        raise RuntimeError(f"Chunk script was not found: {CHUNK_SCRIPT_PATH}")
    started = time.perf_counter()
    chunk_module = load_script_module(CHUNK_SCRIPT_PATH, "ocr_make_chunks_module")
    args = chunk_module.argparse.Namespace(
        input=input_path,
        pdf_dir=pdf_dir,
        output=output_path,
        manifest=manifest_path,
        chunk_size=CHUNK_SIZE,
        overlap=CHUNK_OVERLAP,
        encoding=CHUNK_ENCODING,
        chunk_version=CHUNK_VERSION,
        min_chars=CHUNK_MIN_CHARS,
        max_table_tokens=CHUNK_MAX_TABLE_TOKENS,
        strict=False,
    )
    if args.overlap >= args.chunk_size:
        raise RuntimeError("Chunking failed: overlap must be smaller than chunk size")
    rows = chunk_module.read_jsonl(args.input, args.strict)
    filename_by_sha = chunk_module.pdf_hash_map(args.pdf_dir)
    tokenizer = chunk_module.Tokenizer(args.encoding)
    chunks = chunk_module.build_chunks(rows, tokenizer, args, filename_by_sha)
    chunk_module.write_jsonl(args.output, chunks)
    chunk_module.write_manifest(args.manifest, args, chunks, tokenizer)
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    return {
        "mode": "direct_import",
        "script": str(CHUNK_SCRIPT_PATH),
        "output": str(output_path),
        "manifest": manifest,
        "elapsed_sec": round(time.perf_counter() - started, 3),
        "blocks": len(rows),
        "chunks": len(chunks),
    }


def read_chunks_jsonl(path: Path) -> list[dict[str, Any]]:
    chunks: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as file:
        for line_no, line in enumerate(file, 1):
            line = line.strip()
            if not line:
                continue
            obj = json.loads(line)
            if not isinstance(obj, dict):
                raise RuntimeError(f"Invalid chunk JSON at line {line_no}")
            chunk_id = str(obj.get("chunk_id") or "")
            text = clean_text(str(obj.get("text") or obj.get("document") or ""))
            metadata = obj.get("metadata") if isinstance(obj.get("metadata"), dict) else {}
            if chunk_id and text:
                chunk: dict[str, Any] = {"chunk_id": chunk_id, "document": text, "metadata": metadata}
                parent_text = clean_text(str(obj.get("parent_text") or ""))
                parent_id = str(obj.get("parent_id") or metadata.get("parent_id") or "").strip()
                if parent_text:
                    chunk["parent_text"] = parent_text
                if parent_id:
                    chunk["parent_id"] = parent_id
                chunks.append(chunk)
    return chunks


def qdrant_point_id(chunk_id: str) -> str:
    return str(uuid5(NAMESPACE_URL, f"hpm-document:{chunk_id}"))


def ensure_payload_indexes(client: Any, collection_name: str) -> None:
    from qdrant_client import models

    for field_name in [
        "metadata.source_type",
        "metadata.project_id",
        "metadata.document_id",
        "metadata.doc_id",
        "metadata.parent_id",
    ]:
        try:
            client.create_payload_index(
                collection_name=collection_name,
                field_name=field_name,
                field_schema=models.PayloadSchemaType.KEYWORD,
            )
        except Exception as exc:
            message = str(exc).lower()
            if "already exists" not in message and "already has" not in message:
                raise


def _int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _first_value(data: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = data.get(key)
        if value not in (None, ""):
            return value
    return None


def _source_filename_keys(value: Any) -> list[str]:
    text = str(value or "").strip()
    if not text:
        return []
    name = Path(text).name
    return [item for item in [text, name] if item]


def _merge_source_metadata(
    chunks: list[dict[str, Any]],
    metadata_by_source_filename: dict[str, dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    if not metadata_by_source_filename:
        return chunks

    enriched: list[dict[str, Any]] = []
    for chunk in chunks:
        chunk_metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}
        per_file_metadata = None
        for key in [
            *_source_filename_keys(chunk_metadata.get("source_filename")),
            *_source_filename_keys(chunk_metadata.get("source_pdf")),
            *_source_filename_keys(chunk_metadata.get("file_name")),
            *_source_filename_keys(chunk_metadata.get("title")),
        ]:
            per_file_metadata = metadata_by_source_filename.get(key)
            if per_file_metadata:
                break

        if not per_file_metadata:
            enriched.append(chunk)
            continue

        next_chunk = dict(chunk)
        next_chunk["metadata"] = {
            **chunk_metadata,
            **per_file_metadata,
            "chunk_id": chunk_metadata.get("chunk_id") or chunk.get("chunk_id"),
        }
        enriched.append(next_chunk)
    return enriched


def _canonical_chunk_payload(chunk: dict[str, Any], metadata: dict[str, Any]) -> dict[str, Any]:
    chunk_metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), dict) else {}
    combined_metadata = {
        **metadata,
        **chunk_metadata,
        "chunk_id": chunk["chunk_id"],
        "parser": chunk_metadata.get("parser") or metadata.get("parser") or "local",
    }
    parent_id = _first_value(chunk, "parent_id") or _first_value(combined_metadata, "parent_id")
    parent_text = _first_value(chunk, "parent_text") or _first_value(combined_metadata, "parent_text")
    if parent_id is not None:
        combined_metadata.setdefault("parent_id", parent_id)
    if parent_text is not None:
        combined_metadata.setdefault("parent_text", parent_text)

    page = _int_or_none(
        _first_value(combined_metadata, "page", "page_no", "page_number", "page_start")
    )
    chunk_index = _int_or_none(_first_value(combined_metadata, "chunk_index"))
    if chunk_index is None:
        sequence = _int_or_none(_first_value(combined_metadata, "chunk_seq_global"))
        group_index = _int_or_none(_first_value(combined_metadata, "chunk_index_in_group"))
        if sequence is not None:
            chunk_index = max(0, sequence - 1)
        elif group_index is not None:
            chunk_index = max(0, group_index - 1)

    title = _first_value(combined_metadata, "title", "source_filename", "file_name")
    source_path = _first_value(
        combined_metadata,
        "source_path",
        "document_path",
        "s3_uri",
        "s3_url",
        "storage_key",
        "source_pdf",
    )

    canonical = {
        "doc_id": _first_value(combined_metadata, "doc_id"),
        "document_id": _first_value(combined_metadata, "document_id"),
        "project_id": _first_value(combined_metadata, "project_id"),
        "title": title,
        "page": page,
        "chunk_index": chunk_index,
        "source_path": source_path,
        "source_sha256": _first_value(combined_metadata, "source_sha256"),
        "source_type": _first_value(combined_metadata, "source_type", "document_type", "doc_type"),
        "viewer_type": _first_value(combined_metadata, "viewer_type"),
        "viewer_id": _first_value(combined_metadata, "viewer_id", "document_id"),
        "parent_id": _first_value(combined_metadata, "parent_id"),
    }
    for key, value in canonical.items():
        if value is not None:
            combined_metadata.setdefault(key, value)

    payload = {
        "chunk_id": chunk["chunk_id"],
        "document": chunk["document"],
        "content": chunk["document"],
        "metadata": combined_metadata,
    }
    if parent_id is not None:
        payload["parent_id"] = parent_id
    if parent_text is not None:
        payload["parent_text"] = parent_text
    payload.update({key: value for key, value in canonical.items() if value is not None})
    return payload


def upsert_chunks_to_qdrant(
    chunks: list[dict[str, Any]],
    metadata: dict[str, Any],
    qdrant_url: str | None = None,
    qdrant_api_key: str | None = None,
    collection: str | None = None,
    upsert_batch_size: int | None = None,
) -> int:
    if not chunks:
        return 0
    from qdrant_client import QdrantClient, models

    bundle = load_embedding_model()
    vectors = embed_texts([chunk["document"] for chunk in chunks])
    client = QdrantClient(
        url=qdrant_url or QDRANT_URL,
        api_key=qdrant_api_key if qdrant_api_key is not None else QDRANT_API_KEY,
        timeout=float(os.getenv("QDRANT_TIMEOUT_SEC", "120")),
    )
    collection_name = collection or qdrant_collection_for_project(metadata.get("project_id"))
    from qdrant_schema import ensure_collection

    _with_retries(
        "Qdrant ensure_collection",
        lambda: ensure_collection(client, models, collection_name, bundle.dimensions),
    )
    ensure_payload_indexes(client, collection_name)
    points = []
    for chunk, vector in zip(chunks, vectors, strict=True):
        points.append(
            models.PointStruct(
                id=qdrant_point_id(chunk["chunk_id"]),
                vector=vector,
                payload=_canonical_chunk_payload(chunk, metadata),
            )
        )
    batch_size = upsert_batch_size or int(os.getenv("QDRANT_UPSERT_BATCH_SIZE", "128"))
    for batch in _batched(points, batch_size):
        _with_retries(
            "Qdrant upsert",
            lambda batch=batch: client.upsert(collection_name=collection_name, points=batch, wait=True),
        )
    return len(points)


def ingest_pdf_chunks(
    pdf_dir: Path,
    parsed_dir: Path,
    chunks_dir: Path,
    metadata: dict[str, Any],
    *,
    metadata_by_source_filename: dict[str, dict[str, Any]] | None = None,
    require_cuda: bool = True,
    qdrant_url: str | None = None,
    qdrant_api_key: str | None = None,
    collection: str | None = None,
    upsert_batch_size: int | None = None,
) -> dict[str, Any]:
    parser_info = run_parser(pdf_dir, parsed_dir, require_cuda=require_cuda)
    chunker_info = run_chunker(parsed_dir, pdf_dir, chunks_dir)
    chunks = read_chunks_jsonl(Path(str(chunker_info["output"])))
    chunks = _merge_source_metadata(chunks, metadata_by_source_filename)
    upserted = upsert_chunks_to_qdrant(
        chunks,
        metadata,
        qdrant_url=qdrant_url,
        qdrant_api_key=qdrant_api_key,
        collection=collection,
        upsert_batch_size=upsert_batch_size,
    )
    return {"parser": parser_info, "chunker": chunker_info, "chunks": chunks, "upserted": upserted}
