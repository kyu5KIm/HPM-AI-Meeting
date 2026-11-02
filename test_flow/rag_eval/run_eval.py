"""평가 세트로 /chat 검색 정확도를 측정한다.

실행 (test_flow 폴더에서):
    python -m rag_eval.run_eval --eval-set rag_eval/eval_set.jsonl --label baseline
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Any

APP_DIR = Path(__file__).resolve().parent.parent
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from rag_eval.metrics import Judged, aggregate, score_query  # noqa: E402

CONFIG_KEYS = [
    "EMBEDDING_PROVIDER",
    "EMBEDDING_MODEL_ID",
    "EMBEDDING_DIMENSIONS",
    "RERANK_PROVIDER",
    "RERANK_MODEL",
    "COHERE_RERANK_MODEL",
    "RAG_SKIP_RERANK",
    "QDRANT_COLLECTION",
    "QDRANT_COLLECTION_PREFIX",
    "CHUNK_VERSION",
    "TEXT_MODEL_ID",
]


def load_eval_set(path: Path) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for line_no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        item = json.loads(line)
        if not item.get("question") or not item.get("relevant"):
            raise ValueError(f"{path}:{line_no}: question과 relevant는 필수입니다.")
        item.setdefault("id", f"q{line_no:03d}")
        items.append(item)
    return items


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value) if value not in (None, "") else None
    except (TypeError, ValueError):
        return None


def to_judged(hit: Any) -> Judged:
    meta = getattr(hit, "metadata", None) or {}
    start = _int_or_none(meta.get("page_start") or meta.get("page_no") or meta.get("page"))
    end = _int_or_none(meta.get("page_end")) or start
    text = "\n".join(str(part) for part in [getattr(hit, "document", ""), meta.get("parent_text") or ""] if part)
    source = str(meta.get("source_filename") or meta.get("file_name") or meta.get("title") or "")
    return Judged(source_filename=source, page_start=start, page_end=end, text=text)


def run(items: list[dict[str, Any]], *, top_k: int, default_project_id: str | None) -> dict[str, Any]:
    from retrieval import feature_chat_ranked_hits

    rows: list[dict[str, Any]] = []
    for item in items:
        started = time.perf_counter()
        hits = feature_chat_ranked_hits(
            item["question"],
            top_k=top_k,
            project_id=item.get("project_id", default_project_id),
            meeting_id=item.get("meeting_id"),
            source_scope=item.get("scope", "project"),
        )
        elapsed = time.perf_counter() - started
        judged = [to_judged(hit) for hit in hits]
        scores = score_query(item["relevant"], judged, top_k)
        rows.append(
            {
                "id": item["id"],
                "question": item["question"],
                "scores": scores,
                "latency_sec": round(elapsed, 3),
                "top": [
                    {"source": j.source_filename, "page": j.page_start, "preview": j.text[:120]}
                    for j in judged[:top_k]
                ],
            }
        )
        print(f"[{item['id']}] " + " ".join(f"{k}={v:.3f}" for k, v in scores.items()) + f" ({elapsed:.2f}s)")
    summary = aggregate([row["scores"] for row in rows])
    latencies = sorted(row["latency_sec"] for row in rows)
    if latencies:
        summary["latency_p50_sec"] = latencies[len(latencies) // 2]
    return {"summary": summary, "queries": rows}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--eval-set", type=Path, required=True)
    parser.add_argument("--label", required=True, help="결과 이름 (예: baseline, kure-v3)")
    parser.add_argument("--top-k", type=int, default=10)
    parser.add_argument("--project-id", default=None, help="항목에 project_id가 없을 때 쓸 기본값")
    parser.add_argument("--out-dir", type=Path, default=Path(__file__).resolve().parent / "results")
    args = parser.parse_args()

    import config  # noqa: F401  .env를 읽고 모델 설정을 확정한다.

    items = load_eval_set(args.eval_set)
    result = run(items, top_k=args.top_k, default_project_id=args.project_id)
    result["label"] = args.label
    result["created_at"] = datetime.now().isoformat(timespec="seconds")
    result["config"] = {key: os.getenv(key, "") for key in CONFIG_KEYS}
    result["eval_set"] = str(args.eval_set)
    result["top_k"] = args.top_k

    args.out_dir.mkdir(parents=True, exist_ok=True)
    out_path = args.out_dir / f"{args.label}.json"
    out_path.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print("\n[요약] " + " ".join(f"{k}={v:.3f}" for k, v in result["summary"].items()))
    print(f"[저장] {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
