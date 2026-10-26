from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
import threading
import time
from typing import Any
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from config import EMBEDDING_DEVICE, EMBEDDING_MODEL_ID, EMBEDDING_PROVIDER

from .service import ALLOWED_EXTENSIONS, UploadedDocument, ingest_uploaded_documents


router = APIRouter(prefix="/internal-docs", tags=["internal-docs"])
INGEST_JOBS: dict[str, dict[str, Any]] = {}
INGEST_JOBS_LOCK = threading.Lock()
INGEST_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.getenv("INTERNAL_DOCS_JOB_WORKERS", "1")))


def _now_ts() -> float:
    return round(time.time(), 3)


def _job_snapshot(job_id: str) -> dict[str, Any]:
    with INGEST_JOBS_LOCK:
        job = INGEST_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Internal document ingest job not found: {job_id}")
        return dict(job)


def _update_ingest_job(job_id: str, **updates: Any) -> None:
    with INGEST_JOBS_LOCK:
        job = INGEST_JOBS.get(job_id)
        if job is None:
            return
        job.update(updates)
        job["updated_at"] = _now_ts()


def _serialize_error(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    return str(exc)


async def _collect_uploads(files: list[UploadFile]) -> list[UploadedDocument]:
    uploads: list[UploadedDocument] = []
    for file in files:
        filename = file.filename or ""
        if not any(filename.lower().endswith(extension) for extension in ALLOWED_EXTENSIONS):
            raise HTTPException(status_code=400, detail=f"Only PDF, HWP, HWPX, DOCX, and TXT files are supported: {filename}")
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {filename}")
        uploads.append(UploadedDocument(filename=filename, content=content))
    return uploads


def _ingest_uploads(
    uploads: list[UploadedDocument],
    metadata: str,
    qdrant_url: str | None,
    qdrant_api_key: str | None,
    collection: str | None,
    embedding_provider: str,
    embedding_model: str | None,
    device: str,
    reset: bool,
    skip_existing: bool,
    require_cuda: bool,
    keep_outputs: bool,
    embed_batch_size: int,
    upsert_batch_size: int,
    project_id: str,
) -> dict[str, Any]:
    return ingest_uploaded_documents(
        uploads,
        metadata,
        qdrant_url,
        qdrant_api_key,
        collection,
        embedding_provider,
        embedding_model,
        device,
        reset,
        skip_existing,
        require_cuda,
        keep_outputs,
        embed_batch_size,
        upsert_batch_size,
        project_id,
    )


def _run_ingest_job(job_id: str, uploads: list[UploadedDocument], params: dict[str, Any]) -> None:
    _update_ingest_job(job_id, status="running", step="ingest", started_at=_now_ts())
    started = time.perf_counter()
    try:
        result = _ingest_uploads(uploads, **params)
        _update_ingest_job(
            job_id,
            status="succeeded",
            step="done",
            result=result,
            elapsed_sec=round(time.perf_counter() - started, 3),
            error=None,
            completed_at=_now_ts(),
        )
    except Exception as exc:
        _update_ingest_job(
            job_id,
            status="failed",
            step="failed",
            error=_serialize_error(exc),
            elapsed_sec=round(time.perf_counter() - started, 3),
            completed_at=_now_ts(),
        )


@router.post("/ingest")
async def ingest_internal_documents(
    files: list[UploadFile] = File(...),
    metadata: str = Form("{}"),
    project_id: str = Form(""),
    qdrant_url: str | None = Form(None),
    qdrant_api_key: str | None = Form(None),
    collection: str | None = Form(None),
    embedding_provider: str = Form(EMBEDDING_PROVIDER),
    embedding_model: str | None = Form(EMBEDDING_MODEL_ID),
    device: str = Form(EMBEDDING_DEVICE),
    reset: bool = Form(False),
    skip_existing: bool = Form(True),
    require_cuda: bool = Form(True),
    keep_outputs: bool = Form(False),
    embed_batch_size: int = Form(16),
    upsert_batch_size: int = Form(128),
) -> dict[str, Any]:
    uploads = await _collect_uploads(files)

    try:
        result = await run_in_threadpool(
            _ingest_uploads,
            uploads,
            metadata,
            qdrant_url,
            qdrant_api_key,
            collection,
            embedding_provider,
            embedding_model,
            device,
            reset,
            skip_existing,
            require_cuda,
            keep_outputs,
            embed_batch_size,
            upsert_batch_size,
            project_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Internal document ingest failed: {exc}") from exc

    return {"result": result}


@router.post("/ingest/jobs", status_code=202)
async def create_internal_documents_ingest_job(
    files: list[UploadFile] = File(...),
    metadata: str = Form("{}"),
    project_id: str = Form(""),
    qdrant_url: str | None = Form(None),
    qdrant_api_key: str | None = Form(None),
    collection: str | None = Form(None),
    embedding_provider: str = Form(EMBEDDING_PROVIDER),
    embedding_model: str | None = Form(EMBEDDING_MODEL_ID),
    device: str = Form(EMBEDDING_DEVICE),
    reset: bool = Form(False),
    skip_existing: bool = Form(True),
    require_cuda: bool = Form(True),
    keep_outputs: bool = Form(False),
    embed_batch_size: int = Form(16),
    upsert_batch_size: int = Form(128),
) -> dict[str, Any]:
    uploads = await _collect_uploads(files)
    job_id = uuid.uuid4().hex
    params = {
        "metadata": metadata,
        "qdrant_url": qdrant_url,
        "qdrant_api_key": qdrant_api_key,
        "collection": collection,
        "embedding_provider": embedding_provider,
        "embedding_model": embedding_model,
        "device": device,
        "reset": reset,
        "skip_existing": skip_existing,
        "require_cuda": require_cuda,
        "keep_outputs": keep_outputs,
        "embed_batch_size": embed_batch_size,
        "upsert_batch_size": upsert_batch_size,
        "project_id": project_id,
    }
    job = {
        "job_id": job_id,
        "type": "internal_docs_ingest",
        "status": "queued",
        "step": "queued",
        "result": None,
        "elapsed_sec": None,
        "error": None,
        "files": [upload.filename for upload in uploads],
        "created_at": _now_ts(),
        "updated_at": _now_ts(),
        "started_at": None,
        "completed_at": None,
    }
    with INGEST_JOBS_LOCK:
        INGEST_JOBS[job_id] = job
    INGEST_JOB_EXECUTOR.submit(_run_ingest_job, job_id, uploads, params)
    return _job_snapshot(job_id)


@router.get("/ingest/jobs/{job_id}")
def get_internal_documents_ingest_job(job_id: str) -> dict[str, Any]:
    return _job_snapshot(job_id)
