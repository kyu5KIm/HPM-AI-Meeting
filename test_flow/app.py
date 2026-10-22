from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import logging
import os
import re
import threading
import time
from typing import Any
import uuid

try:
    import torch
except Exception:
    class _Cuda:
        @staticmethod
        def is_available() -> bool:
            return False

    class _Torch:
        cuda = _Cuda()

    torch = _Torch()
from fastapi import FastAPI, HTTPException

from config import (
    EMBEDDING_MODEL_ID,
    FEATURE_CHAT_DIR,
    LLAMA_N_GPU_LAYERS,
    PRELOAD_EMBEDDING_MODEL,
    PRELOAD_TEXT_MODEL,
    QDRANT_COLLECTION,
    QDRANT_COLLECTION_PREFIX,
    QDRANT_COLLECTION_PROJECT_MODE,
    QDRANT_URL,
    TEXT_BACKEND,
    TEXT_GGUF_FILENAME,
    TEXT_GGUF_REPO,
    TEXT_MODEL_ID,
    qdrant_collection_for_project,
)
from meeting_ingest import ingest_meeting_minutes
from model_runtime import cleanup_cuda, generate_json, load_embedding_model, load_text_model
from news import search_preparation_news
from prompts import agenda_messages, chat_intent_messages, chat_messages, general_chat_messages, minutes_messages, preparation_messages
from retrieval import feature_chat_retrieve, invalidate_feature_chat_rag, load_feature_chat_rag, select_preparation_documents
from schemas import AgendaRequest, ChatRequest, MinutesRequest, PreparationRequest, TextResponse


app = FastAPI(title="HPM Core LLM/RAG Server", version="1.0.0")
logger = logging.getLogger("uvicorn.error")
NO_RELATED_DOCS_MESSAGE = "관련 문서에서 확인할 수 있는 내용이 없습니다."
DOCUMENT_INTENT_KEYWORDS = [
    "문서",
    "자료",
    "파일",
    "업로드",
    "첨부",
    "문건",
    "출처",
    "근거",
    "회의",
    "회의록",
    "이전 회의",
    "프로젝트",
    "결정",
    "결정사항",
    "담당자",
    "마감",
    "업무",
    "태스크",
    "jira",
    "지라",
    "계약",
    "정책",
    "규정",
    "요구사항",
    "내용",
    "요약",
    "정리",
    "찾",
    "검색",
    "보고서",
    "pdf",
    "동향",
    "공고",
    "제안서",
    "명세서",
]
GENERAL_INTENT_KEYWORDS = [
    "안녕",
    "고마워",
    "감사",
    "뭐해",
    "누구야",
    "설명해줘",
    "알려줘",
    "추천",
    "아이디어",
    "문장",
    "다듬어",
    "번역",
    "영어로",
    "코드",
]
PROJECT_RAG_PROBE_KEYWORDS = [
    "문서",
    "자료",
    "파일",
    "업로드",
    "첨부",
    "문건",
    "회의",
    "회의록",
    "프로젝트",
    "내용",
    "요약",
    "정리",
    "찾",
    "검색",
    "보고서",
    "pdf",
    ".pdf",
    "동향",
    "공고",
    "제안서",
    "명세서",
    "결정",
    "담당",
    "마감",
    "jira",
    "지라",
]
PURE_GENERAL_CHAT_PATTERNS = [
    "안녕",
    "안녕하세요",
    "하이",
    "hello",
    "고마워",
    "감사",
    "뭐해",
    "누구야",
]
MINUTES_JOBS: dict[str, dict[str, Any]] = {}
MINUTES_JOBS_LOCK = threading.Lock()
MINUTES_JOB_EXECUTOR = ThreadPoolExecutor(max_workers=int(os.getenv("MINUTES_JOB_WORKERS", "1")))


def _now_ts() -> float:
    return round(time.time(), 3)


def _job_snapshot(job_id: str) -> dict[str, Any]:
    with MINUTES_JOBS_LOCK:
        job = MINUTES_JOBS.get(job_id)
        if job is None:
            raise HTTPException(status_code=404, detail=f"Generate minutes job not found: {job_id}")
        return dict(job)


def _update_minutes_job(job_id: str, **updates: Any) -> None:
    with MINUTES_JOBS_LOCK:
        job = MINUTES_JOBS.get(job_id)
        if job is None:
            return
        job.update(updates)
        job["updated_at"] = _now_ts()


def _serialize_error(exc: Exception) -> str:
    if isinstance(exc, HTTPException):
        return str(exc.detail)
    return str(exc)


def _text_response_dict(response: TextResponse) -> dict[str, Any]:
    if hasattr(response, "model_dump"):
        return response.model_dump()
    return response.dict()


def compact_documents(items: list[dict[str, Any]], *, limit: int = 3, text_chars: int = 700) -> list[dict[str, Any]]:
    compacted = []
    for item in items[:limit]:
        if not isinstance(item, dict):
            continue
        compacted.append(
            {
                "source": str(item.get("source") or item.get("title") or "unknown")[:180],
                "text": str(item.get("text") or item.get("content") or "")[:text_chars],
                "category": str(item.get("category") or item.get("source_type") or "")[:80],
                "url": str(item.get("url") or item.get("link") or "")[:500],
                "chunk_id": str(item.get("chunk_id") or "")[:180],
                "metadata": item.get("metadata") if isinstance(item.get("metadata"), dict) else {},
            }
        )
    return compacted


def build_news_context(items: list[dict[str, Any]], *, max_chars: int = 3000) -> str:
    parts: list[str] = []
    used = 0
    for index, item in enumerate(items, 1):
        title = str(item.get("title") or item.get("source") or "뉴스")
        text = str(item.get("text") or item.get("description") or "")
        url = str(item.get("url") or item.get("link") or item.get("source") or "")
        pub_date = str(item.get("pub_date") or item.get("pubDate") or "")
        block = f"[N{index}] 뉴스: {title}\n날짜: {pub_date or '미정'}\n요약: {text}\nURL: {url}"
        if used + len(block) > max_chars:
            block = block[: max(0, max_chars - used)].rstrip()
        if block:
            parts.append(block)
            used += len(block) + 2
        if used >= max_chars:
            break
    return "\n\n".join(parts)


def news_source_references(items: list[dict[str, Any]]) -> list[str]:
    refs: list[str] = []
    for index, item in enumerate(items, 1):
        title = str(item.get("title") or "뉴스")
        url = str(item.get("url") or item.get("link") or item.get("source") or "")
        refs.append(f"[{index}] {title} | {url}".strip())
    return refs

def preparation_sources(selected_documents: dict[str, Any]) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for category in ["previous_meetings", "internal_documents", "external_news"]:
        for item in selected_documents.get(category, []):
            if not isinstance(item, dict):
                continue
            label = str(item.get("source") or item.get("title") or "unknown")
            url = str(item.get("url") or item.get("link") or "")
            chunk_id = str(item.get("chunk_id") or "")
            metadata = item.get("metadata") if isinstance(item.get("metadata"), dict) else {}
            viewer_type = str(metadata.get("viewer_type") or "")
            viewer_id = str(metadata.get("viewer_id") or "")
            if viewer_type == "document" and not viewer_id:
                viewer_id = str(metadata.get("document_id") or "")
            if not viewer_type:
                if category == "previous_meetings":
                    viewer_type = "meeting_minutes"
                    viewer_id = str(metadata.get("meeting_id") or "")
                elif category == "internal_documents":
                    viewer_type = "document"
                    viewer_id = str(metadata.get("document_id") or "")
                elif category == "external_news":
                    viewer_type = "external_url"
            viewer: dict[str, Any] = {"type": viewer_type}
            if viewer_id:
                viewer["id"] = viewer_id
            doc_id = metadata.get("doc_id")
            if doc_id:
                viewer["doc_id"] = str(doc_id)
            if metadata.get("project_id"):
                viewer["project_id"] = str(metadata.get("project_id"))
            page = metadata.get("page") or metadata.get("page_number") or metadata.get("page_no") or metadata.get("page_idx")
            if page is not None:
                viewer["page"] = page
            if url:
                viewer["url"] = url
            key = (category, label, url or chunk_id)
            if key in seen:
                continue
            seen.add(key)
            sources.append(
                {
                    "label": label,
                    "category": str(item.get("category") or category),
                    "chunk_id": chunk_id,
                    "viewer": viewer,
                    "metadata": metadata,
                }
            )
    return sources


def _coerce_int_or_none(value: Any) -> int | None:
    if value in (None, ""):
        return None
    try:
        return int(str(value))
    except (TypeError, ValueError):
        return None


def _clean_text(value: Any) -> str:
    return str(value or "").strip()


def _normalize_preparation_field(value: Any) -> str:
    text = _clean_text(value)
    if not text or text in {"확인 필요", "확인필요"}:
        return "-"
    return text


def _source_document_id(source: dict[str, Any]) -> int | None:
    viewer = source.get("viewer") if isinstance(source.get("viewer"), dict) else {}
    metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
    for value in [viewer.get("id"), metadata.get("viewer_id"), metadata.get("document_id"), source.get("document_id")]:
        document_id = _coerce_int_or_none(value)
        if document_id is not None:
            return document_id
    return None


def preparation_response_sources(sources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    compacted: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str]] = set()
    for source in sources:
        if not isinstance(source, dict):
            continue
        document_id = _source_document_id(source)
        metadata = source.get("metadata") if isinstance(source.get("metadata"), dict) else {}
        viewer = source.get("viewer") if isinstance(source.get("viewer"), dict) else {}
        chunk_id = _clean_text(source.get("chunk_id") or metadata.get("chunk_id"))
        title = _clean_text(
            source.get("label")
            or source.get("title")
            or source.get("source")
            or metadata.get("title")
            or metadata.get("source_filename")
            or metadata.get("file_name")
            or (f"document_{document_id}" if document_id is not None else "unknown")
        )
        category = _clean_text(source.get("category") or metadata.get("category") or viewer.get("type"))
        key = (str(document_id or ""), chunk_id, title)
        if key in seen:
            continue
        seen.add(key)

        item: dict[str, Any] = {
            "title": title,
            "document_id": document_id,
        }
        if chunk_id:
            item["chunk_id"] = chunk_id
        if category:
            item["category"] = category
        doc_id = _clean_text(metadata.get("doc_id") or viewer.get("doc_id") or source.get("doc_id"))
        if doc_id:
            item["doc_id"] = doc_id
        source_sha256 = _clean_text(metadata.get("source_sha256") or source.get("source_sha256"))
        if source_sha256:
            item["source_sha256"] = source_sha256
        page = viewer.get("page") or metadata.get("page") or metadata.get("page_number") or metadata.get("page_no") or metadata.get("page_idx")
        if page is not None:
            item["page"] = page
        if viewer:
            item["viewer"] = viewer
        compacted.append(item)
    return compacted


def _append_field(fields: dict[str, str], key: str, value: Any) -> None:
    text = _clean_text(value)
    if not text:
        return
    if fields[key]:
        fields[key] = f"{fields[key]}\n\n{text}"
    else:
        fields[key] = text


def _preparation_field_for_title(title: str) -> str | None:
    normalized = title.lower()
    if "목적" in normalized:
        return "purpose"
    if any(keyword in normalized for keyword in ["현재 상태", "상태", "이전 회의", "회의 맥락", "논의 사항", "진행"]):
        return "project_status"
    if any(keyword in normalized for keyword in ["규정", "제약", "근거", "리스크", "확인 필요", "내부 문서"]):
        return "rule"
    if any(keyword in normalized for keyword in ["기대", "결과", "준비사항", "회의 전 준비", "효과"]):
        return "effect"
    return None

def _extract_markdown_sections(text: str) -> list[dict[str, str]]:
    sections: list[dict[str, str]] = []
    current_title = ""
    current_lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        match = re.match(r"^\s*#{2,6}\s*(?:\d+\.\s*)?(.+?)\s*$", line)
        if match:
            if current_title or current_lines:
                sections.append({"title": current_title, "content": "\n".join(current_lines).strip()})
            current_title = match.group(1).strip()
            current_lines = []
        else:
            current_lines.append(line)
    if current_title or current_lines:
        sections.append({"title": current_title, "content": "\n".join(current_lines).strip()})
    return sections


def _preparation_markdown_from_fields(fields: dict[str, str]) -> str:
    return "\n".join(
        [
            "### 회의 준비자료",
            "",
            "#### 1. 회의 목적",
            fields.get("purpose", ""),
            "",
            "#### 2. 프로젝트 현재 상태",
            fields.get("project_status", ""),
            "",
            "#### 3. 관련 규정 및 제약사항",
            fields.get("rule", ""),
            "",
            "#### 4. 회의 종료 후 기대 결과",
            fields.get("effect", ""),
        ]
    ).strip()

def normalize_preparation_response(
    req: PreparationRequest,
    raw_result: Any,
    sources: list[dict[str, Any]],
) -> dict[str, Any]:
    result = raw_result if isinstance(raw_result, dict) else {}
    fields = {
        "purpose": _clean_text(result.get("purpose")),
        "project_status": _clean_text(result.get("project_status")),
        "rule": _clean_text(result.get("rule")),
        "effect": _clean_text(result.get("effect")),
    }

    for section in result.get("sections") if isinstance(result.get("sections"), list) else []:
        if not isinstance(section, dict):
            continue
        field_name = _preparation_field_for_title(_clean_text(section.get("title")))
        if field_name:
            _append_field(fields, field_name, section.get("content"))

    document_text = _clean_text(result.get("text") or result.get("document"))
    if document_text:
        for section in _extract_markdown_sections(document_text):
            field_name = _preparation_field_for_title(section["title"])
            if field_name:
                _append_field(fields, field_name, section["content"])

    if document_text and not any(fields.values()):
        fields["purpose"] = document_text

    for key in ["purpose", "project_status", "rule", "effect"]:
        fields[key] = _normalize_preparation_field(fields.get(key))

    meeting_id = _coerce_int_or_none(req.meeting_id)
    preparation_id = _coerce_int_or_none(getattr(req, "preparation_id", None))
    normalized = {
        "preparation_id": preparation_id,
        "meeting_id": meeting_id if meeting_id is not None else req.meeting_id,
        "purpose": fields["purpose"],
        "project_status": fields["project_status"],
        "rule": fields["rule"],
        "effect": fields["effect"],
        "sources": preparation_response_sources(sources),
    }
    normalized["text"] = document_text or _preparation_markdown_from_fields(fields)
    return normalized


def simple_preparation_result(
    req: PreparationRequest,
    selected_documents: dict[str, Any],
    *,
    error: str = "",
) -> dict[str, Any]:
    agendas = [str(item) for item in req.agendas if str(item).strip()]
    agenda_text = "\n".join(f"- {item}" for item in agendas) or "- 등록된 안건이 없습니다."
    participants = [
        f"- {item.get('name', '미정')} / 역할: {item.get('work', '미정')}"
        for item in req.participants
        if isinstance(item, dict)
    ]
    participant_text = "\n".join(participants) or "- 미정"
    status_text = f"\n\n## 생성 상태\n- 자동 생성 오류: {error}" if error else ""
    text = (
        f"# {req.title or '회의'} 준비자료\n\n"
        f"## 참석자\n{participant_text}\n\n"
        f"## 안건\n{agenda_text}\n\n"
        f"## 준비 체크포인트\n"
        f"- 안건별로 결정해야 할 항목을 사전에 정리합니다.\n"
        f"- 참석자별 확인 자료와 예상 질문을 준비합니다."
        f"{status_text}"
    )
    return {
        "text": text,
        "sources": preparation_sources(selected_documents),
    }


def fallback_preparation_result(
    req: PreparationRequest,
    selected_documents: dict[str, Any],
    *,
    error: str,
) -> dict[str, Any]:
    meeting_datetime = getattr(req, "meeting_datetime", "") or "미정"
    location = getattr(req, "location", "") or "미정"
    agendas = [str(item) for item in req.agendas if str(item).strip()]
    agenda_text = "\n".join(f"- {item}" for item in agendas) or "- 등록된 안건이 없습니다."
    participants = [
        f"- {item.get('name', '미정')} / 직무: {item.get('work', '미정')}"
        for item in req.participants
        if isinstance(item, dict)
    ]
    participant_text = "\n".join(participants) or "- 미정"
    source_count = sum(
        len(selected_documents.get(key, []))
        for key in ["previous_meetings", "internal_documents", "external_news"]
    )
    document = (
        f"# {req.title or '회의'} 준비자료\n\n"
        f"## 회의 정보\n"
        f"- 일시: {meeting_datetime}\n"
        f"- 장소: {location}\n\n"
        f"## 참석자\n{participant_text}\n\n"
        f"## 안건\n{agenda_text}\n\n"
        f"## 준비 체크포인트\n"
        f"- 안건별 목표와 결정해야 할 항목을 사전에 정리합니다.\n"
        f"- 참석자별 사전 확인 자료와 예상 질문을 준비합니다.\n"
        f"- 회의 후 제출물, 담당자, 마감일을 기록할 수 있도록 준비합니다.\n\n"
        f"## 참고자료 상태\n"
        f"- 선택된 참고자료 수: {source_count}\n"
        f"- 자동 생성 오류: {error}"
    )
    return {
        "document": document,
        "sections": [
            {"title": "회의 정보", "content": f"일시: {meeting_datetime}\n장소: {location}", "sources": []},
            {"title": "안건", "content": agenda_text, "sources": []},
            {"title": "준비 체크포인트", "content": "안건별 목표, 결정 항목, 참석자별 사전 확인 자료를 준비합니다.", "sources": []},
        ],
        "selected_documents": selected_documents,
        "source_map": [],
        "fallback_error": error,
    }


def strip_answer_source_section(answer: str) -> str:
    text = str(answer or "")
    for marker in ["\n출처:", "\n출처：", "\nSources:", "\nSource:"]:
        index = text.find(marker)
        if index >= 0:
            return text[:index].rstrip()
    return text


def _strip_chat_source_section(answer: str) -> str:
    return strip_answer_source_section(answer)

def _used_context_ids(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    ids: list[int] = []
    for item in value:
        try:
            number = int(str(item).strip())
        except (TypeError, ValueError):
            continue
        if number > 0 and number not in ids:
            ids.append(number)
    return ids


def _answer_has_no_evidence(answer: str) -> bool:
    text = str(answer or "").strip().lower()
    if not text:
        return True
    return any(
        keyword in text
        for keyword in [
            "제공된 자료에서 확인할 수 없습니다",
            "관련 문서에서 확인할 수 있는 내용이 없습니다",
            "확인할 수 없습니다",
            "자료에서 확인되지",
            "근거가 부족",
            "근거 없음",
        ]
    )

def _sources_for_used_context_ids(sources: list[str], used_ids: list[int]) -> list[str]:
    numbered_sources: dict[int, str] = {}
    for index, source in enumerate(sources, 1):
        text = str(source).strip()
        if not text:
            continue
        match = re.match(r"^\[(\d+)\]\s*(.+)$", text)
        if match:
            numbered_sources[int(match.group(1))] = text
        else:
            numbered_sources[index] = f"[{index}] {text}"

    selected: list[str] = []
    for used_id in used_ids:
        source = numbered_sources.get(used_id)
        if source and source not in selected:
            selected.append(source)
    return selected


def normalize_chat_sources(result: Any, sources: list[str], *, rag_used: bool) -> Any:
    if not isinstance(result, dict):
        return result

    normalized_sources = [str(source).strip() for source in sources if str(source).strip()]
    if not rag_used or not normalized_sources:
        result["citations"] = []
        if isinstance(result.get("answer"), str):
            result["answer"] = _strip_chat_source_section(result["answer"])
        return result

    answer = str(result.get("answer") or "")
    used_ids = _used_context_ids(result.get("used_context_ids"))
    confidence = str(result.get("confidence") or "").strip().lower()
    if not used_ids or confidence == "low" or _answer_has_no_evidence(answer):
        result["citations"] = []
        if isinstance(result.get("answer"), str):
            result["answer"] = _strip_chat_source_section(result["answer"])
        return result

    selected_sources = _sources_for_used_context_ids(normalized_sources, used_ids)
    result["citations"] = selected_sources
    if selected_sources:
        answer_without_sources = _strip_chat_source_section(answer)
        result["answer"] = f"{answer_without_sources}\n\n출처:\n" + "\n".join(selected_sources)
    return result


def _is_document_existence_question(question: str) -> bool:
    text = str(question or "").lower()
    if any(keyword in text for keyword in ["내용", "요약", "정리", "알려", "설명", "뭐", "무엇", "찾", "검색"]):
        return False
    has_document_target = any(keyword in text for keyword in ["파일", "문서", "자료", "pdf"])
    has_existence_intent = any(
        keyword in text
        for keyword in ["있어", "있나", "존재", "등록", "적재", "올라", "업로드됐", "업로드되", "저장"]
    )
    return has_document_target and has_existence_intent


def _document_lookup_result(req: ChatRequest, rag_info: dict[str, Any]) -> dict[str, Any] | None:
    if not rag_info.get("document_lookup") or not _is_document_existence_question(req.question):
        return None
    matches = [str(item).strip() for item in rag_info.get("document_lookup_matches") or [] if str(item).strip()]
    if not matches:
        return {
            "answer": "해당 파일명과 일치하는 문서를 찾지 못했습니다.",
            "citations": [],
            "used_context_ids": [],
            "confidence": "low",
        }
    if len(matches) == 1:
        answer = "해당 파일은 등록된 문서에서 확인됩니다.\n\n출처:\n" + matches[0]
    else:
        answer = "해당 파일명과 일치하는 문서를 확인했습니다.\n\n출처:\n" + "\n".join(matches)
    return {
        "answer": answer,
        "citations": matches,
        "used_context_ids": list(range(1, len(matches) + 1)),
        "confidence": "high",
    }


def _chat_intent_fallback(req: ChatRequest, *, error: str = "") -> dict[str, Any]:
    question = str(req.question or "").lower()
    has_document_signal = any(keyword in question for keyword in DOCUMENT_INTENT_KEYWORDS)
    has_general_signal = any(keyword in question for keyword in GENERAL_INTENT_KEYWORDS)
    if has_document_signal and not has_general_signal:
        intent = "document_question"
        confidence = "medium"
    elif has_general_signal and not has_document_signal:
        intent = "general_chat"
        confidence = "medium"
    elif has_document_signal:
        intent = "ambiguous"
        confidence = "low"
    else:
        intent = "general_chat"
        confidence = "low"
    return {
        "intent": intent,
        "confidence": confidence,
        "reason": "fallback keyword routing",
        "classification_error": error,
    }


def classify_chat_intent(req: ChatRequest) -> dict[str, Any]:
    if req.context.strip():
        return {
            "intent": "document_question",
            "confidence": "high",
            "reason": "explicit context was provided",
        }
    try:
        raw = generate_json(chat_intent_messages(req), max_new_tokens=256)
    except Exception as exc:
        cleanup_cuda()
        return _chat_intent_fallback(req, error=str(exc))
    if not isinstance(raw, dict):
        return _chat_intent_fallback(req, error="intent classifier returned non-object")
    intent = str(raw.get("intent") or "").strip().lower()
    if intent not in {"document_question", "general_chat", "ambiguous"}:
        fallback = _chat_intent_fallback(req, error=f"unknown intent: {intent}")
        fallback["raw_intent"] = raw
        return fallback
    confidence = str(raw.get("confidence") or "medium").strip().lower()
    if confidence not in {"high", "medium", "low"}:
        confidence = "medium"
    return {
        "intent": intent,
        "confidence": confidence,
        "reason": str(raw.get("reason") or ""),
    }


def _is_pure_general_chat_question(question: str) -> bool:
    normalized = re.sub(r"\s+", " ", question.lower()).strip()
    if not normalized:
        return True
    if len(normalized) <= 20 and any(pattern in normalized for pattern in PURE_GENERAL_CHAT_PATTERNS):
        return not any(keyword in normalized for keyword in DOCUMENT_INTENT_KEYWORDS)
    return False


def apply_project_rag_probe(req: ChatRequest, intent_info: dict[str, Any]) -> dict[str, Any]:
    intent = str(intent_info.get("intent") or "").strip().lower()
    if intent != "general_chat":
        return intent_info
    if not str(req.project_id or "").strip():
        return intent_info
    if req.context.strip():
        return intent_info

    question = str(req.question or "").lower()
    if _is_pure_general_chat_question(question):
        return intent_info

    has_probe_signal = any(keyword in question for keyword in PROJECT_RAG_PROBE_KEYWORDS)
    has_file_name_signal = bool(re.search(r"\b[\w.-]+\.(pdf|docx?|pptx?|xlsx?|txt)\b", question, re.IGNORECASE))
    if not (has_probe_signal or has_file_name_signal):
        return intent_info

    return {
        **intent_info,
        "intent": "ambiguous",
        "original_intent": intent,
        "routing_override": "project_rag_probe",
        "override_reason": "프로젝트 채팅에서 문서 조회 가능성이 큰 표현이 감지되어 RAG를 먼저 검색합니다.",
    }


def _general_chat_response(req: ChatRequest, started: float, intent_info: dict[str, Any]) -> TextResponse:
    try:
        result = generate_json(general_chat_messages(req), max_new_tokens=1024)
    except Exception as exc:
        cleanup_cuda()
        result = {
            "answer": "답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            "citations": [],
            "used_context_ids": [],
            "confidence": "low",
            "intent": "general_chat",
            "generation_error": str(exc),
        }
    if not isinstance(result, dict):
        result = {
            "answer": str(result or "").strip() or "답변 생성 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.",
            "citations": [],
            "used_context_ids": [],
            "confidence": "low",
            "intent": "general_chat",
        }
    result["citations"] = []
    result["used_context_ids"] = []
    result["intent"] = "general_chat"
    result["rag_used"] = False
    result["rag_hit_count"] = 0
    result["rag_collection"] = None
    result["intent_info"] = intent_info
    return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "status": "ok",
        "service": "core",
        "text_backend": TEXT_BACKEND,
        "text_model": TEXT_MODEL_ID,
        "text_gguf_repo": TEXT_GGUF_REPO,
        "text_gguf_filename": TEXT_GGUF_FILENAME,
        "torch_cuda": torch.cuda.is_available(),
        "llama_n_gpu_layers": LLAMA_N_GPU_LAYERS,
        "preload_text_model": PRELOAD_TEXT_MODEL,
        "qdrant_collection": QDRANT_COLLECTION,
        "qdrant_url": QDRANT_URL,
        "project_collection_mode": QDRANT_COLLECTION_PROJECT_MODE,
        "project_collection_prefix": QDRANT_COLLECTION_PREFIX,
        "project_collection_example": qdrant_collection_for_project("example"),
        "embedding_model": EMBEDDING_MODEL_ID,
        "preload_embedding_model": PRELOAD_EMBEDDING_MODEL,
        "feature_chat_dir": str(FEATURE_CHAT_DIR),
        "embedding_provider": os.getenv("EMBEDDING_PROVIDER"),
        "embedding_dimensions": os.getenv("EMBEDDING_DIMENSIONS"),
        "kure_api_configured": bool(os.getenv("KURE_API_KEY")),
        "rerank_provider": os.getenv("RERANK_PROVIDER"),
        "rerank_model": os.getenv("RERANK_MODEL"),
        "cohere_rerank_configured": bool(os.getenv("COHERE_API_KEY") or os.getenv("CO_API_KEY")),
        "rag_skip_rerank": os.getenv("RAG_SKIP_RERANK"),
        "cohere_rerank_model": os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5"),
    }


@app.on_event("startup")
def preload_models() -> None:
    if PRELOAD_TEXT_MODEL:
        load_text_model()
    if PRELOAD_EMBEDDING_MODEL:
        try:
            load_embedding_model()
        except Exception as exc:
            logger.warning("Embedding model preload failed; RAG will retry on first use: %s", exc)


def _generate_minutes_response(req: MinutesRequest) -> TextResponse:
    started = time.perf_counter()
    try:
        result = generate_json(minutes_messages(req))
        if isinstance(result, dict):
            try:
                result["qdrant_ingest"] = ingest_meeting_minutes(req, result)
                invalidate_feature_chat_rag(project_id=req.project_id)
            except Exception as ingest_exc:
                result["qdrant_ingest_error"] = str(ingest_exc)
    except Exception as exc:
        cleanup_cuda()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)


def _run_minutes_job(job_id: str, req: MinutesRequest) -> None:
    _update_minutes_job(job_id, status="running", step="generate_minutes", started_at=_now_ts())
    try:
        response = _generate_minutes_response(req)
        payload = _text_response_dict(response)
        _update_minutes_job(
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
        _update_minutes_job(
            job_id,
            status="failed",
            step="failed",
            error=_serialize_error(exc),
            completed_at=_now_ts(),
        )


@app.post("/generate-minutes/jobs", status_code=202)
def create_generate_minutes_job(req: MinutesRequest) -> dict[str, Any]:
    job_id = uuid.uuid4().hex
    job = {
        "job_id": job_id,
        "type": "generate_minutes",
        "status": "queued",
        "step": "queued",
        "result": None,
        "elapsed_sec": None,
        "model": None,
        "error": None,
        "created_at": _now_ts(),
        "updated_at": _now_ts(),
        "started_at": None,
        "completed_at": None,
    }
    with MINUTES_JOBS_LOCK:
        MINUTES_JOBS[job_id] = job
    MINUTES_JOB_EXECUTOR.submit(_run_minutes_job, job_id, req)
    return _job_snapshot(job_id)


@app.get("/generate-minutes/jobs/{job_id}")
def get_generate_minutes_job(job_id: str) -> dict[str, Any]:
    return _job_snapshot(job_id)


@app.post("/generate-minutes", response_model=TextResponse)
def generate_minutes(req: MinutesRequest) -> TextResponse:
    return _generate_minutes_response(req)


@app.post("/generate-agendas", response_model=TextResponse)
def generate_agendas(req: AgendaRequest) -> TextResponse:
    started = time.perf_counter()
    try:
        result = generate_json(agenda_messages(req), max_new_tokens=1024)
        if req.title.strip() and not result.get("agendas"):
            result = generate_json(agenda_messages(req, retry=True), max_new_tokens=1024)
    except Exception as exc:
        cleanup_cuda()
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)


def simple_preparation_result(
    req: PreparationRequest,
    selected_documents: dict[str, Any],
    *,
    error: str = "",
) -> dict[str, Any]:
    agendas = [str(item) for item in req.agendas if str(item).strip()]
    agenda_text = "\n".join(f"- {item}" for item in agendas) or "- 등록된 안건이 없습니다."
    participants = [
        f"- {item.get('name', '미정')} / 역할: {item.get('work', '미정')}"
        for item in req.participants
        if isinstance(item, dict)
    ]
    participant_text = "\n".join(participants) or "- 미정"
    status_text = "\n\n## 참고\n- 자동 생성 결과를 JSON으로 파싱하지 못해 기본 준비자료로 대체했습니다." if error else ""
    text = (
        f"# {req.title or '회의'} 준비자료\n\n"
        f"## 참석자\n{participant_text}\n\n"
        f"## 안건\n{agenda_text}\n\n"
        f"## 준비 체크포인트\n"
        f"- 안건별로 결정해야 할 항목을 사전에 정리합니다.\n"
        f"- 참석자별 확인 자료와 예상 질문을 준비합니다."
        f"{status_text}"
    )
    return {
        "text": text,
        "sources": preparation_sources(selected_documents),
    }

@app.post("/generate-preparation", response_model=TextResponse)
def generate_preparation(req: PreparationRequest) -> TextResponse:
    started = time.perf_counter()
    selected = {"query": req.title, "news_query": req.title, "previous_meetings": [], "internal_documents": []}
    previous_meetings: list[dict[str, Any]] = []
    internal_documents: list[dict[str, Any]] = []
    external_news: list[dict[str, Any]] = []
    retrieval_error = ""
    news_error = ""
    try:
        try:
            selected = select_preparation_documents(req)
            retrieval_error = ""
        except Exception as retrieval_exc:
            selected = {
                "query": " ".join(part for part in [req.title, req.project_context, " ".join(req.agendas)] if part),
                "news_query": req.title,
                "previous_meetings": [],
                "internal_documents": [],
            }
            retrieval_error = str(retrieval_exc)

        try:
            searched_news = search_preparation_news(selected.get("news_query") or selected["query"])
            news_error = ""
        except Exception as news_exc:
            searched_news = []
            news_error = str(news_exc)

        previous_meetings = compact_documents(selected["previous_meetings"])
        internal_documents = compact_documents(selected["internal_documents"])
        external_news = compact_documents(searched_news)
        selected_documents = {
            "query": selected["query"],
            "previous_meetings": previous_meetings,
            "internal_documents": internal_documents,
            "external_news": external_news,
        }
        try:
            result = generate_json(
                preparation_messages(req, selected_documents),
                max_new_tokens=int(os.getenv("PREPARATION_MAX_NEW_TOKENS", "1024")),
            )
        except Exception as generation_exc:
            result = simple_preparation_result(req, selected_documents, error=str(generation_exc))
    except Exception as exc:
        cleanup_cuda()
        selected_documents = {"query": req.title, "previous_meetings": [], "internal_documents": [], "external_news": []}
        result = simple_preparation_result(req, selected_documents, error=str(exc))
        retrieval_error = str(exc)
        news_error = ""

    if isinstance(result, dict):
        sources = preparation_sources(
            {
                "previous_meetings": previous_meetings,
                "internal_documents": internal_documents,
                "external_news": external_news,
            }
        )
        result = normalize_preparation_response(req, result, sources)
    return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)


@app.post("/chat", response_model=TextResponse)
def chat(req: ChatRequest) -> TextResponse:
    started = time.perf_counter()
    intent_info = apply_project_rag_probe(req, classify_chat_intent(req))
    intent = str(intent_info.get("intent") or "general_chat")
    if intent == "general_chat":
        return _general_chat_response(req, started, intent_info)

    context = req.context.strip()
    sources = list(req.sources)
    rag_info: dict[str, Any] | None = None
    if not context:
        chat_source_scope = req.source_scope.strip().lower()
        if chat_source_scope in {"external", "external_news", "news"}:
            chat_source_scope = "project"
        chat_source_types = [
            item
            for item in req.source_types
            if str(item).strip().lower() not in {"external", "external_news", "news"}
        ]
        try:
            rag_info = feature_chat_retrieve(
                req.question,
                project_id=req.project_id,
                meeting_id=req.meeting_id,
                source_scope=chat_source_scope,
                source_types=chat_source_types,
                max_previous_meetings=req.max_previous_meetings,
                min_relevance_score=req.min_relevance_score,
            )
            context = str(rag_info.get("context") or "")
            sources = list(rag_info.get("sources") or [])
        except Exception as exc:
            cleanup_cuda()
            if intent == "ambiguous":
                fallback_intent_info = {
                    **intent_info,
                    "rag_error": str(exc),
                    "fallback": "general_chat",
                }
                return _general_chat_response(req, started, fallback_intent_info)
            result = {
                "answer": NO_RELATED_DOCS_MESSAGE,
                "citations": [],
                "used_context_ids": [],
                "confidence": "low",
                "rag_hit_count": 0,
                "rag_collection": None,
                "rag_used": False,
                "rag_error": str(exc),
                "intent": "document_question",
                "intent_info": intent_info,
            }
            return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)
    if rag_info is not None:
        lookup_result = _document_lookup_result(req, rag_info)
        if lookup_result is not None:
            lookup_result.setdefault("rag_hit_count", rag_info.get("hit_count", 0))
            lookup_result.setdefault("rag_collection", rag_info.get("collection"))
            lookup_result.setdefault("rag_used", bool(lookup_result.get("citations")))
            lookup_result.setdefault("intent", "document_question")
            lookup_result.setdefault("intent_info", intent_info)
            return TextResponse(result=lookup_result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)
    if not context:
        if intent == "ambiguous":
            fallback_intent_info = {
                **intent_info,
                "fallback": "general_chat",
                "rag_hit_count": rag_info.get("hit_count", 0) if isinstance(rag_info, dict) else 0,
                "rag_collection": rag_info.get("collection") if isinstance(rag_info, dict) else None,
            }
            return _general_chat_response(req, started, fallback_intent_info)
        result = {
            "answer": NO_RELATED_DOCS_MESSAGE,
            "citations": [],
            "used_context_ids": [],
            "confidence": "low",
            "rag_hit_count": 0,
            "rag_collection": rag_info.get("collection") if isinstance(rag_info, dict) else None,
            "rag_used": False,
            "intent": "document_question",
            "intent_info": intent_info,
        }
        return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)

    try:
        result = generate_json(chat_messages(req, context, sources), max_new_tokens=1024)
    except Exception as exc:
        cleanup_cuda()
        result = {
            "answer": NO_RELATED_DOCS_MESSAGE,
            "citations": [],
            "used_context_ids": [],
            "confidence": "low",
            "generation_error": str(exc),
        }
    result = normalize_chat_sources(result, sources, rag_used=bool(sources))
    if isinstance(result, dict) and rag_info is not None:
        result["rag_hit_count"] = rag_info.get("hit_count", 0)
        result["rag_collection"] = rag_info.get("collection")
        result["rag_used"] = bool(result.get("citations"))
    if isinstance(result, dict):
        result.setdefault("intent", "document_question")
        result.setdefault("intent_info", intent_info)
    return TextResponse(result=result, elapsed_sec=round(time.perf_counter() - started, 3), model=TEXT_MODEL_ID)


from internal_docs.routes import router as internal_docs_router
from unified_routes import router as unified_router

app.include_router(unified_router)
app.include_router(internal_docs_router)
