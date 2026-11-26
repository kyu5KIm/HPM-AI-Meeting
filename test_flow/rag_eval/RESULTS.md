# rag_eval 측정 기록

## 2026-11-27 검색 후보 수 50 vs 20

하이브리드 RAG 응답 시간을 22초에서 13초로 줄일 때 `dense_k`·`bm25_k`를 50에서 20으로 줄였다.
후보를 줄여도 검색 품질이 유지되는지 같은 질문으로 비교했다.

### 환경

| 항목 | 값 |
| --- | --- |
| 문서 | `backend/hpm/media/documents/1` D.gov·AI.GOV 해외동향 PDF 10개 |
| 파싱·청킹 | kordoc 4.24.9, `local_parent_child_650`, 청크 833개 |
| 임베딩 / 리랭커 | KURE `kure-v3` / `kure-reranker-nano` |
| Qdrant | 로컬 파일 모드 (`rag_eval/local_qdrant.py`). Qdrant Cloud 클러스터에 연결되지 않아 로컬로 적재했다 |
| 평가 세트 | `rag_eval/eval_set.jsonl` 35문항 |
| 바꾼 값 | `RAG_DENSE_K`·`RAG_BM25_K`만 50 / 20. `top_k`=10, RRF·리랭크 설정은 기본값 그대로 |

### 결과

| 지표 | 후보 50 | 후보 20 |
| --- | --- | --- |
| Recall@10 | 1.000 | 0.971 |
| nDCG@10 | 0.924 | 0.915 |
| MRR | 0.898 | 0.895 |
| Hit@10 | 1.000 | 0.971 |
| 검색 시간 중앙값 | 1.99초 | 1.97초 |

- 35문항 중 34문항은 두 설정의 점수가 같았다.
- 놓친 1문항은 `ai26-1-03`(CES 2026 온디바이스·엣지 AI)이다. 정답 청크가 문서에 하나뿐이고, 후보 50에서도 9위였는데 후보 20에서는 상위 10개 밖으로 밀렸다.
- 검색 시간은 거의 같다. 이 환경에서는 KURE 임베딩·리랭크 API 호출이 각각 약 1초로 대부분을 차지하고, Dense·BM25 검색은 0.1초 미만이다.

### 한계

- 평가 세트는 문서를 읽고 직접 쓴 합성 질문이다. 질문과 문서 표현이 겹쳐 점수가 만점에 가깝고, 실제 사용자 질문보다 쉬울 수 있다.
- 22초 → 13초를 측정한 2026년 6월 HPM(ko-sroberta 임베딩)과 임베딩·리랭커가 다르다. 그때의 시스템을 다시 잰 것이 아니다.
- `★D.gov_해외동향_2024-1호.pdf`는 페이지가 제대로 나뉘지 않아 parent가 10개뿐이다. 이 문서의 질문 3개는 맞히기 쉬운 편이다.
- 다음 단계: 실제 회의 질문과 회의록을 넣은 평가 세트로 다시 잰다.

### 재현

```bash
cd test_flow
export LOCAL_QDRANT_PATH=/path/to/qdrant_local
python rag_eval/local_qdrant.py ingest . ../backend/hpm/media/documents/1 1
RAG_DENSE_K=50 RAG_BM25_K=50 python rag_eval/local_qdrant.py eval . -- --eval-set rag_eval/eval_set.jsonl --label cand50 --project-id 1
RAG_DENSE_K=20 RAG_BM25_K=20 python rag_eval/local_qdrant.py eval . -- --eval-set rag_eval/eval_set.jsonl --label cand20 --project-id 1
```

결과 JSON(`rag_eval/results/`)은 git에서 제외된다.
