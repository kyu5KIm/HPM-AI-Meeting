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
| PDF parser | `PyMuPDF` + `pdfplumber`, 필요 시 OCR fallback |
| Vector DB | Qdrant 유지 |

KURE API 키는 https://kure.kullm.ai 에서 GitHub 로그인으로 발급받아 `test_flow/.env`의 `KURE_API_KEY`에 넣습니다.
KURE API는 요청당 텍스트 8개, 기본 분당 60회·분당 200,000토큰·하루 4,000,000토큰 한도가 있어 `kure_api.py`가 요청 간격 조절과 429 재시도를 처리합니다.

`test_flow/.env`는 기존 `ai/vllm/.env`, `ai/stt/.env`, `ai/ocr/.env`, `ai/parsed/.env` 내용을 합쳐 둔 파일입니다. 값은 노출하지 않았고, 실행 시 `config.py`에서 모델 provider만 OpenAI로 고정합니다.

`OPENAI_BASE_URL`은 일반 OpenAI API를 쓰면 비워둡니다. OpenAI 호환 프록시나 사내 게이트웨이를 쓸 때만 입력하는 선택값입니다.

## 설치

```powershell
cd C:\Users\Playdata\Desktop\git\SKN24-FINAL-1Team
C:\Users\Playdata\miniconda3\envs\hpm_test_1\python.exe -m pip install -r test_flow\requirements.txt
```

## 실행

```powershell
cd C:\Users\Playdata\Desktop\git\SKN24-FINAL-1Team\test_flow
C:\Users\Playdata\miniconda3\envs\hpm_test_1\python.exe -m uvicorn app:app --host 127.0.0.1 --port 8500 --reload
```

확인:

```powershell
curl http://localhost:8500/health
```

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

## 문서 파싱

문서 파싱은 로컬 parser만 사용합니다.

- 일반 PDF 텍스트: `PyMuPDF`로 빠르게 추출합니다.
- PDF 표: `pdfplumber`로 표를 markdown table 형태로 추출합니다.
- 스캔 PDF 또는 추출 실패: `gpt-4.1-mini` vision OCR fallback을 사용합니다.
- DOCX/TXT: 로컬 텍스트 추출 후 기존 parent-child chunk 구조로 적재합니다.

청킹은 기존 `Hierarchical Parent-Child` 전략을 유지합니다. parser가 달라져도 `parent_id`, `parent_text`, `child_index`, `child_count`, page/source metadata는 Qdrant payload에 계속 들어갑니다.

## 주의

- 기존 로컬/HF/vLLM 모델 값이 `.env`에 남아 있어도 `test_flow`는 `TEST_FLOW_*` 설정을 우선합니다. 예전 `.env`에 `TEST_FLOW_EMBEDDING_PROVIDER=openai` 같은 값이 남아 있으면 새 기본값보다 우선하니 지워 주세요.
- 임베딩 모델마다 벡터 차원이 달라 컬렉션을 섞어 쓰면 안 됩니다. KURE-v3 컬렉션은 기본 이름이 `hpm_project_kure_*`라서 기존 `hpm_project_openai_*`와 분리됩니다.
- 로컬 문서 파싱은 `PyMuPDF`, `pdfplumber`, OpenAI OCR fallback 조합으로 동작합니다.
