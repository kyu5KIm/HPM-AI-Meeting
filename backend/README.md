# Backend

HPM 서비스의 Django REST API 서버입니다. 프론트엔드 요청을 받아 사용자/프로젝트/회의/문서/알림 데이터를 관리하고, STT/OCR/LLM/문서 파싱 AI 서버와 연동합니다.

## 폴더 구조

```text
backend/
├─ hpm/
│  ├─ manage.py
│  ├─ hpm/                 # Django project 설정
│  │  ├─ settings.py
│  │  ├─ urls.py
│  │  ├─ asgi.py
│  │  └─ wsgi.py
│  ├─ apps/
│  │  ├─ users/            # 사용자, 인증, Jira OAuth, 관리자 API
│  │  ├─ projects/         # 프로젝트, 멤버, Jira 보드 API
│  │  ├─ meetings/         # 회의, 녹음, 안건, 회의록, Jira task API
│  │  ├─ documents/        # 문서 업로드, parsed ingest 연동
│  │  ├─ chatbot/          # 회의/프로젝트 챗봇 API
│  │  └─ notifications/    # 알림, SSE stream API
│  ├─ media/               # 업로드 파일 저장 위치
│  ├─ templates/
│  ├─ package.json         # 일부 frontend 상태 패키지가 들어간 흔적
│  └─ seed_data.sql
├─ requirements.txt
└─ README.md
```

## 주요 기술

- Django
- Django REST Framework
- Simple JWT
- django-cors-headers
- PostgreSQL (Supabase)
- boto3 / S3
- AWS SES
- Jira REST API
- RunPod 또는 별도 FastAPI AI 서버 연동

## 실행 방법

```bash
cd backend/hpm
pip install -r ../requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

로컬 기본 주소:

```text
http://localhost:8000
```

프론트엔드에서 사용할 API base URL 예시:

```text
VITE_API_BASE_URL=http://localhost:8000/api
```

## 주요 환경변수

`settings.py`는 루트 `.env`와 `backend/hpm/.env`를 읽습니다.

| 이름 | 설명 | 예시 |
| --- | --- | --- |
| `SECRET_KEY` | Django secret key | 운영에서는 필수 |
| `DB_NAME` | PostgreSQL DB 이름 | `postgres` |
| `DB_USER` | PostgreSQL 사용자 | `postgres.<project-ref>` (Supabase pooler) |
| `DB_PASSWORD` | PostgreSQL 비밀번호 | Supabase DB 비밀번호 |
| `DB_HOST` | PostgreSQL host | `aws-0-ap-northeast-2.pooler.supabase.com` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `DB_SSLMODE` | SSL 모드 | Supabase는 `require`, 로컬은 `prefer` |
| `DB_CONN_MAX_AGE` | DB 연결 재사용 시간(초) | `60` |
| `DEFAULT_USER_PASSWORD` | 관리자 생성 사용자 초기 비밀번호 | 내부 정책 값 |
| `RUNPOD_CORE_BASE_URL` | vLLM/core AI 서버 주소 | `http://localhost:8504` |
| `RUNPOD_STT_BASE_URL` | STT 서버 주소 | `http://localhost:8502` |
| `RUNPOD_OCR_BASE_URL` | OCR 서버 주소 | `http://localhost:8501` |
| `RUNPOD_PARSED_BASE_URL` | parsed 문서 ingest 서버 주소 | `http://localhost:8503` |
| `RAG_SERVER_URL` | 챗봇 API 주소 | `http://localhost:8504/chat` |
| `JIRA_BASE_URL` | Jira base URL | `https://your-domain.atlassian.net` |
| `JIRA_API_TOKEN` | Jira API token | secret |
| `JIRA_PROJECT_KEY` | 기본 Jira project key | `HPM` |
| `JIRA_CLIENT_ID` | Jira OAuth client ID | secret |
| `JIRA_CLIENT_SECRET` | Jira OAuth secret | secret |
| `JIRA_REDIRECT_URI` | Jira OAuth callback | `http://localhost:8000/api/jira/callback/` |
| `AWS_REGION` | AWS SES region | `ap-northeast-2` |
| `SES_FROM_EMAIL` | SES 발신 이메일 | `noreply@example.com` |
| `AWS_STORAGE_BUCKET_NAME` | S3 bucket 이름 | 선택 |
| `AWS_S3_REGION_NAME` | S3 region | `ap-northeast-2` |

`.env`는 Git에 올리지 않습니다.

## .env 양식

`backend/hpm/.env.example`을 `backend/hpm/.env`로 복사해서 채우면 됩니다(전체 항목과 설명 포함). 아래는 주요 항목 예시이며, 실제 secret 값은 팀 배포 환경에 맞게 채웁니다.

```dotenv
# Django
SECRET_KEY=change-me
CSRF_TRUSTED_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
DEFAULT_USER_PASSWORD=change-me

# PostgreSQL (Supabase 대시보드 > Connect > Session pooler 값)
DB_NAME=postgres
DB_USER=postgres.<project-ref>
DB_PASSWORD=change-me
DB_HOST=aws-0-ap-northeast-2.pooler.supabase.com
DB_PORT=5432
DB_SSLMODE=require

# AI / RunPod services
RUNPOD_CORE_BASE_URL=http://localhost:8504
RUNPOD_STT_BASE_URL=http://localhost:8502
RUNPOD_OCR_BASE_URL=http://localhost:8501
RUNPOD_PARSED_BASE_URL=http://localhost:8503
RAG_SERVER_URL=http://localhost:8504/chat

# Jira REST / OAuth
JIRA_BASE_URL=https://your-domain.atlassian.net
JIRA_API_TOKEN=
JIRA_PROJECT_KEY=HPM
JIRA_CLIENT_ID=
JIRA_CLIENT_SECRET=
JIRA_REDIRECT_URI=http://localhost:8000/api/jira/callback/

# AWS SES
AWS_REGION=ap-northeast-2
SES_FROM_EMAIL=

# AWS S3
AWS_STORAGE_BUCKET_NAME=
AWS_S3_REGION_NAME=ap-northeast-2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

## API 구성

루트 라우팅은 `backend/hpm/hpm/urls.py`에서 관리합니다.

| Prefix | 앱 | 설명 |
| --- | --- | --- |
| `/api/users/` | `apps.users` | 로그인, 로그아웃, 내 정보, 사용자 조회/수정 |
| `/api/projects/` | `apps.projects` | 프로젝트 생성/조회, 멤버, Jira 보드 |
| `/api/meetings/` | `apps.meetings` | 회의 생성, 시작/종료, 안건, 회의록, task, 이메일 |
| `/api/documents/` | `apps.documents` | 문서 업로드, 목록, 삭제, ingest 상태 |
| `/api/chat/` | `apps.chatbot` | 회의/프로젝트 챗봇 |
| `/api/notifications/` | `apps.notifications` | 알림 목록, 읽음, 삭제, stream |
| `/api/jira/*` | `apps.users.views` | Jira OAuth와 Jira board API |
| `/api/admin/*` | `apps.users.views` | 관리자 사용자/부서/직급 API |

## 대표 API

### 사용자

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/users/login/` | 로그인 |
| `POST` | `/api/users/logout/` | 로그아웃 |
| `GET` | `/api/users/me/` | 내 정보 |
| `GET` | `/api/users/` | 사용자 목록 |
| `GET/PATCH` | `/api/users/{users_id}/` | 사용자 상세/수정 |
| `GET` | `/api/users/{users_id}/projects/` | 사용자 프로젝트 목록 |
| `POST` | `/api/users/token/refresh/` | JWT access token 갱신 |

### 프로젝트

| Method | Path | 설명 |
| --- | --- | --- |
| `GET/POST` | `/api/projects/` | 프로젝트 목록/생성 |
| `GET` | `/api/projects/user/{user_id}/` | 사용자별 프로젝트 |
| `GET/PATCH/DELETE` | `/api/projects/{project_id}/` | 프로젝트 상세/수정/삭제 |
| `GET` | `/api/projects/{project_id}/jira-board/` | 프로젝트 Jira 보드 |
| `GET/PATCH` | `/api/projects/{project_id}/jira-board/issue/{issue_key}/` | Jira issue 상세/수정 |

### 회의

| Method | Path | 설명 |
| --- | --- | --- |
| `GET/POST` | `/api/meetings/` | 회의 목록/생성 |
| `GET/PATCH` | `/api/meetings/{meeting_id}/` | 회의 상세/수정 |
| `POST` | `/api/meetings/{meeting_id}/start/` | 회의 시작 |
| `POST` | `/api/meetings/{meeting_id}/pause/` | 녹음 일시정지 |
| `POST` | `/api/meetings/{meeting_id}/resume/` | 녹음 재개 |
| `POST` | `/api/meetings/{meeting_id}/reset-recording/` | 녹음 초기화 |
| `POST` | `/api/meetings/{meeting_id}/end/` | 회의 종료, STT/회의록 처리 |
| `POST` | `/api/meetings/{meeting_id}/minutes/` | 회의록 생성 |
| `GET/POST` | `/api/meetings/{meeting_id}/agenda/` | 안건 조회/저장 |
| `POST` | `/api/meetings/{meeting_id}/agenda/generate/` | 안건 생성 |
| `GET` | `/api/meetings/{meeting_id}/agenda/status/` | 안건 생성 상태 |
| `POST` | `/api/meetings/{meeting_id}/agenda/confirm/` | 안건 확정 |
| `GET/POST` | `/api/meetings/{meeting_id}/tasks/` | 회의 task 목록/생성 |
| `PATCH` | `/api/meetings/{meeting_id}/tasks/{task_id}/` | 회의 task 수정 |
| `POST` | `/api/meetings/{meeting_id}/jira/` | Jira task 등록 |
| `POST` | `/api/meetings/{meeting_id}/email/` | 회의 요약 이메일 발송 |
| `GET/POST` | `/api/meetings/{meeting_id}/prep/` | 회의 준비자료 조회/저장 |
| `POST` | `/api/meetings/{meeting_id}/prep/generate/` | 회의 준비자료 생성 |
| `GET` | `/api/meetings/{meeting_id}/prep/status/` | 준비자료 생성 상태 |

### 문서

| Method | Path | 설명 |
| --- | --- | --- |
| `GET` | `/api/documents/upload-config/` | 업로드 제한 조회 |
| `GET/POST` | `/api/documents/{project_id}/` | 문서 목록/업로드 |
| `POST` | `/api/documents/{project_id}/ingest/` | parsed ingest 시작 |
| `GET` | `/api/documents/{project_id}/ingest/status/` | parsed ingest 상태 조회 |
| `DELETE` | `/api/documents/{project_id}/{document_id}/` | 문서 삭제 |

### 챗봇/알림

| Method | Path | 설명 |
| --- | --- | --- |
| `POST` | `/api/chat/{meeting_id}/` | 회의 기준 챗봇 질문 |
| `GET` | `/api/chat/{meeting_id}/history/` | 회의 챗봇 기록 |
| `POST` | `/api/chat/project/{project_id}/` | 프로젝트 기준 챗봇 질문 |
| `GET` | `/api/notifications/` | 알림 목록 |
| `GET` | `/api/notifications/stream/` | SSE 알림 stream |
| `PATCH` | `/api/notifications/{notification_id}/read/` | 읽음 처리 |
| `DELETE` | `/api/notifications/{notification_id}/` | 알림 삭제 |
| `DELETE` | `/api/notifications/all/` | 전체 알림 삭제 |

## AI 서버 연동 흐름

- 회의 종료 시: 녹음 파일 → STT 서버 → transcript → core LLM 서버 → 회의록/todo 생성
- 회의 준비자료 생성 시: core LLM 서버가 이전 회의, 내부 문서, 뉴스 검색 결과를 조합
- 문서 업로드 시: backend 저장소/S3 저장 → parsed 서버 ingest job 요청 → Qdrant 적재
- 챗봇 질문 시: backend → core LLM/RAG 서버 → 답변 반환

## Docker 배포

루트의 `docker-compose.yml`은 backend와 frontend 서비스를 함께 실행합니다.

```bash
docker-compose up --build
```

backend 컨테이너는 `Dockerfile.backend`를 사용하며, 내부에서 다음을 수행합니다.

```bash
python manage.py migrate
python manage.py runserver 0.0.0.0:8000
```

## 개발 시 주의사항

- `backend/hpm/media/`는 업로드 데이터이므로 Git에 올리지 않습니다.
- `.env`, DB dump, 개인 API token은 Git에 올리지 않습니다.
- 운영에서는 `DEBUG=False`, 안전한 `SECRET_KEY`, 제한된 `ALLOWED_HOSTS` 설정이 필요합니다.
- AI 서버 URL이 비어 있으면 회의록, STT, 문서 ingest, 챗봇 기능이 실패할 수 있습니다.
- S3 bucket 이름이 있으면 Django storage backend가 S3로 전환됩니다.
