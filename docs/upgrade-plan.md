# test_flow 모델·문서처리 교체 계획 (2026-10)

2026년 초에 정한 모델 구성을 2026년 10월 기준으로 다시 점검하고, `test_flow`(OpenAI API 기반 로컬 테스트 서버)부터 교체한다.
본판(`ai/`, RunPod GPU 자체 서빙)은 `test_flow`에서 검증한 뒤 별도로 옮긴다.

## 0단계: 교체 전 기준 측정

| 항목 | 내용 |
| --- | --- |
| 평가 세트 | 팀 문서·회의록으로 질문과 정답 근거 30~50개 작성 (`test_flow/eval/`) |
| 평가 스크립트 | 검색 정확도(nDCG@10, Recall@10, MRR) 측정 |
| 기준 측정 | 교체 **전** 구성(`text-embedding-3-small` + BM25 + Cohere)으로 먼저 측정 |

## 1단계: 모델 교체

| 영역 | 현재 | 교체 |
| --- | --- | --- |
| 임베딩 | `text-embedding-3-small` | **KURE-v3** (API, 질문/문서 `input_type` 구분, 1024차원) |
| LLM | `gpt-4.1-mini` | **GPT-5.6 Luna** |
| 리랭커 | Cohere `rerank-v3.5` | **KURE 리랭커** (`kure-reranker-nano`, API) |
| STT | `gpt-4o-transcribe-diarize` | 유지 + 길이 제한 해제 (4단계) |
| 키워드 검색 | BM25 (정규식) | 유지. KURE-Sparse와 평가 세트로 비교 후 결정 |

## 2단계: 문서 처리

| 영역 | 현재 | 교체 |
| --- | --- | --- |
| 문서 파서 | PyMuPDF + pdfplumber + python-docx | **kordoc** (버전 고정, Node.js 20 이상) |
| OCR | `gpt-4.1-mini` vision | **kordoc 로컬 OCR** (PP-OCRv5 Korean). 결과가 나쁠 때만 Luna 보조 |
| 청킹 ① 문서 | 부모-자식 + 문맥 헤더 | 유지. kordoc 블록을 그대로 입력 |
| 문맥 헤더 | 제목을 텍스트에서 추측 | kordoc 제목 경로 추가 (`[위치: 3장 > 3.2 예산 > 표 2]`) |
| 청킹 ② 업로드 문서 | 단순 분할 | 제거, ①로 통일 |
| 청킹 ③ 회의록 | 문맥 헤더 없음 | `[회의: 제목 / 일시]` 헤더 추가 |

## 3단계: HWP 지원 추가

| 위치 | 할 일 |
| --- | --- |
| `frontend/hpm/src/constants/documentManagement.ts` | 허용 확장자에 `hwp`, `hwpx` 추가 |
| `frontend/hpm/src/components/document/DocumentUploadPanel.tsx` | 파일 선택창 `accept`에 추가 |
| `backend/hpm/apps/documents/views.py` | 허용 확장자 추가 |
| `test_flow/internal_docs/routes.py`, `service.py` | 허용 확장자 추가, kordoc으로 전달 |
| 문서 미리보기 | 브라우저에서 HWP 표시 방식 확인 |

## 4단계: STT 길이 제한 해제

OpenAI 전사 API의 파일당 25MB 제한은 서버 쪽에서 우회한다.

| 단계 | 내용 |
| --- | --- |
| 압축 | ffmpeg로 모노, 16kHz, 저비트레이트 변환 |
| 분할 | 일정 길이 단위로 자르고 경계를 몇 초 겹침 |
| 병합 | 타임스탬프 보정, 겹친 구간 중복 제거 |
| 화자 맞추기 | 첫 조각의 화자별 음성 샘플을 다음 조각에 참고 화자로 전달 (최대 4명) |

## 5단계: 적재와 검증

| 항목 | 내용 |
| --- | --- |
| Qdrant | 새 컬렉션 생성. dense 벡터와 함께 sparse 벡터 자리도 미리 마련 |
| 재적재 | 문서·회의록 전체를 새 컬렉션에 적재 |
| 교체 후 측정 | 0단계와 같은 평가 세트로 비교 |
| KURE-Sparse 비교 | BM25 대비 평가 후 교체 여부 결정 |

## 공통 처리

- KURE API: 요청당 8개 제한, 429 재시도, 분당·일일 한도에 맞춘 속도 조절
- GPT-5 계열 파라미터 차이(`temperature`, `max_tokens`) 대응
- 실행 환경에 Node.js, kordoc, ffmpeg 설치, OCR 모델 사전 다운로드
- `.env`에 `KURE_API_KEY` 등 추가. 키는 환경 변수로만 읽는다

## 이번에 하지 않는 것

| 항목 | 이유 |
| --- | --- |
| jev 리랭커 | 한국어 근거 없음, 비영어(MIRACL fr)에서 bge-reranker-v2-m3보다 낮음 |
| Kiwi 형태소 분석기 | KURE-Sparse 비교로 대체 |
| LLM 기반 청크 문맥 생성 | 비용 대비 효과 불확실, 제목 경로 헤더로 대부분 대체 |
| 본판(`ai/`) 이전 | `test_flow` 검증 후 별도 진행 |

## 근거 자료

- 한국어 검색 임베딩·리랭커·sparse: [KURE 리더보드](https://github.com/nlpai-lab/KURE) (MTEB kor v2 Retrieval 9개 과제)
  - KURE-v3 0.8027, Qwen3-Embedding-8B 0.7826, bge-m3 0.7509 (nDCG@10)
  - KURE-Reranker-base 0.8908, KURE-Reranker-nano 0.8757, bge-reranker-v2-m3 0.8518
  - KURE-Sparse-base 0.7984, KURE-Sparse-nano 0.7716
- 문서 파서: [kordoc](https://github.com/chrisryugj/kordoc) (제작자 측정 opendataloader-bench 0.964, MinerU 0.831)
- 리랭커 비교: [jev-rerank-bench](https://github.com/anessbelbati/jev-rerank-bench)
- GPT-5.6 가격 인하(2026-07-30): Luna 입력 $0.20 / 출력 $1.20 (100만 토큰당)
