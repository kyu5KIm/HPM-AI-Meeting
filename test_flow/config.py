from __future__ import annotations

import importlib.util
import os
import re
from pathlib import Path

from dotenv import load_dotenv


APP_DIR = Path(__file__).resolve().parent
ROOT_DIR = APP_DIR.parent


def load_env_files() -> None:
    for path in [
        APP_DIR / ".env",
        APP_DIR / ".env.example",
        ROOT_DIR / ".env",
    ]:
        if path.exists():
            load_dotenv(path, override=False)


load_env_files()


def unset_blank_env(name: str) -> None:
    if name in os.environ and not os.environ[name].strip():
        os.environ.pop(name, None)


unset_blank_env("OPENAI_BASE_URL")


def force_env(name: str, value: str | None) -> str:
    text = "" if value is None else str(value)
    os.environ[name] = text
    return text

if os.getenv("CO_API_KEY") and not os.getenv("COHERE_API_KEY"):
    os.environ["COHERE_API_KEY"] = os.getenv("CO_API_KEY", "")
elif os.getenv("COHERE_API_KEY") and not os.getenv("CO_API_KEY"):
    os.environ["CO_API_KEY"] = os.getenv("COHERE_API_KEY", "")

if os.getenv("HF_HUB_ENABLE_HF_TRANSFER") == "1" and importlib.util.find_spec("hf_transfer") is None:
    os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "0"


OPENAI_API_KEY = os.getenv("TEST_FLOW_OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY", "")
force_env("OPENAI_API_KEY", OPENAI_API_KEY)
OPENAI_BASE_URL = os.getenv("OPENAI_BASE_URL") or None
OPENAI_TIMEOUT_SEC = float(os.getenv("OPENAI_TIMEOUT_SEC", "300"))

# Keep the old key names so copied ai/vllm code keeps working.
# Merged ai/*.env files may still contain local/vLLM model values. test_flow
# fixes only the model runtime to OpenAI while preserving prompts, schemas,
# RAG filtering, chunking, Qdrant payloads, and post-processing.
TEXT_BACKEND = force_env("TEXT_BACKEND", os.getenv("TEST_FLOW_TEXT_BACKEND", "openai"))
TEXT_GGUF_REPO = os.getenv("TEXT_GGUF_REPO", "unused-openai")
TEXT_GGUF_FILENAME = os.getenv("TEXT_GGUF_FILENAME", "unused-openai")
TEXT_MODEL_ID = force_env(
    "TEXT_MODEL_ID",
    os.getenv("TEST_FLOW_LLM_MODEL_ID") or os.getenv("OPENAI_TEXT_MODEL_ID") or "gpt-5.6-luna",
)
force_env("LLM_MODEL_ID", TEXT_MODEL_ID)
# GPT-5 계열은 추론 모델이다. none이면 temperature를 쓸 수 있고, 그 외에는 추론 토큰이 출력 한도에 포함된다.
TEXT_REASONING_EFFORT = os.getenv("TEST_FLOW_REASONING_EFFORT", "low").strip().lower()
TEXT_REASONING_EXTRA_TOKENS = int(os.getenv("TEST_FLOW_REASONING_EXTRA_TOKENS", "4096"))
TEXT_VLLM_BASE_URL = os.getenv("TEXT_VLLM_BASE_URL", "")
TEXT_VLLM_API_KEY = os.getenv("TEXT_VLLM_API_KEY", "")
TEXT_VLLM_TIMEOUT_SEC = float(os.getenv("TEXT_VLLM_TIMEOUT_SEC", str(OPENAI_TIMEOUT_SEC)))
TEXT_VLLM_STARTUP_WAIT_SEC = float(os.getenv("TEXT_VLLM_STARTUP_WAIT_SEC", "0"))
TEXT_VLLM_STARTUP_POLL_SEC = float(os.getenv("TEXT_VLLM_STARTUP_POLL_SEC", "1"))

OCR_MODEL_ID = force_env(
    "OCR_MODEL_ID",
    os.getenv("TEST_FLOW_OCR_MODEL_ID") or os.getenv("OPENAI_OCR_MODEL_ID") or TEXT_MODEL_ID,
)
OCR_BACKEND = force_env("OCR_BACKEND", os.getenv("TEST_FLOW_OCR_BACKEND", "openai")).lower()
PADDLEOCR_VL_URL = os.getenv("PADDLEOCR_VL_URL", "http://127.0.0.1:8080")
PADDLEOCR_VL_TIMEOUT_SEC = int(os.getenv("PADDLEOCR_VL_TIMEOUT_SEC", "600"))
PADDLEOCR_VL_RETURN_MARKDOWN_IMAGES = os.getenv("PADDLEOCR_VL_RETURN_MARKDOWN_IMAGES", "false").lower() == "true"
PADDLEOCR_VL_VISUALIZE = os.getenv("PADDLEOCR_VL_VISUALIZE", "false").lower() == "true"
OCR_MAX_PDF_PAGES = int(os.getenv("OCR_MAX_PDF_PAGES", "10"))
OCR_RENDER_SCALE = float(os.getenv("OCR_RENDER_SCALE", "2.0"))
OCR_PDF_TEXT_FIRST = os.getenv("OCR_PDF_TEXT_FIRST", "true").lower() == "true"
OCR_MIN_DIRECT_TEXT_CHARS = int(os.getenv("OCR_MIN_DIRECT_TEXT_CHARS", "80"))

STT_MODEL_ID = force_env(
    "STT_MODEL_ID",
    os.getenv("TEST_FLOW_STT_MODEL_ID") or os.getenv("OPENAI_STT_MODEL_ID") or "gpt-4o-transcribe-diarize",
)
STT_DEVICE = force_env("STT_DEVICE", os.getenv("TEST_FLOW_STT_DEVICE", "api"))
STT_COMPUTE_TYPE = force_env("STT_COMPUTE_TYPE", os.getenv("TEST_FLOW_STT_COMPUTE_TYPE", "api"))
STT_BATCH_SIZE = int(os.getenv("STT_BATCH_SIZE", "16"))
STT_PRELOAD_MODEL = os.getenv("STT_PRELOAD_MODEL", "false").lower() == "true"
STT_ENABLE_ALIGN = os.getenv("STT_ENABLE_ALIGN", "true").lower() == "true"
STT_ENABLE_DIARIZE = os.getenv("STT_ENABLE_DIARIZE", "true").lower() == "true"
STT_JOB_WORKERS = int(os.getenv("STT_JOB_WORKERS", "1"))
OCR_JOB_WORKERS = int(os.getenv("OCR_JOB_WORKERS", "1"))
INTERNAL_DOCS_JOB_WORKERS = int(os.getenv("INTERNAL_DOCS_JOB_WORKERS", "1"))
MINUTES_JOB_WORKERS = int(os.getenv("MINUTES_JOB_WORKERS", "1"))

LLAMA_N_CTX = int(os.getenv("LLAMA_N_CTX", "32768"))
LLAMA_N_GPU_LAYERS = int(os.getenv("LLAMA_N_GPU_LAYERS", "0"))
LLAMA_N_THREADS = int(os.getenv("LLAMA_N_THREADS", "8"))
LLAMA_VERBOSE = os.getenv("LLAMA_VERBOSE", "false").lower() == "true"

LOAD_IN_4BIT = os.getenv("LOAD_IN_4BIT", "false").lower() == "true"
TORCH_DTYPE = os.getenv("TORCH_DTYPE", "auto")
MAX_NEW_TOKENS = int(os.getenv("MAX_NEW_TOKENS", "2048"))
PRELOAD_TEXT_MODEL = os.getenv("PRELOAD_TEXT_MODEL", "false").lower() == "true"
PRELOAD_OCR_MODEL = os.getenv("PRELOAD_OCR_MODEL", "false").lower() == "true"
PRELOAD_EMBEDDING_MODEL = os.getenv("PRELOAD_EMBEDDING_MODEL", "false").lower() == "true"

QDRANT_URL = os.getenv("QDRANT_URL", "http://localhost:6333")
QDRANT_API_KEY = os.getenv("QDRANT_API_KEY") or None
# 임베딩 모델이 바뀌면 벡터 차원이 달라지므로 컬렉션 이름도 모델별로 나눈다.
QDRANT_COLLECTION = os.getenv("QDRANT_COLLECTION", "hpm_kure_chunks")
QDRANT_COLLECTION_PROJECT_MODE = os.getenv("QDRANT_COLLECTION_PROJECT_MODE", "true").lower() == "true"
QDRANT_COLLECTION_PREFIX = os.getenv("QDRANT_COLLECTION_PREFIX", "hpm_project_kure")

EMBEDDING_PROVIDER = force_env("EMBEDDING_PROVIDER", os.getenv("TEST_FLOW_EMBEDDING_PROVIDER", "kure"))
_DEFAULT_EMBEDDING_MODEL = {"kure": "kure-v3", "openai": "text-embedding-3-small"}.get(
    EMBEDDING_PROVIDER, "nlpai-lab/KURE-v3"
)
EMBEDDING_MODEL_ID = force_env(
    "EMBEDDING_MODEL_ID",
    os.getenv("TEST_FLOW_EMBEDDING_MODEL_ID") or os.getenv("OPENAI_EMBEDDING_MODEL_ID") or _DEFAULT_EMBEDDING_MODEL,
)
EMBEDDING_DEVICE = force_env("EMBEDDING_DEVICE", os.getenv("TEST_FLOW_EMBEDDING_DEVICE", "api"))
force_env("RAG_EMBEDDING_PROVIDER", os.getenv("TEST_FLOW_RAG_EMBEDDING_PROVIDER") or EMBEDDING_PROVIDER)
force_env("RAG_EMBEDDING_MODEL", os.getenv("TEST_FLOW_RAG_EMBEDDING_MODEL") or EMBEDDING_MODEL_ID)
force_env("RAG_ANSWER_PROVIDER", os.getenv("TEST_FLOW_RAG_ANSWER_PROVIDER", "openai"))
force_env("RAG_ANSWER_MODEL", os.getenv("TEST_FLOW_RAG_ANSWER_MODEL") or TEXT_MODEL_ID)
EMBEDDING_BATCH_SIZE = int(os.getenv("EMBEDDING_BATCH_SIZE", "16"))
# KURE-v3는 2048차원이지만 1024로 줄여도 점수의 99%를 유지한다(Matryoshka).
EMBEDDING_DIMENSIONS = (os.getenv("EMBEDDING_DIMENSIONS") or "").strip() or ("1024" if EMBEDDING_PROVIDER == "kure" else "")
EMBEDDING_DIMENSIONS_INT = int(EMBEDDING_DIMENSIONS) if EMBEDDING_DIMENSIONS else None
# 적재(model_runtime)와 검색(retrieval)이 반드시 같은 차원을 쓰도록 맞춘다.
force_env("EMBEDDING_DIMENSIONS", EMBEDDING_DIMENSIONS)
force_env("RAG_EMBEDDING_DIMENSIONS", os.getenv("TEST_FLOW_RAG_EMBEDDING_DIMENSIONS") or EMBEDDING_DIMENSIONS)

RERANK_PROVIDER = force_env("RERANK_PROVIDER", os.getenv("TEST_FLOW_RERANK_PROVIDER", "kure").strip().lower())
RERANK_MODEL = force_env(
    "RERANK_MODEL",
    os.getenv("TEST_FLOW_RERANK_MODEL")
    or ("kure-reranker-nano" if RERANK_PROVIDER == "kure" else os.getenv("COHERE_RERANK_MODEL", "rerank-v3.5")),
)

CHAT_RAG_TOP_K = int(os.getenv("CHAT_RAG_TOP_K", "5"))
CHAT_RAG_MAX_CONTEXT_CHARS = int(os.getenv("CHAT_RAG_MAX_CONTEXT_CHARS", "6000"))
PIPELINE_TIMEOUT_SEC = int(os.getenv("PIPELINE_TIMEOUT_SEC", "2400"))

LOCAL_PDF_ENABLE_TABLES = os.getenv("LOCAL_PDF_ENABLE_TABLES", "true").lower() == "true"
LOCAL_PDF_OCR_FALLBACK = os.getenv("LOCAL_PDF_OCR_FALLBACK", "true").lower() == "true"
LOCAL_PDF_MIN_PAGE_CHARS = int(os.getenv("LOCAL_PDF_MIN_PAGE_CHARS", "30"))

CHUNK_SIZE = int(os.getenv("CHUNK_SIZE", "650"))
CHUNK_OVERLAP = int(os.getenv("CHUNK_OVERLAP", "120"))
CHUNK_ENCODING = os.getenv("CHUNK_ENCODING", "cl100k_base")
CHUNK_VERSION = os.getenv("CHUNK_VERSION", "local_parent_child_650")
CHUNK_MIN_CHARS = int(os.getenv("CHUNK_MIN_CHARS", "30"))
CHUNK_MAX_TABLE_TOKENS = int(os.getenv("CHUNK_MAX_TABLE_TOKENS", "900"))

CHUNK_SCRIPT_PATH = Path(os.getenv("CHUNK_SCRIPT_PATH", str(APP_DIR / "internal_docs" / "chunker.py")))


def feature_chat_dir_is_valid(path: Path) -> bool:
    return (
        ((path / "rag_search.py").exists() or (path / "04_query_qdrant_openai.py").exists())
        and (path / "rag").exists()
    )


def default_feature_chat_dir() -> Path:
    candidates = [
        APP_DIR / "feature_chat",
        ROOT_DIR / "ai" / "vllm" / "feature_chat",
    ]
    for path in candidates:
        if feature_chat_dir_is_valid(path):
            return path
    return candidates[0]


def resolve_feature_chat_dir() -> Path:
    configured = os.getenv("FEATURE_CHAT_DIR")
    if configured:
        path = Path(configured)
        if feature_chat_dir_is_valid(path):
            return path
    return default_feature_chat_dir()


FEATURE_CHAT_DIR = resolve_feature_chat_dir()


def qdrant_collection_for_project(project_id: str | int | None) -> str:
    text = str(project_id or "").strip()
    if not QDRANT_COLLECTION_PROJECT_MODE or not text:
        return QDRANT_COLLECTION
    safe_project_id = re.sub(r"[^A-Za-z0-9_-]+", "_", text).strip("_")
    if not safe_project_id:
        return QDRANT_COLLECTION
    safe_prefix = re.sub(r"[^A-Za-z0-9_-]+", "_", QDRANT_COLLECTION_PREFIX).strip("_")
    return f"{safe_prefix or 'project'}_{safe_project_id}"
