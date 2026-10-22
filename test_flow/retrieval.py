from __future__ import annotations

import os
import re
import sys
import time
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from config import FEATURE_CHAT_DIR, qdrant_collection_for_project
from schemas import PreparationRequest


@dataclass
class FeatureChatRagBundle:
    query_module: Any
    embedder: Any
    client: Any
    collection: str
    records: list[Any]
    bm25: Any
    loaded_at: float


feature_chat_rag_bundles: dict[str, FeatureChatRagBundle] = {}


def load_feature_chat_rag(*, project_id: Any = None, collection_name: str | None = None) -> FeatureChatRagBundle:
    collection = collection_name or qdrant_collection_for_project(project_id)
    ttl_sec = int(os.getenv("RAG_CORPUS_TTL_SEC", "300"))
    cached = feature_chat_rag_bundles.get(collection)
    if cached is not None and (
        ttl_sec <= 0 or time.monotonic() - cached.loaded_at < ttl_sec
    ):
        return cached

    if not FEATURE_CHAT_DIR.exists():
        raise RuntimeError(f"Feature chat RAG directory was not found: {FEATURE_CHAT_DIR}")
    module_path = FEATURE_CHAT_DIR / "rag_search.py"
    if not module_path.exists():
        legacy_path = FEATURE_CHAT_DIR / "04_query_qdrant_openai.py"
        module_path = legacy_path if legacy_path.exists() else module_path
    if not module_path.exists():
        raise RuntimeError(f"RAG search module was not found: {module_path}")

    if str(FEATURE_CHAT_DIR) not in sys.path:
        sys.path.insert(0, str(FEATURE_CHAT_DIR))

    import importlib.util
    from rank_bm25 import BM25Okapi
    from rag.embeddings import DEFAULT_HF_EMBEDDING_MODEL, make_embedder
    from rag.qdrant_store import collection_exists, config_from_env, count_points, make_client

    spec = importlib.util.spec_from_file_location("runpod_feature_chat_query", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {module_path}")
    query_module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = query_module
    spec.loader.exec_module(query_module)

    dimensions = os.getenv("RAG_EMBEDDING_DIMENSIONS")
    embedder = make_embedder(
        provider=os.getenv("RAG_EMBEDDING_PROVIDER", os.getenv("EMBEDDING_PROVIDER", "huggingface")),
        model=os.getenv("RAG_EMBEDDING_MODEL") or os.getenv("EMBEDDING_MODEL_ID", DEFAULT_HF_EMBEDDING_MODEL),
        dimensions=int(dimensions) if dimensions else None,
        device=os.getenv("RAG_EMBEDDING_DEVICE", "auto"),
        embedding_backend=os.getenv("RAG_HF_EMBEDDING_BACKEND", "transformers"),
    )
    config = config_from_env(
        os.getenv("QDRANT_URL"),
        os.getenv("QDRANT_API_KEY"),
        collection,
        os.getenv("QDRANT_PREFER_GRPC", "false").lower() == "true",
    )
    client = make_client(config)
    if collection_exists(client, config.collection) and count_points(client, config.collection) > 0:
        records = query_module.load_corpus(client, config.collection)
        bm25 = BM25Okapi([query_module.tokenize(query_module.retrieval_text(record)) for record in records])
    else:
        records = []
        bm25 = None

    bundle = FeatureChatRagBundle(
        query_module=query_module,
        embedder=embedder,
        client=client,
        collection=config.collection,
        records=records,
        bm25=bm25,
        loaded_at=time.monotonic(),
    )
    feature_chat_rag_bundles[collection] = bundle
    return bundle


def invalidate_feature_chat_rag(*, project_id: Any = None, collection_name: str | None = None) -> None:
    if project_id is None and collection_name is None:
        feature_chat_rag_bundles.clear()
        return
    collection = collection_name or qdrant_collection_for_project(project_id)
    feature_chat_rag_bundles.pop(collection, None)


def _clean_id(value: Any) -> str | None:
    text = str(value or "").strip()
    return text or None


def _source_types_for_scope(scope: str, source_types: list[str] | None = None) -> list[str]:
    explicit = [str(item).strip() for item in source_types or [] if str(item).strip()]
    if explicit:
        return explicit
    normalized_scope = (scope or "project").strip().lower()
    if normalized_scope in {"internal", "internal_document", "internal_documents"}:
        return ["internal_document"]
    if normalized_scope in {"meeting", "meeting_minutes", "previous_meeting", "previous_meetings"}:
        return ["meeting_minutes"]
    if normalized_scope in {"current_meeting", "current"}:
        return ["meeting_minutes"]
    if normalized_scope in {"external", "external_news", "news"}:
        return ["external_news"]
    return ["meeting_minutes", "internal_document"]


def _rerank_provider() -> str:
    return os.getenv("RERANK_PROVIDER", "kure").strip().lower()


def _skip_rerank_default() -> bool:
    explicit = os.getenv("RAG_SKIP_RERANK")
    if explicit is not None and explicit.strip():
        return explicit.lower() == "true"
    if _rerank_provider() == "kure":
        return not bool(os.getenv("KURE_API_KEY"))
    return not bool(os.getenv("COHERE_API_KEY") or os.getenv("CO_API_KEY"))


ALL_MEETING_SCOPE_KEYWORDS = (
    "전체 회의록",
    "모든 회의",
    "전체 회의",
    "지금까지",
    "그동안",
    "여태",
    "전부",
)
LAST_MEETING_SCOPE_KEYWORDS = (
    "지난번",
    "저번",
    "직전",
    "마지막 회의",
    "최근 회의",
)
EXPLICIT_TIME_SCOPE_RE = re.compile(
    r"(\d{4}[-./년]\s*\d{1,2}[-./월]\s*\d{1,2}일?|\d{1,2}\s*월\s*\d{1,2}\s*일|"
    r"오늘|어제|그제|지난주|지난 주|저번주|저번 주|이번주|이번 주|지난달|지난 달|"
    r"\d+\s*일\s*전|\d+\s*주\s*전|\d+\s*개월\s*전)"
)
FULL_DATE_RE = re.compile(r"(?P<year>\d{4})\s*(?:[-./년])\s*(?P<month>\d{1,2})\s*(?:[-./월])\s*(?P<day>\d{1,2})\s*일?")
MONTH_DAY_RE = re.compile(r"(?<!\d)(?P<month>\d{1,2})\s*월\s*(?P<day>\d{1,2})\s*일")
DAYS_AGO_RE = re.compile(r"(?P<count>\d+)\s*일\s*전")
WEEKS_AGO_RE = re.compile(r"(?P<count>\d+)\s*주\s*전")
MONTHS_AGO_RE = re.compile(r"(?P<count>\d+)\s*개월\s*전")


def _reference_date() -> date:
    raw = os.getenv("RAG_REFERENCE_DATE", "").strip()
    if raw:
        try:
            return date.fromisoformat(raw)
        except ValueError:
            pass
    return date.today()


def _safe_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _month_range(year: int, month: int) -> tuple[date, date]:
    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)
    return start, end


def _shift_month(base: date, months: int) -> tuple[int, int]:
    month_index = base.year * 12 + (base.month - 1) + months
    return month_index // 12, month_index % 12 + 1


def _meeting_date_scope(question: str) -> tuple[str | None, str | None]:
    query = str(question or "")
    today = _reference_date()

    full_match = FULL_DATE_RE.search(query)
    if full_match:
        target = _safe_date(
            int(full_match.group("year")),
            int(full_match.group("month")),
            int(full_match.group("day")),
        )
        if target:
            return target.isoformat(), target.isoformat()

    month_day_match = MONTH_DAY_RE.search(query)
    if month_day_match:
        target = _safe_date(today.year, int(month_day_match.group("month")), int(month_day_match.group("day")))
        if target and target > today + timedelta(days=31):
            target = _safe_date(today.year - 1, target.month, target.day)
        if target:
            return target.isoformat(), target.isoformat()

    days_ago_match = DAYS_AGO_RE.search(query)
    if days_ago_match:
        target = today - timedelta(days=int(days_ago_match.group("count")))
        return target.isoformat(), target.isoformat()

    weeks_ago_match = WEEKS_AGO_RE.search(query)
    if weeks_ago_match:
        count = int(weeks_ago_match.group("count"))
        start = today - timedelta(days=today.weekday() + 7 * count)
        end = start + timedelta(days=6)
        return start.isoformat(), end.isoformat()

    months_ago_match = MONTHS_AGO_RE.search(query)
    if months_ago_match:
        year, month = _shift_month(today, -int(months_ago_match.group("count")))
        start, end = _month_range(year, month)
        return start.isoformat(), end.isoformat()

    if "오늘" in query:
        return today.isoformat(), today.isoformat()
    if "어제" in query:
        target = today - timedelta(days=1)
        return target.isoformat(), target.isoformat()
    if "그제" in query:
        target = today - timedelta(days=2)
        return target.isoformat(), target.isoformat()
    if "지난주" in query or "지난 주" in query or "저번주" in query or "저번 주" in query:
        start = today - timedelta(days=today.weekday() + 7)
        end = start + timedelta(days=6)
        return start.isoformat(), end.isoformat()
    if "이번주" in query or "이번 주" in query:
        start = today - timedelta(days=today.weekday())
        end = start + timedelta(days=6)
        return start.isoformat(), end.isoformat()
    if "지난달" in query or "지난 달" in query:
        year, month = _shift_month(today, -1)
        start, end = _month_range(year, month)
        return start.isoformat(), end.isoformat()

    return None, None


def _meeting_scope_limit(question: str, requested_limit: int | None) -> int:
    query = str(question or "")
    default_limit = int(os.getenv("RAG_MAX_PREVIOUS_MEETINGS", "5"))
    base_limit = requested_limit if requested_limit is not None else default_limit

    if any(keyword in query for keyword in ALL_MEETING_SCOPE_KEYWORDS):
        return 0
    if any(keyword in query for keyword in LAST_MEETING_SCOPE_KEYWORDS):
        return min(int(base_limit or default_limit), int(os.getenv("RAG_LAST_PREVIOUS_MEETINGS", "3")))
    if EXPLICIT_TIME_SCOPE_RE.search(query):
        return 0
    return int(base_limit or default_limit)


def _search_args(
    module: Any,
    question: str,
    *,
    top_k: int,
    prefix: str = "RAG",
    project_id: Any = None,
    meeting_id: Any = None,
    source_scope: str = "project",
    source_types: list[str] | None = None,
    max_previous_meetings: int | None = None,
    min_relevance_score: float | None = None,
) -> Any:
    normalized_scope = (source_scope or "project").strip().lower()
    selected_source_types = _source_types_for_scope(normalized_scope, source_types)
    use_project_filter = normalized_scope not in {"all", "global"}
    where_meeting_id = _clean_id(meeting_id) if normalized_scope in {"current", "current_meeting"} else None
    exclude_meeting_id = None
    if _clean_id(meeting_id) and "meeting_minutes" in selected_source_types and where_meeting_id is None:
        exclude_meeting_id = _clean_id(meeting_id)
    requested_meeting_limit = (
        int(max_previous_meetings)
        if max_previous_meetings is not None
        else int(os.getenv(f"{prefix}_MAX_PREVIOUS_MEETINGS", os.getenv("RAG_MAX_PREVIOUS_MEETINGS", "5")))
    )
    effective_meeting_limit = 0 if normalized_scope in {"all", "global"} else _meeting_scope_limit(question, requested_meeting_limit)
    meeting_date_from, meeting_date_to = _meeting_date_scope(question)
    return module.argparse.Namespace(
        query=question,
        top_k=top_k,
        dense_k=int(os.getenv(f"{prefix}_DENSE_K", str(max(20, top_k * 4)))),
        dense_fetch_k=int(os.getenv(f"{prefix}_DENSE_FETCH_K", str(max(50, top_k * 8)))),
        bm25_k=int(os.getenv(f"{prefix}_BM25_K", str(max(20, top_k * 4)))),
        rrf_k=int(os.getenv("RAG_RRF_K", "60")),
        rrf_top_k=int(os.getenv(f"{prefix}_RRF_TOP_K", str(max(20, top_k * 4)))),
        rerank_top_n=int(os.getenv("RAG_RERANK_TOP_N", str(max(10, top_k * 2)))),
        where_doc_id=os.getenv("RAG_WHERE_DOC_ID") or None,
        where_source_contains=os.getenv("RAG_INTERNAL_DOCUMENT_SOURCE_CONTAINS") if prefix == "RAG" else None,
        where_project_id=_clean_id(project_id) if use_project_filter else None,
        where_meeting_id=where_meeting_id,
        exclude_meeting_id=exclude_meeting_id,
        source_types=",".join(selected_source_types),
        max_previous_meetings=effective_meeting_limit,
        requested_max_previous_meetings=requested_meeting_limit,
        meeting_date_from=meeting_date_from,
        meeting_date_to=meeting_date_to,
        min_relevance_score=float(
            min_relevance_score
            if min_relevance_score is not None
            else os.getenv(f"{prefix}_MIN_RELEVANCE_SCORE", os.getenv("RAG_MIN_RELEVANCE_SCORE", "0"))
        ),
        exclude_chunk_types=os.getenv("RAG_EXCLUDE_CHUNK_TYPES", "image_caption,chart_caption"),
        skip_rerank=_skip_rerank_default(),
        cohere_model=os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5"),
        rerank_provider=_rerank_provider(),
        rerank_model=os.getenv("RERANK_MODEL") or None,
        max_tokens_per_doc=int(os.getenv("RAG_MAX_TOKENS_PER_DOC", "4096")),
    )


def _is_meeting_id_filter_error(exc: Exception) -> bool:
    text = f"{type(exc).__name__}: {exc}"
    return "metadata.meeting_id" in text and (
        "Index required" in text
        or "index" in text.lower()
        or "Bad request" in text
    )


def _meeting_filter_requested(args: Any) -> bool:
    return bool(
        getattr(args, "where_meeting_id", None)
        or getattr(args, "exclude_meeting_id", None)
    )


def _meeting_filter_fallback_args(module: Any, args: Any) -> Any:
    fallback = module.argparse.Namespace(**vars(args))
    fallback.where_meeting_id = None
    fallback.exclude_meeting_id = None

    source_types = [
        item.strip()
        for item in str(getattr(args, "source_types", "") or "").split(",")
        if item.strip()
    ]
    if "internal_document" in source_types and "meeting_minutes" in source_types:
        fallback.source_types = "internal_document"
        fallback.max_previous_meetings = 0
    return fallback


def _retrieve_with_meeting_filter_fallback(
    module: Any,
    args: Any,
    bundle: FeatureChatRagBundle,
) -> list[Any]:
    try:
        return module.retrieve(args, bundle.embedder, bundle.client, bundle.collection, bundle.records, bundle.bm25)
    except Exception as exc:
        if not _meeting_filter_requested(args) or not _is_meeting_id_filter_error(exc):
            raise
        fallback_args = _meeting_filter_fallback_args(module, args)
        return module.retrieve(
            fallback_args,
            bundle.embedder,
            bundle.client,
            bundle.collection,
            bundle.records,
            bundle.bm25,
        )


DOCUMENT_LOOKUP_KEYWORDS = (
    "파일",
    "문서",
    "자료",
    "pdf",
    "업로드",
    "등록",
    "적재",
    "벡터db",
    "vectordb",
    "vector db",
)
DOCUMENT_LOOKUP_STOPWORDS = {
    "파일",
    "문서",
    "자료",
    "pdf",
    "있",
    "있어",
    "있나",
    "있냐",
    "있나요",
    "있는지",
    "존재",
    "존재해",
    "등록",
    "등록된",
    "업로드",
    "업로드된",
    "적재",
    "적재된",
    "찾아",
    "검색",
    "알려줘",
    "보여줘",
    "있는",
    "없는",
}


def _document_lookup_intent(question: str) -> bool:
    text = str(question or "").strip().lower()
    return bool(text) and any(keyword in text for keyword in DOCUMENT_LOOKUP_KEYWORDS)


def _document_existence_intent(question: str) -> bool:
    text = str(question or "").strip().lower()
    if any(keyword in text for keyword in ["내용", "요약", "정리", "알려", "설명", "뭐", "무엇", "찾", "검색"]):
        return False
    return _document_lookup_intent(text) and any(
        keyword in text
        for keyword in ["있", "존재", "등록", "적재", "업로드됐", "업로드되", "올라", "저장"]
    )


def _lookup_normalize(value: Any) -> str:
    return "".join(re.findall(r"[0-9a-zA-Z가-힣]+", str(value or "").lower()))


def _lookup_tokens(value: Any) -> set[str]:
    tokens = {
        token.lower()
        for token in re.findall(r"[0-9a-zA-Z가-힣]{2,}", str(value or ""))
    }
    return {token for token in tokens if token not in DOCUMENT_LOOKUP_STOPWORDS}


def _metadata_name_values(meta: dict[str, Any]) -> list[str]:
    values: list[str] = []
    for key in ["source_filename", "file_name", "title", "source", "original_filename"]:
        value = str(meta.get(key) or "").strip()
        if not value:
            continue
        name = Path(value).name
        values.append(name)
        stem = Path(name).stem
        if stem and stem != name:
            values.append(stem)
    out: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = _lookup_normalize(value)
        if normalized and normalized not in seen:
            seen.add(normalized)
            out.append(value)
    return out


def _document_name_match_score(question: str, meta: dict[str, Any]) -> float:
    query_norm = _lookup_normalize(question)
    query_tokens = _lookup_tokens(question)
    best = 0.0
    for name in _metadata_name_values(meta):
        name_norm = _lookup_normalize(name)
        if not name_norm:
            continue
        if name_norm in query_norm:
            best = max(best, 1.0)
        name_tokens = _lookup_tokens(name)
        overlap = query_tokens & name_tokens
        if overlap:
            best = max(best, min(0.95, 0.55 + 0.2 * len(overlap)))
        for token in query_tokens:
            if len(token) >= 2 and token in name_norm:
                best = max(best, 0.9)
    return best


def _metadata_file_lookup_hits(module: Any, args: Any, bundle: FeatureChatRagBundle, question: str, top_k: int) -> list[Any]:
    if not _document_lookup_intent(question):
        return []

    excluded_types = module.parse_csv(getattr(args, "exclude_chunk_types", ""))
    args.allowed_meeting_ids = module.recent_meeting_ids(bundle.records, args)
    best_by_source: dict[str, tuple[float, Any]] = {}
    for record in bundle.records:
        meta = getattr(record, "metadata", {}) if isinstance(getattr(record, "metadata", {}), dict) else {}
        if not module.record_allowed(meta, args, excluded_types):
            continue
        score = _document_name_match_score(question, meta)
        if score <= 0:
            continue
        source_key = module.source_label(meta, include_page=False)
        current = best_by_source.get(source_key)
        if current is None or score > current[0]:
            best_by_source[source_key] = (score, record)

    hits: list[Any] = []
    for rank, (score, record) in enumerate(
        sorted(best_by_source.values(), key=lambda item: item[0], reverse=True)[:top_k],
        1,
    ):
        meta = getattr(record, "metadata", {}) if isinstance(getattr(record, "metadata", {}), dict) else {}
        filename = module.source_label(meta, include_page=False)
        document = (
            f"문서 메타데이터: '{filename}' 파일은 벡터DB에 등록되어 있습니다.\n"
            f"{getattr(record, 'document', '') or ''}"
        )
        hits.append(
            module.SearchHit(
                rank=rank,
                chunk_id=str(getattr(record, "chunk_id", "")),
                document=document,
                metadata=meta,
                source="metadata",
                score=float(score),
                bm25_rank=rank,
                bm25_score=float(score),
            )
        )
    return hits


def _merge_hits(primary_hits: list[Any], secondary_hits: list[Any], *, top_k: int) -> list[Any]:
    merged: list[Any] = []
    seen: set[str] = set()
    for hit in [*primary_hits, *secondary_hits]:
        chunk_id = str(getattr(hit, "chunk_id", "") or "")
        meta = getattr(hit, "metadata", {}) if isinstance(getattr(hit, "metadata", {}), dict) else {}
        key = chunk_id or f"{meta.get('source_filename') or meta.get('file_name') or meta.get('title')}:{meta.get('page') or meta.get('page_start') or ''}"
        if key in seen:
            continue
        seen.add(key)
        hit.rank = len(merged) + 1
        merged.append(hit)
        if len(merged) >= top_k:
            break
    return merged


def feature_chat_retrieve(
    question: str,
    *,
    project_id: Any = None,
    meeting_id: Any = None,
    source_scope: str = "project",
    source_types: list[str] | None = None,
    max_previous_meetings: int | None = None,
    min_relevance_score: float | None = None,
) -> dict[str, Any]:
    bundle = load_feature_chat_rag(project_id=project_id)
    module = bundle.query_module
    top_k = int(os.getenv("CHAT_RAG_TOP_K", "5"))
    args = _search_args(
        module,
        question,
        top_k=top_k,
        project_id=project_id,
        meeting_id=meeting_id,
        source_scope=source_scope,
        source_types=source_types,
        max_previous_meetings=max_previous_meetings,
        min_relevance_score=min_relevance_score,
    )
    if "external_news" in str(args.source_types).split(","):
        return {"context": "", "sources": [], "hit_count": 0, "collection": bundle.collection}
    if not bundle.records:
        return {"context": "", "sources": [], "hit_count": 0, "collection": bundle.collection}
    hits = _retrieve_with_meeting_filter_fallback(module, args, bundle)
    document_lookup = _document_lookup_intent(question)
    metadata_hits = _metadata_file_lookup_hits(module, args, bundle, question, top_k)
    if document_lookup and metadata_hits:
        hits = _merge_hits(metadata_hits, hits if metadata_hits else [], top_k=top_k)
    elif _document_existence_intent(question):
        hits = []
    sources = module.answer_source_references(hits)
    return {
        "context": module.build_context(hits, int(os.getenv("CHAT_RAG_MAX_CONTEXT_CHARS", "9000"))),
        "sources": sources,
        "hit_count": len(hits),
        "collection": bundle.collection,
        "document_lookup": document_lookup,
        "document_lookup_matches": module.answer_source_references(metadata_hits) if metadata_hits else [],
    }


def feature_chat_ranked_hits(
    question: str,
    *,
    top_k: int,
    project_id: Any = None,
    meeting_id: Any = None,
    source_scope: str = "project",
    source_types: list[str] | None = None,
) -> list[Any]:
    """/chat과 같은 검색 경로(Dense + BM25 -> RRF -> Rerank)로 상위 top_k 청크를 반환한다. 평가용."""
    bundle = load_feature_chat_rag(project_id=project_id)
    module = bundle.query_module
    args = _search_args(
        module,
        question,
        top_k=top_k,
        project_id=project_id,
        meeting_id=meeting_id,
        source_scope=source_scope,
        source_types=source_types,
    )
    if not bundle.records:
        return []
    return _retrieve_with_meeting_filter_fallback(module, args, bundle)


def preparation_query(req: PreparationRequest) -> str:
    participant_text = " ".join(
        f"{item.get('name', '')} {item.get('work', '')}" if isinstance(item, dict) else str(item)
        for item in req.participants
    )
    agenda_text = " ".join(str(item) for item in req.agendas)
    ocr_text = str(getattr(req, "ocr_text", "") or "").strip()
    if len(ocr_text) > 1000:
        ocr_text = ocr_text[:1000]
    return " ".join(
        part.strip()
        for part in [req.title, getattr(req, "project_context", ""), participant_text, agenda_text, ocr_text]
        if part and part.strip()
    )


def preparation_news_query(req: PreparationRequest) -> str:
    agenda_text = " ".join(str(item) for item in req.agendas)
    return " ".join(
        part.strip()
        for part in [req.title, agenda_text]
        if part and part.strip()
    )


def feature_chat_search_hits(
    question: str,
    *,
    top_k: int,
    project_id: Any = None,
    meeting_id: Any = None,
    source_scope: str = "project",
    source_types: list[str] | None = None,
    max_previous_meetings: int | None = None,
) -> list[Any]:
    bundle = load_feature_chat_rag(project_id=project_id)
    module = bundle.query_module
    args = _search_args(
        module,
        question,
        top_k=top_k,
        prefix="PREPARATION_RAG",
        project_id=project_id,
        meeting_id=meeting_id,
        source_scope=source_scope,
        source_types=source_types,
        max_previous_meetings=max_previous_meetings,
    )
    if not bundle.records:
        return []
    return _retrieve_with_meeting_filter_fallback(module, args, bundle)


def hit_document_type(hit: Any) -> str:
    meta = getattr(hit, "metadata", {}) if isinstance(getattr(hit, "metadata", {}), dict) else {}
    values = [meta.get("source_type"), meta.get("doc_type"), meta.get("document_type"), meta.get("category")]
    text = " ".join(str(value or "").lower() for value in values)
    if "previous" in text or "meeting_minutes" in text or "previous_meeting" in text:
        return "previous_meeting"
    if "internal" in text or "internal_document" in text:
        return "internal_document"
    return ""


MEETING_PREPARATION_CHUNK_PRIORITY = {
    "meeting_summary": 0,
    "summary": 0,
    "meeting_todo": 1,
    "todo": 1,
    "meeting_document": 2,
    "document": 2,
}


PREPARATION_RELEVANCE_STOPWORDS = {
    "회의",
    "안건",
    "프로젝트",
    "자료",
    "문서",
    "내용",
    "관련",
    "확인",
    "검토",
    "논의",
    "생성",
    "결과",
    "정리",
    "계획",
    "방안",
}


def hit_chunk_type(hit: Any) -> str:
    meta = getattr(hit, "metadata", {}) if isinstance(getattr(hit, "metadata", {}), dict) else {}
    return str(meta.get("chunk_type") or meta.get("section_type") or meta.get("block_type") or "").strip()


def prioritize_meeting_hits(hits: list[Any]) -> list[Any]:
    def sort_key(indexed_hit: tuple[int, Any]) -> tuple[int, int]:
        index, hit = indexed_hit
        chunk_type = hit_chunk_type(hit).lower()
        priority = MEETING_PREPARATION_CHUNK_PRIORITY.get(chunk_type, 99)
        return priority, index

    return [hit for _, hit in sorted(enumerate(hits), key=sort_key)]


def _preparation_relevance_text(req: PreparationRequest) -> str:
    agenda_text = " ".join(str(item) for item in req.agendas)
    ocr_text = str(getattr(req, "ocr_text", "") or "").strip()
    if len(ocr_text) > 2000:
        ocr_text = ocr_text[:2000]
    return " ".join(
        part.strip()
        for part in [req.title, getattr(req, "project_context", ""), agenda_text, ocr_text]
        if part and part.strip()
    )


def _relevance_tokens(text: Any) -> set[str]:
    tokens = {
        token.lower()
        for token in re.findall(r"[0-9A-Za-z가-힣]{2,}", str(text or ""))
    }
    return {token for token in tokens if token not in PREPARATION_RELEVANCE_STOPWORDS}


def _hit_relevance_text(hit: Any) -> str:
    meta = getattr(hit, "metadata", {}) if isinstance(getattr(hit, "metadata", {}), dict) else {}
    metadata_text = " ".join(
        str(meta.get(key) or "")
        for key in [
            "meeting_topic",
            "title",
            "source",
            "file_name",
            "source_filename",
            "parent_title",
            "heading",
            "article_title",
        ]
    )
    return f"{metadata_text} {meta.get('parent_text') or ''} {getattr(hit, 'document', '') or ''}"


def _hit_relevance_score(hit: Any) -> float:
    for attr in ["rerank_score", "dense_score", "score"]:
        value = getattr(hit, attr, None)
        if value is None:
            continue
        try:
            return float(value)
        except (TypeError, ValueError):
            continue
    return 0.0


def previous_meeting_hit_is_relevant(req: PreparationRequest, hit: Any) -> bool:
    if os.getenv("PREPARATION_PREVIOUS_FILTER_ENABLED", "true").lower() != "true":
        return True

    min_score = float(
        os.getenv(
            "PREPARATION_PREVIOUS_MIN_RELEVANCE_SCORE",
            os.getenv("PREPARATION_RAG_MIN_RELEVANCE_SCORE", "0"),
        )
    )
    if min_score > 0 and _hit_relevance_score(hit) < min_score:
        return False

    min_overlap = int(os.getenv("PREPARATION_PREVIOUS_MIN_KEYWORD_OVERLAP", "1"))
    if min_overlap <= 0:
        return True

    query_tokens = _relevance_tokens(_preparation_relevance_text(req))
    if not query_tokens:
        return True
    hit_tokens = _relevance_tokens(_hit_relevance_text(hit))
    return len(query_tokens & hit_tokens) >= min_overlap


def filter_previous_meeting_hits(req: PreparationRequest, hits: list[Any]) -> list[Any]:
    return [hit for hit in hits if previous_meeting_hit_is_relevant(req, hit)]


def hit_to_preparation_document(hit: Any, category: str, *, project_id: Any = None) -> dict[str, Any]:
    module = load_feature_chat_rag(project_id=project_id).query_module
    meta = getattr(hit, "metadata", {}) if isinstance(getattr(hit, "metadata", {}), dict) else {}
    if hasattr(module, "parent_context_text"):
        raw_text = module.parent_context_text(hit)
    else:
        raw_text = str(meta.get("parent_text") or getattr(hit, "document", "") or "")
    text = module.normalize_context_text(str(raw_text or ""))
    return {
        "category": category,
        "source": module.source_label(meta),
        "text": text[: int(os.getenv("PREPARATION_DOC_MAX_CHARS", "1200"))],
        "chunk_id": str(getattr(hit, "chunk_id", "")),
        "rank": int(getattr(hit, "rank", 0) or 0),
        "score": float(getattr(hit, "score", 0.0) or 0.0),
        "metadata": {
            key: meta.get(key)
            for key in [
                "source_type",
                "doc_type",
                "document_type",
                "category",
                "chunk_type",
                "section_type",
                "project_id",
                "meeting_id",
                "meeting_topic",
                "meeting_datetime",
                "doc_id",
                "document_id",
                "viewer_type",
                "viewer_id",
                "storage_key",
                "s3_key",
                "s3_url",
                "file_name",
                "source_filename",
                "source_sha256",
                "source_path",
                "title",
                "parent_id",
                "parent_type",
                "parent_title",
                "parent_page_start",
                "parent_page_end",
                "child_index",
                "child_count",
                "page",
                "page_idx",
                "page_no",
                "page_number",
                "page_start",
                "page_end",
            ]
            if meta.get(key) is not None
        },
    }


def select_preparation_documents(req: PreparationRequest) -> dict[str, Any]:
    base_query = preparation_query(req)
    default_top_k = int(os.getenv("PREPARATION_RAG_TOP_K", "3"))
    previous_top_k = int(os.getenv("PREPARATION_PREVIOUS_MEETINGS_TOP_K", str(default_top_k)))
    internal_top_k = int(os.getenv("PREPARATION_INTERNAL_DOCUMENTS_TOP_K", str(default_top_k)))
    fetch_k = int(os.getenv("PREPARATION_RAG_FETCH_K", str(max(20, max(previous_top_k, internal_top_k) * 6))))
    project_id = getattr(req, "project_id", "")
    meeting_id = getattr(req, "meeting_id", "")
    max_previous_meetings = int(getattr(req, "max_previous_meetings", 5) or 5)
    previous_hits = (
        feature_chat_search_hits(
            f"{base_query} 이전 회의 회의록 결정사항 논의내용 할일 담당자 미완료 이슈",
            top_k=fetch_k,
            project_id=project_id,
            meeting_id=meeting_id,
            source_scope="previous_meetings",
            max_previous_meetings=max_previous_meetings,
        )
        if base_query
        else []
    )
    internal_hits = (
        feature_chat_search_hits(
            f"{base_query} 내부 문서 요구사항 정책 참고자료",
            top_k=fetch_k,
            project_id=project_id,
            meeting_id=meeting_id,
            source_scope="internal_documents",
            max_previous_meetings=max_previous_meetings,
        )
        if base_query
        else []
    )

    docs: dict[str, list[dict[str, Any]]] = {"previous_meetings": [], "internal_documents": []}
    seen = {"previous_meetings": set(), "internal_documents": set()}

    def append_preparation_hit(hit: Any, output_key: str, category: str) -> bool:
        hit_type = hit_document_type(hit)
        if hit_type and hit_type != category:
            return False
        limit = previous_top_k if output_key == "previous_meetings" else internal_top_k
        chunk_id = str(getattr(hit, "chunk_id", ""))
        if chunk_id in seen[output_key] or len(docs[output_key]) >= limit:
            return False
        seen[output_key].add(chunk_id)
        docs[output_key].append(hit_to_preparation_document(hit, category, project_id=project_id))
        return True

    previous_hits = prioritize_meeting_hits(filter_previous_meeting_hits(req, previous_hits))
    for hit, output_key, category in [
        *[(hit, "previous_meetings", "previous_meeting") for hit in previous_hits],
        *[(hit, "internal_documents", "internal_document") for hit in internal_hits],
    ]:
        append_preparation_hit(hit, output_key, category)

    fallback_enabled = os.getenv("PREPARATION_PROJECT_FALLBACK_ENABLED", "true").lower() == "true"
    if base_query and fallback_enabled and not docs["internal_documents"]:
        fallback_hits = feature_chat_search_hits(
            base_query,
            top_k=fetch_k,
            project_id=project_id,
            meeting_id=meeting_id,
            source_scope="project",
            max_previous_meetings=max_previous_meetings,
        )
        for hit in fallback_hits:
            hit_type = hit_document_type(hit)
            if hit_type == "previous_meeting":
                append_preparation_hit(hit, "previous_meetings", "previous_meeting")
            else:
                append_preparation_hit(hit, "internal_documents", "internal_document")

    return {"query": base_query, "news_query": preparation_news_query(req), **docs}
