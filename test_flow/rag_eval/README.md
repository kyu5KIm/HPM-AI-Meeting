# rag_eval: 검색 정확도 평가

모델·청킹을 바꾸기 전과 후의 검색 품질을 같은 질문으로 비교하는 도구입니다.
`/chat`과 같은 검색 경로(Dense + BM25 → RRF → Rerank)를 그대로 호출합니다.

## 1. 평가 세트 만들기

`eval_set.example.jsonl`을 복사해 `eval_set.jsonl`을 만들고, 팀 문서와 회의록 기준으로 질문 30~50개를 적습니다.

```json
{"id": "doc-001", "project_id": "1", "question": "올해 마케팅 예산 총액은?", "relevant": [{"source": "2026_사업계획", "page": 3, "contains": "마케팅 예산"}]}
```

| 필드 | 설명 |
| --- | --- |
| `question` | 실제 사용자가 할 법한 질문 |
| `relevant` | 정답 근거 목록. 항목 하나가 근거 하나 |
| `relevant[].source` | 파일명 일부 (회의록은 `이전회의록 제목`) |
| `relevant[].page` | 페이지 번호 (선택) |
| `relevant[].contains` | 근거 청크에 들어 있어야 하는 문구 (선택) |
| `scope` | `project`(기본), `meeting`, `internal` |
| `project_id`, `meeting_id` | 검색 범위 (선택) |

청크 ID는 다시 적재할 때마다 바뀌므로 쓰지 않습니다. 근거는 파일명·페이지·문구로만 지정합니다.
문서 종류(PDF, HWP, 회의록)와 질문 유형(사실 확인, 날짜, 담당자, 표 안의 숫자)을 고르게 섞는 것이 좋습니다.

## 2. 실행

`test_flow` 폴더에서 실행합니다. Qdrant와 API 키가 설정돼 있어야 합니다.

```bash
python -m rag_eval.run_eval --eval-set rag_eval/eval_set.jsonl --label baseline
```

결과는 `rag_eval/results/<label>.json`에 저장됩니다. 지표는 다음과 같습니다.

| 지표 | 의미 |
| --- | --- |
| `recall@10` | 정답 근거 중 상위 10개 안에 들어온 비율 |
| `ndcg@10` | 정답 근거가 위쪽에 있을수록 높은 점수 |
| `mrr` | 첫 정답 근거 순위의 역수 |
| `hit@10` | 정답 근거가 하나라도 상위 10개에 있으면 1 |

## 3. 비교

```bash
python -m rag_eval.compare rag_eval/results/baseline.json rag_eval/results/kure-v3.json
```

## 교체 전 기준 측정 순서

1. 교체 전 커밋(`docs/upgrade-plan.md`의 0단계 커밋)에서 기존 컬렉션으로 `--label baseline` 측정
2. 교체 커밋으로 이동해 새 컬렉션에 다시 적재
3. 같은 평가 세트로 `--label upgraded` 측정 후 `compare`로 비교
