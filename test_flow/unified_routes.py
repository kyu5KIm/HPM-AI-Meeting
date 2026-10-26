from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import os
import tempfile
import threading
import time
from typing import Any
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from starlette.concurrency import run_in_threadpool

from config import (
    OCR_JOB_WORKERS,
    OCR_MODEL_ID,
    STT_BATCH_SIZE,
    STT_ENABLE_ALIGN,
    STT_ENABLE_DIARIZE,
    STT_JOB_WORKERS,
    STT_MODEL_ID,
)
from model_runtime import cleanup_cuda, ocr_file_bytes, transcribe_audio_file
from schemas import TextResponse
from term_correction import apply_stt_term_corrections, merge_term_corrections


router = APIRouter()

STT_JOBS: dict[str, dict[str, Any]] = {}
OCR_JOBS: dict[str, dict[str, Any]] = {}
STT_JOBS_LOCK = threading.Lock()
OCR_JOBS_LOCK = threading.Lock()
STT_TASK_LOCK = threading.Lock()
OCR_TASK_LOCK = threading.Lock()
STT_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=STT_JOB_WORKERS)
OCR_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=OCR_JOB_WORKERS)


def _now_ts() -> float:
    return round(time.time(), 3)


def _serialize_error(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    return str(exc)


def _job_snapshot(store: dict[str, dict[str, Any]], lock: threading.Lock, job_id: str, label: str) -> dict[str, Any]:
    with lock:
        job = store.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"{label} job not found: {job_id}")
        return dict(job)


def _update_job(store: dict[str, dict[str, Any]], lock: threading.Lock, job_id: str, **updates: Any) -> None:
    with lock:
        job = store.get(job_id)
        if job is None:
            return
        job.update(updates)
        job["updated_at"] = _now_ts()


def _response_dict(response: TextResponse) -> dict[str, Any]:
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()


def format_timestamp(seconds: float) -> str:
    seconds = max(0, int(float(seconds or 0)))
    h = seconds // 3600
    m = (seconds % 3600) // 60
    s = seconds % 60
    if h > 0:
        return f"{h:02d}:{m:02d}:{s:02d}"
    return f"{m:02d}:{s:02d}"


def transcribe_audio_bytes(
    file_bytes: bytes,
    filename: str,
    *,
    language: str,
    align: bool,
    diarize: bool,
    batch_size: int,
    participants: str,
) -> dict[str, Any]:
    suffix = os.path.splitext(filename or "")[1] or ".webm"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        with STT_TASK_LOCK:
            result = transcribe_audio_file(
                tmp_path,
                language=language or None,
                batch_size=batch_size,
                align=align,
                diarize=diarize,
                hf_token=os.getenv("HF_TOKEN"),
            )

        participant_list = [name.strip() for name in participants.split(",") if name.strip()]
        full_text_lines: list[str] = []
        normalized_segments: list[dict[str, Any]] = []
        term_corrections: list[dict[str, Any]] = []

        if participant_list:
            full_text_lines.append("[참석자]")
            for name in participant_list:
                full_text_lines.append(f"- {name}")
            full_text_lines.append("")

        full_text_lines.append("[발화 전문]")
        segments = result.get("segments") or []
        for index, seg in enumerate(segments):
            if not isinstance(seg, dict):
                continue
            speaker_id = (
                seg.get("speaker")
                or seg.get("speaker_id")
                or seg.get("speaker_label")
                or seg.get("label")
                or f"SPEAKER_{index:02d}"
            )
            start = float(seg.get("start") or 0)
            start_ts = format_timestamp(start)
            text = str(seg.get("text") or seg.get("content") or "").strip()
            if not text:
                continue
            text, corrections = apply_stt_term_corrections(text)
            term_corrections.extend(corrections)
            full_text_lines.append(f"[{start_ts}] {speaker_id}: {text}")
            normalized_segments.append(
                {
                    "speaker": str(speaker_id),
                    "time": f"[{start_ts}]",
                    "start": start,
                    "end": seg.get("end"),
                    "text": text,
                    "content": text,
                }
            )

        if not normalized_segments:
            text = str(result.get("text") or "").strip()
            if text:
                text, corrections = apply_stt_term_corrections(text)
                term_corrections.extend(corrections)
                full_text_lines.append(f"[00:00] SPEAKER_00: {text}")
                normalized_segments.append(
                    {
                        "speaker": "SPEAKER_00",
                        "time": "[00:00]",
                        "start": 0,
                        "end": None,
                        "text": text,
                        "content": text,
                    }
                )

        return {
            "text": "\n".join(full_text_lines).strip(),
            "segments": normalized_segments,
            "utterances": normalized_segments,
            "language": result.get("language") or language,
            "term_corrections": merge_term_corrections(term_corrections),
        }
    except Exception:
        cleanup_cuda()
        raise
    finally:
        try:
            os.remove(tmp_path)
        except OSError:
            pass


def _run_stt_job(job_id: str, file_bytes: bytes, filename: str, params: dict[str, Any]) -> None:
    _update_job(STT_JOBS, STT_JOBS_LOCK, job_id, status="running", step="transcribe", started_at=_now_ts())
    started = time.perf_counter()
    try:
        payload = transcribe_audio_bytes(file_bytes, filename, **params)
        _update_job(
            STT_JOBS,
            STT_JOBS_LOCK,
            job_id,
            status="succeeded",
            step="done",
            result=payload,
            elapsed_sec=round(time.perf_counter() - started, 3),
            model=STT_MODEL_ID,
            error=None,
            completed_at=_now_ts(),
        )
    except Exception as exc:
        _update_job(
            STT_JOBS,
            STT_JOBS_LOCK,
            job_id,
            status="failed",
            step="failed",
            error=_serialize_error(exc),
            elapsed_sec=round(time.perf_counter() - started, 3),
            completed_at=_now_ts(),
        )


@router.post("/stt/jobs", status_code=202)
@router.post("/transcribe/jobs", status_code=202)
async def create_stt_job(
    file: UploadFile = File(...),
    language: str = Form("ko"),
    align: bool = Form(STT_ENABLE_ALIGN),
    diarize: bool = Form(STT_ENABLE_DIARIZE),
    batch_size: int = Form(STT_BATCH_SIZE),
    participants: str = Form(""),
) -> dict[str, Any]:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {file.filename or ''}")
    job_id = uuid.uuid4().hex
    params = {
        "language": language,
        "align": align,
        "diarize": diarize,
        "batch_size": batch_size,
        "participants": participants,
    }
    job = {
        "job_id": job_id,
        "type": "stt",
        "status": "queued",
        "step": "queued",
        "result": None,
        "elapsed_sec": None,
        "model": None,
        "error": None,
        "filename": file.filename or "",
        "created_at": _now_ts(),
        "updated_at": _now_ts(),
        "started_at": None,
        "completed_at": None,
    }
    with STT_JOBS_LOCK:
        STT_JOBS[job_id] = job
    STT_JOB_EXECUTOR.submit(_run_stt_job, job_id, file_bytes, file.filename or "", params)
    return _job_snapshot(STT_JOBS, STT_JOBS_LOCK, job_id, "STT")


@router.get("/stt/jobs/{job_id}")
@router.get("/transcribe/jobs/{job_id}")
def get_stt_job(job_id: str) -> dict[str, Any]:
    return _job_snapshot(STT_JOBS, STT_JOBS_LOCK, job_id, "STT")


@router.post("/stt", response_class=PlainTextResponse)
@router.post("/transcribe", response_class=PlainTextResponse)
async def stt(
    file: UploadFile = File(...),
    language: str = Form("ko"),
    align: bool = Form(STT_ENABLE_ALIGN),
    diarize: bool = Form(STT_ENABLE_DIARIZE),
    batch_size: int = Form(STT_BATCH_SIZE),
    participants: str = Form(""),
) -> str:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {file.filename or ''}")
    payload = await run_in_threadpool(
        transcribe_audio_bytes,
        file_bytes,
        file.filename or "",
        language=language,
        align=align,
        diarize=diarize,
        batch_size=batch_size,
        participants=participants,
    )
    return str(payload.get("text") or "")


def _run_ocr_bytes(file_bytes: bytes, filename: str, content_type: str) -> TextResponse:
    started = time.perf_counter()
    with OCR_TASK_LOCK:
        extracted = ocr_file_bytes(file_bytes, filename, content_type)
    return TextResponse(
        result={"text": extracted.strip()},
        elapsed_sec=round(time.perf_counter() - started, 3),
        model=OCR_MODEL_ID,
    )


def _run_ocr_job(job_id: str, file_bytes: bytes, filename: str, content_type: str) -> None:
    _update_job(OCR_JOBS, OCR_JOBS_LOCK, job_id, status="running", step="ocr", started_at=_now_ts())
    try:
        response = _run_ocr_bytes(file_bytes, filename, content_type)
        payload = _response_dict(response)
        _update_job(
            OCR_JOBS,
            OCR_JOBS_LOCK,
            job_id,
            status="succeeded",
            step="done",
            result=payload.get("result"),
            elapsed_sec=payload.get("elapsed_sec"),
            model=payload.get("model"),
            error=None,
            completed_at=_now_ts(),
        )
    except Exception as exc:
        _update_job(
            OCR_JOBS,
            OCR_JOBS_LOCK,
            job_id,
            status="failed",
            step="failed",
            error=_serialize_error(exc),
            completed_at=_now_ts(),
        )


@router.post("/ocr/jobs", status_code=202)
async def create_ocr_job(file: UploadFile = File(...)) -> dict[str, Any]:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {file.filename or ''}")
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "type": "ocr",
        "status": "queued",
        "step": "queued",
        "result": None,
        "elapsed_sec": None,
        "model": None,
        "error": None,
        "filename": file.filename or "",
        "created_at": _now_ts(),
        "updated_at": _now_ts(),
        "started_at": None,
        "completed_at": None,
    }
    with OCR_JOBS_LOCK:
        OCR_JOBS[job_id] = job
    OCR_JOB_EXECUTOR.submit(_run_ocr_job, job_id, file_bytes, file.filename or "", file.content_type or "")
    return _job_snapshot(OCR_JOBS, OCR_JOBS_LOCK, job_id, "OCR")


@router.get("/ocr/jobs/{job_id}")
def get_ocr_job(job_id: str) -> dict[str, Any]:
    return _job_snapshot(OCR_JOBS, OCR_JOBS_LOCK, job_id, "OCR")


@router.post("/ocr", response_model=TextResponse)
async def ocr(file: UploadFile = File(...)) -> TextResponse:
    file_bytes = await file.read()
    if not file_bytes:
        raise HTTPException(status_code=400, detail=f"Uploaded file is empty: {file.filename or ''}")
    return await run_in_threadpool(_run_ocr_bytes, file_bytes, file.filename or "", file.content_type or "")
