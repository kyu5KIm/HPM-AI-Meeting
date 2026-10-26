from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
import re
from typing import Any


TERMS_PATH = Path(os.getenv("STT_TERMS_PATH") or Path(__file__).with_name("stt_terms.json"))
APPLY_ALL_TERMS = os.getenv("STT_TERMS_APPLY_ALL", "false").strip().lower() in {"1", "true", "yes", "on"}

# Default auto-correction is intentionally conservative. The glossary contains
# many descriptive Korean aliases, but STT correction should mainly normalize
# proper nouns, acronyms, model names, and infrastructure product names.
SAFE_AUTO_CORRECT_CANONICALS = {
    "HPM",
    "RAG",
    "LLM",
    "STT",
    "OCR",
    "OpenAI",
    "GPT",
    "GPT-4o",
    "Qdrant",
    "BM25",
    "FastAPI",
    "Django",
    "Django REST Framework",
    "JWT",
    "OAuth",
    "CORS",
    "CSRF",
    "React",
    "TypeScript",
    "Vite",
    "Node.js",
    "npm",
    "Axios",
    "Docker",
    "Docker Compose",
    "Nginx",
    "EC2",
    "RDS",
    "S3",
    "S3 bucket",
    "SES",
    "IAM",
    "Route 53",
    "CloudShell",
    "SSH",
    "HTTPS",
    "SSL",
    "TLS",
    "MySQL",
    "Jira",
    "Jira issue",
    "Kanban",
    "Git",
    "GitHub",
    "Whisper",
    "Apache Spark",
    "Hadoop",
    "Kafka",
    "Airflow",
    "EDA",
    "ETL",
    "ELT",
    "AUC",
    "ROC curve",
    "QA",
    "UAT",
}


@dataclass(frozen=True)
class TermRule:
    canonical: str
    alias: str
    category: str
    case_sensitive: bool
    pattern: re.Pattern[str]


def _is_ascii_text(value: str) -> bool:
    return bool(value) and all(ord(ch) < 128 for ch in value)


def _normalize_alias(value: str, *, case_sensitive: bool) -> str:
    text = " ".join(value.strip().split())
    return text if case_sensitive else text.casefold()


def _compile_alias_pattern(alias: str, *, case_sensitive: bool) -> re.Pattern[str]:
    escaped = re.escape(alias)
    if _is_ascii_text(alias):
        pattern = rf"(?<![A-Za-z0-9_]){escaped}(?![A-Za-z0-9_])"
    else:
        pattern = escaped
    flags = 0 if case_sensitive else re.IGNORECASE
    return re.compile(pattern, flags)


def _should_use_term(term: dict[str, Any]) -> bool:
    if term.get("enabled") is False:
        return False
    if APPLY_ALL_TERMS:
        return True
    if term.get("autoCorrect") is True:
        return True
    return str(term.get("canonical") or "").strip() in SAFE_AUTO_CORRECT_CANONICALS


def _is_safe_alias(alias: str, canonical: str, *, case_sensitive: bool) -> bool:
    alias = alias.strip()
    if not alias:
        return False
    if _normalize_alias(alias, case_sensitive=case_sensitive) == _normalize_alias(canonical, case_sensitive=case_sensitive):
        return False
    # Single-syllable Korean aliases such as "락" are too risky because they can
    # appear inside unrelated words like "연락".
    if not _is_ascii_text(alias) and len(alias) < 2:
        return False
    return True


def _load_terms(path: Path = TERMS_PATH) -> list[dict[str, Any]]:
    try:
        with path.open("r", encoding="utf-8") as file:
            payload = json.load(file)
    except FileNotFoundError:
        return []
    terms = payload.get("terms") if isinstance(payload, dict) else None
    return terms if isinstance(terms, list) else []


def _build_rules(path: Path = TERMS_PATH) -> list[TermRule]:
    terms = _load_terms(path)
    candidates: list[tuple[str, str, str, bool]] = []
    alias_targets: dict[tuple[str, bool], set[str]] = {}

    for term in terms:
        if not isinstance(term, dict) or not _should_use_term(term):
            continue
        canonical = str(term.get("canonical") or "").strip()
        if not canonical:
            continue
        category = str(term.get("category") or "").strip() or "general"
        case_sensitive = bool(term.get("caseSensitive"))
        aliases = term.get("aliases") if isinstance(term.get("aliases"), list) else []
        for raw_alias in aliases:
            alias = str(raw_alias or "").strip()
            if not _is_safe_alias(alias, canonical, case_sensitive=case_sensitive):
                continue
            key = (_normalize_alias(alias, case_sensitive=case_sensitive), case_sensitive)
            alias_targets.setdefault(key, set()).add(canonical)
            candidates.append((canonical, alias, category, case_sensitive))

    rules: list[TermRule] = []
    seen: set[tuple[str, str, bool]] = set()
    for canonical, alias, category, case_sensitive in candidates:
        key = (_normalize_alias(alias, case_sensitive=case_sensitive), case_sensitive)
        if len(alias_targets.get(key, set())) > 1:
            continue
        rule_key = (canonical, key[0], case_sensitive)
        if rule_key in seen:
            continue
        seen.add(rule_key)
        rules.append(
            TermRule(
                canonical=canonical,
                alias=alias,
                category=category,
                case_sensitive=case_sensitive,
                pattern=_compile_alias_pattern(alias, case_sensitive=case_sensitive),
            )
        )

    return sorted(rules, key=lambda rule: len(rule.alias), reverse=True)


def get_active_term_rules() -> list[TermRule]:
    return _build_rules()


def merge_term_corrections(corrections: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[tuple[str, str, str], int] = {}
    for item in corrections:
        alias = str(item.get("alias") or "")
        canonical = str(item.get("canonical") or "")
        category = str(item.get("category") or "")
        count = int(item.get("count") or 0)
        if not alias or not canonical or count <= 0:
            continue
        key = (alias, canonical, category)
        merged[key] = merged.get(key, 0) + count

    return [
        {"alias": alias, "canonical": canonical, "category": category, "count": count}
        for (alias, canonical, category), count in sorted(merged.items(), key=lambda item: (-item[1], item[0]))
    ]


def apply_stt_term_corrections(text: str) -> tuple[str, list[dict[str, Any]]]:
    corrected = text or ""
    corrections: list[dict[str, Any]] = []
    if not corrected.strip():
        return corrected, corrections

    for rule in get_active_term_rules():
        corrected, count = rule.pattern.subn(rule.canonical, corrected)
        if count:
            corrections.append(
                {
                    "alias": rule.alias,
                    "canonical": rule.canonical,
                    "category": rule.category,
                    "count": count,
                }
            )

    return corrected, merge_term_corrections(corrections)
