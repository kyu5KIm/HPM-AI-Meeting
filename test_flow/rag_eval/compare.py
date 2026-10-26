"""두 평가 결과를 비교한다.

실행 (test_flow 폴더에서):
    python -m rag_eval.compare rag_eval/results/baseline.json rag_eval/results/kure-v3.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("사용법: python -m rag_eval.compare <기준.json> <비교.json>")
        return 2
    base, other = (json.loads(Path(path).read_text(encoding="utf-8")) for path in argv)
    print(f"{'지표':<16}{base['label']:>14}{other['label']:>14}{'차이':>10}")
    for key, value in base["summary"].items():
        new = other["summary"].get(key)
        if new is None:
            continue
        print(f"{key:<16}{value:>14.3f}{new:>14.3f}{new - value:>+10.3f}")

    base_rows = {row["id"]: row for row in base["queries"]}
    worse = []
    for row in other["queries"]:
        old = base_rows.get(row["id"])
        if not old:
            continue
        ndcg_key = next((k for k in row["scores"] if k.startswith("ndcg@")), None)
        if ndcg_key and row["scores"][ndcg_key] < old["scores"].get(ndcg_key, 0):
            worse.append((row["id"], old["scores"][ndcg_key], row["scores"][ndcg_key], row["question"]))
    if worse:
        print("\n[나빠진 질문]")
        for qid, old_score, new_score, question in worse:
            print(f"  {qid}: {old_score:.3f} -> {new_score:.3f}  {question}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
