from __future__ import annotations

import math
import re
from dataclasses import dataclass
from typing import Any


_SPACE_RE = re.compile(r"\s+")


def _norm(value: Any) -> str:
    return _SPACE_RE.sub(" ", str(value or "")).strip().lower()


@dataclass(frozen=True)
class Judged:
    """검색 결과 하나를 평가용으로 단순화한 형태. 청크 ID는 재적재마다 바뀌므로 쓰지 않는다."""

    source_filename: str
    page_start: int | None
    page_end: int | None
    text: str


def matches(matcher: dict[str, Any], hit: Judged) -> bool:
    """정답 조건(source/page/contains)이 모두 맞으면 True. 비어 있는 조건은 검사하지 않는다."""
    source = _norm(matcher.get("source"))
    if source and source not in _norm(hit.source_filename):
        return False
    page = matcher.get("page")
    if page is not None:
        if hit.page_start is None:
            return False
        end = hit.page_end if hit.page_end is not None else hit.page_start
        if not (hit.page_start <= int(page) <= end):
            return False
    contains = _norm(matcher.get("contains"))
    if contains and contains not in _norm(hit.text):
        return False
    return bool(source or page is not None or contains)


def score_query(matchers: list[dict[str, Any]], hits: list[Judged], k: int) -> dict[str, float]:
    """정답 조건 목록 기준 Recall@k, nDCG@k(이진), MRR, Hit@k.

    정답 조건 하나는 처음 맞춘 검색 결과 한 번만 점수로 센다. 같은 근거를 여러 청크가 맞춰도 중복 가산하지 않는다.
    """
    top = hits[:k]
    satisfied: set[int] = set()
    gains: list[int] = []
    first_relevant_rank: int | None = None
    for rank, hit in enumerate(top, 1):
        gain = 0
        for index, matcher in enumerate(matchers):
            if index not in satisfied and matches(matcher, hit):
                satisfied.add(index)
                gain = 1
        if gain and first_relevant_rank is None:
            first_relevant_rank = rank
        gains.append(gain)

    total = len(matchers)
    dcg = sum(gain / math.log2(rank + 1) for rank, gain in enumerate(gains, 1))
    ideal = sum(1 / math.log2(rank + 1) for rank in range(1, min(total, k) + 1))
    return {
        f"recall@{k}": (len(satisfied) / total) if total else 0.0,
        f"ndcg@{k}": (dcg / ideal) if ideal else 0.0,
        "mrr": (1 / first_relevant_rank) if first_relevant_rank else 0.0,
        f"hit@{k}": 1.0 if satisfied else 0.0,
    }


def aggregate(rows: list[dict[str, float]]) -> dict[str, float]:
    if not rows:
        return {}
    keys = rows[0].keys()
    return {key: sum(row[key] for row in rows) / len(rows) for key in keys}
