from __future__ import annotations

import json
import os
import shutil
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from config import EMBEDDING_MODEL_ID, qdrant_collection_for_project
from document_ingest import file_sha256, ingest_pdf_chunks
from model_runtime import load_embedding_model
from runtime_locks import GPU_TASK_LOCK


@dataclass(frozen=True)
class UploadedDocument:
    filename: str
    content: bytes


ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt"}


def preload_embedding_model() -> dict[str, Any]:
    bundle = load_embedding_model()
    return {
        "provider": "huggingface",
        "model": EMBEDDING_MODEL_ID,
        "dimensions": bundle.dimensions,
        "device": bundle.device,
    }


def _safe_filename(filename: str, index: int, suffix: str | None = None) -> str:
    original = Path(filename or f"document_{index:04d}").name
    stem = Path(original).stem or f"document_{index:04d}"
    clean_stem = "".join(char if char.isalnum() or char in "._- " else "_" for char in stem).strip(" ._")
    clean_stem = clean_stem or f"document_{index:04d}"
    clean_suffix = (suffix or Path(original).suffix or ".pdf").lower()
    return f"{index:04d}_{clean_stem}{clean_suffix}"


def _metadata_from_json(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError as exc:
        raise ValueError(f"metadata must be valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise ValueError("metadata must be a JSON object")
    return parsed


def _document_entry_for_upload(base_metadata: dict[str, Any], upload: UploadedDocument, index: int) -> dict[str, Any]:
    documents = base_metadata.get("documents") if isinstance(base_metadata.get("documents"), list) else []
    for item in documents:
        if not isinstance(item, dict):
            continue
        if _int_like(item.get("index")) == str(index):
            return item

    filename = str(upload.filename or "")
    for item in documents:
        if isinstance(item, dict) and str(item.get("filename") or "") == filename:
            return item

    document_map = base_metadata.get("document_map") if isinstance(base_metadata.get("document_map"), dict) else {}
    document_id = document_map.get(filename)
    if document_id not in (None, ""):
        return {"filename": filename, "document_id": document_id}
    return {}


def _file_metadata(base_metadata: dict[str, Any], upload: UploadedDocument, saved_path: Path, index: int) -> dict[str, Any]:
    metadata = dict(base_metadata)
    document_entry = _document_entry_for_upload(base_metadata, upload, index)
    document_id = _int_like(document_entry.get("document_id"))
    filename = str(document_entry.get("filename") or upload.filename)

    metadata["title"] = filename
    metadata["source_filename"] = filename
    metadata["file_name"] = filename
    metadata.setdefault("source_path", str(document_entry.get("path") or base_metadata.get("source_path") or base_metadata.get("document_path") or saved_path))
    if document_id:
        metadata["document_id"] = document_id
        metadata["viewer_id"] = document_id
    if document_entry.get("path"):
        metadata["storage_key"] = str(document_entry.get("path"))
    metadata["source_sha256"] = file_sha256(saved_path)
    return metadata


def _int_like(value: Any) -> str | None:
    if value in (None, ""):
        return None
    text = str(value).strip()
    return text if text.isdigit() else None


def _normalize_document_metadata(metadata: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(metadata)
    normalized.setdefault("source_type", "internal_document")
    normalized.setdefault("doc_type", "internal_document")
    normalized.setdefault("document_type", "internal_document")
    normalized.setdefault("viewer_type", "document")

    document_id = _int_like(normalized.get("document_id"))
    viewer_id = _int_like(normalized.get("viewer_id"))
    if document_id and not viewer_id:
        normalized["viewer_id"] = document_id
    elif viewer_id and not document_id:
        normalized["document_id"] = viewer_id

    return normalized


def _prepare_uploads(files: list[UploadedDocument], raw_dir: Path, pdf_dir: Path, metadata: dict[str, Any]) -> dict[str, Any]:
    raw_dir.mkdir(parents=True, exist_ok=True)
    pdf_dir.mkdir(parents=True, exist_ok=True)
    saved: list[dict[str, Any]] = []
    conversions: list[dict[str, Any]] = []
    metadata_by_source_filename: dict[str, dict[str, Any]] = {}

    for index, upload in enumerate(files, start=1):
        original_suffix = Path(upload.filename or "").suffix.lower()
        if original_suffix not in ALLOWED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {upload.filename}. Allowed: .pdf, .docx, .txt")

        filename = _safe_filename(upload.filename, index, original_suffix)
        path = raw_dir / filename
        path.write_bytes(upload.content)
        per_file_metadata = _file_metadata(metadata, upload, path, index)
        saved_record = {
            "original_filename": upload.filename,
            "saved_filename": filename,
            "saved_path": str(path),
            "extension": original_suffix,
            "bytes": len(upload.content),
        }

        # 모든 문서는 파서(kordoc) -> 부모-자식 청커를 같은 경로로 거친다.
        target = pdf_dir / filename
        shutil.copy2(path, target)
        saved_record["parser_input"] = str(target)
        per_file_metadata["source_file_extension"] = original_suffix
        metadata_by_source_filename[target.name] = per_file_metadata

        saved.append(saved_record)

    return {
        "saved_files": saved,
        "conversions": conversions,
        "metadata_by_source_filename": metadata_by_source_filename,
    }


def ingest_uploaded_documents(
    files: list[UploadedDocument],
    metadata_json: str | None = None,
    qdrant_url: str | None = None,
    qdrant_api_key: str | None = None,
    collection: str | None = None,
    embedding_provider: str = "huggingface",
    embedding_model: str | None = None,
    device: str = "auto",
    reset: bool = False,
    skip_existing: bool = True,
    require_cuda: bool = True,
    keep_outputs: bool = False,
    embed_batch_size: int = 16,
    upsert_batch_size: int = 128,
    project_id: str | int | None = None,
) -> dict[str, Any]:
    if not files:
        raise ValueError("At least one document file is required")

    metadata = _metadata_from_json(metadata_json)
    if project_id not in (None, ""):
        metadata["project_id"] = str(project_id)
    metadata = _normalize_document_metadata(metadata)
    collection_name = collection or qdrant_collection_for_project(metadata.get("project_id"))
    started = time.perf_counter()
    work_root = Path(os.getenv("INTERNAL_DOCS_WORK_ROOT", tempfile.gettempdir())).resolve()
    work_root.mkdir(parents=True, exist_ok=True)

    # Keep the public API shape stable. Model/provider settings are resolved by
    # the running core server, while batch size is used for Qdrant writes below.
    _ = (embedding_provider, embedding_model, device, reset, skip_existing, embed_batch_size)

    with GPU_TASK_LOCK:
        job_dir = Path(tempfile.mkdtemp(prefix="hpm_internal_docs_", dir=str(work_root)))
        raw_dir = job_dir / "uploads"
        pdf_dir = job_dir / "pdf_data"
        parsed_dir = job_dir / "parsed"
        chunks_dir = job_dir / "chunks"

        try:
            prepared = _prepare_uploads(files, raw_dir, pdf_dir, metadata)

            parser_results: list[dict[str, Any]] = []
            chunker_results: list[dict[str, Any]] = []
            all_chunks: list[dict[str, Any]] = []
            upserted = 0

            if any(path.is_file() for path in pdf_dir.iterdir()):
                pdf_result = ingest_pdf_chunks(
                    pdf_dir=pdf_dir,
                    parsed_dir=parsed_dir,
                    chunks_dir=chunks_dir,
                    metadata=metadata,
                    metadata_by_source_filename=prepared["metadata_by_source_filename"],
                    require_cuda=require_cuda,
                    qdrant_url=qdrant_url,
                    qdrant_api_key=qdrant_api_key,
                    collection=collection_name,
                    upsert_batch_size=upsert_batch_size,
                )
                parser_results.append(pdf_result["parser"])
                chunker_results.append(pdf_result["chunker"])
                all_chunks.extend(pdf_result["chunks"])
                upserted += int(pdf_result["upserted"])

            return {
                "elapsed_sec": round(time.perf_counter() - started, 3),
                "job_dir": str(job_dir) if keep_outputs else None,
                "keep_outputs": keep_outputs,
                "saved_files": prepared["saved_files"],
                "conversions": prepared["conversions"],
                "parser": parser_results[0] if len(parser_results) == 1 else {"results": parser_results},
                "chunker": chunker_results[0] if len(chunker_results) == 1 else {"results": chunker_results},
                "chunks": all_chunks,
                "upserted": upserted,
                "qdrant_collection": collection_name,
            }
        finally:
            if not keep_outputs:
                shutil.rmtree(job_dir, ignore_errors=True)
