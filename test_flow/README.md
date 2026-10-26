# test_flow

`test_flow`는 기존 `ai` 폴더의 흐름을 최대한 유지하면서 FastAPI 서버를 하나로 합친 로컬 테스트용 서버입니다.

바뀐 핵심은 기능 로직이 아니라 모델 실행부입니다. 회의록/안건/준비자료/챗봇 프롬프트, Qdrant 검색, 회의록 ingest, 문서 chunking, payload 구조는 기존 `ai/vllm`과 `ai/parsed` 코드를 대부분 가져오고, `model_runtime.py`에서만 OpenAI API 모델을 호출하도록 바꿨습니다.

## 모델 매핑

| 기능 | test_flow 모델 |
| --- | --- |
| LLM | `gpt-5.6-luna` (GPT-5 계열 추론 모델, `TEST_FLOW_REASONING_EFFORT`로 추론 강도 조절) |
| OCR | `gpt-5.6-luna` vision |
| STT | `gpt-4o-transcribe-diarize` |
| Embedding | KURE API `kure-v3` (1024차원, 질문/문서 `input_type` 구분) |
| Reranker | KURE API `kure-reranker-nano` (`TEST_FLOW_RERANK_PROVIDER=cohere`로 Cohere 사용 가능) |
| 문서 파서 | `kordoc` 4.24.1 (PDF·HWP·HWPX·DOCX·이미지), 스캔 페이지는 kordoc 로컬 OCR, 부족한 페이지만 Luna 보조 |
| Vector DB | Qdrant 유지 |

KURE API 키는 https://kure.kullm.ai 에서 GitHub 로그인으로 발급받아 `test_flow/.env`의 `KURE_API_KEY`에 넣습니다.
KURE API는 요청당 텍스트 8개, 기본 분당 60회·분당 200,000토큰·하루 4,000,000토큰 한도가 있어 `kure_api.py`가 요청 간격 조절과 429 재시도를 처리합니다.

`test_flow/.env`는 기존 `ai/vllm/.env`, `ai/stt/.env`, `ai/ocr/.env`, `ai/parsed/.env` 내용을 합쳐 둔 파일입니다. 값은 노출하지 않았고, 실행 시 `config.py`에서 모델 provider만 OpenAI로 고정합니다.

`OPENAI_BASE_URL`은 일반 OpenAI API를 쓰면 비워둡니다. OpenAI 호환 프록시나 사내 게이트웨이를 쓸 때만 입력하는 선택값입니다.

## 설치

```powershell
cd C:\Users\Playdata\Desktop\git\SKN24-FINAL-1Team
C:\Users\Playdata\miniconda3\envs\hpm_test_1\python.exe -m pip install -r test_flow\requirements.txt

# 문서 파서 kordoc (Node.js 20 이상 필요, 버전은 test_flow/kordoc/package-lock.json으로 고정)
cd test_flow\kordoc
npm ci
```

kordoc OCR 모델(PP-OCRv5 Korean, 약 18MB)은 스캔 문서를 처음 처리할 때 Hugging Face에서 자동으로 받습니다.
인터넷이 막힌 서버라면 온라인 PC에서 `npx kordoc models --export <dir>`로 내보낸 뒤 서버에서 `npx kordoc models --import <dir>`로 넣습니다.

## 실행

```powershell
cd C:\Users\Playdata\Desktop\git\SKN24-FINAL-1Team\test_flow
C:\Users\Playdata\miniconda3\envs\hpm_test_1\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8500 --reload
```

확인:

```powershell
curl http://localhost:8500/health
```

## 테스트

```bash
cd test_flow
pip install -r requirements.txt -r requirements-dev.txt
cd kordoc && npm ci && cd ..   # kordoc 통합 테스트용 (없으면 해당 테스트는 건너뜀)
python -m pytest -q tests
```

KURE·OpenAI API는 테스트 안에서 로컬 가짜 서버로, Qdrant는 메모리 모드로 대신하므로 API 키 없이 돌아갑니다. ffmpeg가 있으면 긴 녹음 분할 테스트도 실행됩니다.

## Django 연결

기존에는 RunPod/FastAPI가 기능별로 나뉘어 있었지만, `test_flow`에서는 모두 같은 서버를 바라보게 하면 됩니다.

```env
RUNPOD_CORE_BASE_URL=http://localhost:8500
RUNPOD_STT_BASE_URL=http://localhost:8500
RUNPOD_OCR_BASE_URL=http://localhost:8500
RUNPOD_PARSED_BASE_URL=http://localhost:8500
RAG_SERVER_URL=http://localhost:8500/chat
```

## 포함된 기능

- `/generate-minutes`, `/generate-minutes/jobs`
- `/generate-agendas`
- `/generate-preparation`
- `/chat`
- `/stt`, `/stt/jobs`, `/transcribe`, `/transcribe/jobs`
- `/ocr`, `/ocr/jobs`
- `/internal-docs/ingest`, `/internal-docs/ingest/jobs`

입출력 예시는 [API_SPEC.md](./API_SPEC.md)를 확인하면 됩니다. 프롬프트 구조는 [PROMPTS.md](./PROMPTS.md)와 [prompts.py](./prompts.py)에 정리했습니다.

## 긴 회의 녹음 (STT)

OpenAI 전사 API의 파일당 25MB·요청당 길이 제한을 서버에서 처리합니다(`stt_long_audio.py`, ffmpeg 필요).

1. 녹음을 모노·16kHz·32kbps mp3로 줄입니다(1시간 약 14MB).
2. 그래도 크거나 `STT_SEGMENT_SEC`(기본 20분)보다 길면, 목표 지점 ±30초 안의 무음 가운데에서 자르고 조각끼리 4초 겹칩니다.
3. 조각별 타임스탬프를 원래 시간으로 보정하고, 겹친 구간은 경계 이전에 시작한 발화는 앞 조각, 이후는 뒤 조각 것만 남깁니다.
4. 앞 조각에서 화자별 음성 샘플(2~10초)을 뽑아 다음 조각에 `known_speaker_references`로 넘겨 같은 사람에게 같은 이름(`SPEAKER_00`..)을 붙입니다. 참고 화자는 최대 4명이라 5명 이상이면 다섯 번째부터는 조각마다 새 이름이 붙을 수 있습니다.

## 문서 파싱

업로드 문서는 형식과 관계없이 `kordoc_parser.py` → 부모-자식 청커(`internal_docs/chunker.py`)를 거칩니다.

- 지원 형식: PDF, HWP, HWPX, DOCX, PNG/JPG/WebP, TXT
- kordoc이 제목·문단·표 블록과 페이지 번호를 돌려줍니다. 표는 병합 셀을 펼친 마크다운 표로 바꿉니다.
- 스캔 페이지는 kordoc 로컬 OCR로 읽고, OCR 후에도 글자가 `LOCAL_PDF_MIN_PAGE_CHARS`보다 적은 페이지만 `OCR_MODEL_ID`(Luna)로 다시 읽습니다. 끄려면 `KORDOC_LUNA_FALLBACK=false`.
- 청크 앞에는 문맥 헤더가 붙습니다: `[문서: 파일명]`, `[페이지: 3]`, `[위치: 2장 예산 > 2.1 마케팅 예산]`
- 회의록 청크에는 `[회의: 제목 / 일시]`, `[항목: 요약|회의록 본문|할 일]` 헤더가 붙습니다.
- `DOCUMENT_PARSER=local`로 두면 예전 PyMuPDF + pdfplumber 경로(PDF 전용)를 씁니다. 비교 측정용입니다.

## 재적재 (임베딩·청킹 변경 후)

임베딩 모델이 바뀌면 벡터 차원이 달라 기존 컬렉션을 쓸 수 없습니다. 새 컬렉션(`hpm_project_kure_*`)에 다시 적재합니다.
컬렉션은 기본 dense 벡터와 함께 `kure_sparse` sparse 벡터 자리를 미리 만들어 둡니다(KURE-Sparse 도입 시 재적재 없이 채움).

```bash
# 1) 교체 전 기준 측정 (rag_eval/README.md 참고)
# 2) test_flow 서버를 새 설정으로 실행
# 3) 백엔드에서 대상 확인 후 재적재
cd backend/hpm
python manage.py reingest_rag --dry-run
python manage.py reingest_rag            # 전체 프로젝트
python manage.py reingest_rag --project 3
# 4) 같은 평가 세트로 교체 후 측정, rag_eval.compare로 비교
```

- 문서: 백엔드 저장소(S3 또는 media)의 원본을 `/internal-docs/ingest/jobs`로 10개씩 다시 보내고 작업 완료를 기다립니다.
- 회의록: 회의가 끝난(`meeting_status=2`) 회의의 회의록과 태스크를 `/meeting-minutes/ingest`로 다시 넣습니다. 같은 회의를 다시 넣으면 기존 청크를 지우고 다시 씁니다.

## 주의

- 기존 로컬/HF/vLLM 모델 값이 `.env`에 남아 있어도 `test_flow`는 `TEST_FLOW_*` 설정을 우선합니다. 예전 `.env`에 `TEST_FLOW_EMBEDDING_PROVIDER=openai` 같은 값이 남아 있으면 새 기본값보다 우선하니 지워 주세요.
- 임베딩 모델마다 벡터 차원이 달라 컬렉션을 섞어 쓰면 안 됩니다. KURE-v3 컬렉션은 기본 이름이 `hpm_project_kure_*`라서 기존 `hpm_project_openai_*`와 분리됩니다.
- 로컬 문서 파싱은 `PyMuPDF`, `pdfplumber`, OpenAI OCR fallback 조합으로 동작합니다.
