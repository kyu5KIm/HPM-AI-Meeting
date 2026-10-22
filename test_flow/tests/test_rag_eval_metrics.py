import json
import math

import pytest

from rag_eval.metrics import Judged, aggregate, matches, score_query
from rag_eval.run_eval import load_eval_set, to_judged


def hit(source="a.pdf", page=None, text=""):
    return Judged(source_filename=source, page_start=page, page_end=page, text=text)


def test_matches_requires_all_given_fields():
    h = hit("2026_사업계획.pdf", 3, "마케팅   예산 총액은 10억")
    assert matches({"source": "사업계획", "page": 3, "contains": "마케팅 예산"}, h)
    assert not matches({"source": "사업계획", "page": 4}, h)
    assert not matches({"source": "보안정책"}, h)
    assert not matches({}, h)


def test_matches_page_range():
    h = Judged("a.pdf", 2, 5, "")
    assert matches({"page": 4}, h)
    assert not matches({"page": 6}, h)


def test_score_query_counts_each_matcher_once():
    matchers = [{"contains": "예산"}, {"contains": "담당자"}]
    hits = [hit(text="예산"), hit(text="예산 중복"), hit(text="담당자")]
    scores = score_query(matchers, hits, 10)
    assert scores["recall@10"] == 1.0
    assert scores["mrr"] == 1.0
    expected = (1 + 1 / math.log2(4)) / (1 + 1 / math.log2(3))
    assert scores["ndcg@10"] == pytest.approx(expected)


def test_score_query_miss_and_cutoff():
    scores = score_query([{"contains": "없음"}], [hit(text="다른 내용")], 10)
    assert scores == {"recall@10": 0.0, "ndcg@10": 0.0, "mrr": 0.0, "hit@10": 0.0}
    hits = [hit(text="x")] * 3 + [hit(text="정답")]
    assert score_query([{"contains": "정답"}], hits, 3)["hit@3"] == 0.0


def test_aggregate_means():
    assert aggregate([{"a": 1.0}, {"a": 0.0}]) == {"a": 0.5}
    assert aggregate([]) == {}


def test_load_eval_set_and_to_judged(tmp_path):
    path = tmp_path / "set.jsonl"
    path.write_text(
        "# 주석\n" + json.dumps({"question": "q", "relevant": [{"contains": "x"}]}, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    items = load_eval_set(path)
    assert items[0]["id"] == "q002"

    class Hit:
        document = "자식"
        metadata = {"source_filename": "a.hwp", "page_start": "3", "page_end": None, "parent_text": "부모"}

    judged = to_judged(Hit())
    assert (judged.source_filename, judged.page_start, judged.page_end) == ("a.hwp", 3, 3)
    assert "부모" in judged.text and "자식" in judged.text


def test_load_eval_set_rejects_missing_fields(tmp_path):
    path = tmp_path / "bad.jsonl"
    path.write_text(json.dumps({"question": "q"}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_eval_set(path)


def test_run_uses_chat_retrieval_path(monkeypatch):
    import retrieval
    from rag_eval.run_eval import run

    class Hit:
        def __init__(self, text):
            self.document = text
            self.metadata = {"source_filename": "a.pdf", "page_start": 1}

    calls = []

    def fake(question, **kwargs):
        calls.append((question, kwargs))
        return [Hit("무관"), Hit("정답 문구")]

    monkeypatch.setattr(retrieval, "feature_chat_ranked_hits", fake)
    result = run([{"id": "q1", "question": "질문", "relevant": [{"contains": "정답"}]}], top_k=10, default_project_id="7")
    assert calls[0][1]["project_id"] == "7" and calls[0][1]["top_k"] == 10
    assert result["summary"]["mrr"] == 0.5
