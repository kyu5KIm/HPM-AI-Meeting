import os
from pathlib import Path
from dotenv import load_dotenv
from datetime import timedelta
import boto3



BASE_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BASE_DIR.parent.parent

# 절대경로 → 상대경로로 변경 (parents[3]는 .env 위치에 맞게 조정)
load_dotenv(PROJECT_ROOT / ".env")
load_dotenv(BASE_DIR / ".env", override=True)

SECRET_KEY = os.getenv("SECRET_KEY", "django-insecure-^ai6lg-1&n^afjylo6rs$2s(!5)j(449z=!vfje)7h7xb71!*v")

DEBUG = True

ALLOWED_HOSTS = ["*"]

INSTALLED_APPS = [
    'rest_framework',
    'corsheaders',
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'apps.users',
    'apps.projects',
    'apps.meetings',
    'apps.documents',
    'apps.chatbot',
    'apps.notifications',
]

MIDDLEWARE = [
    "corsheaders.middleware.CorsMiddleware",
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'hpm.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [BASE_DIR / 'templates'],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'hpm.wsgi.application'

# ── DB (MySQL) ───────────────────────────────────────────────────
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': os.getenv("DB_NAME", "hpm_db"),
        'USER': os.getenv("DB_USER", "root"),
        'PASSWORD': os.getenv("DB_PASSWORD", "1234"),
        'HOST': os.getenv("DB_HOST", "localhost"),
        'PORT': os.getenv("DB_PORT", "3306"),
        'OPTIONS': {'charset': 'utf8mb4'},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]

LANGUAGE_CODE = 'ko-kr'
TIME_ZONE = 'Asia/Seoul'
USE_I18N = True
USE_TZ = True

STATIC_URL = 'static/'

# ── CORS ─────────────────────────────────────────────────────────
CORS_ALLOW_ALL_ORIGINS = False

CORS_ALLOW_CREDENTIALS = True

CORS_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "https://hpm-meeting.site",
    "https://www.hpm-meeting.site",
]

CSRF_TRUSTED_ORIGINS = os.getenv(
    "CSRF_TRUSTED_ORIGINS",
    "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5174,http://127.0.0.1:5174",
).split(",")

# ── 미디어 파일 ───────────────────────────────────────────────────
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'

# ── 외부 서비스 URL (환경에 맞게 수정) ───────────────────────────
RUNPOD_CORE_BASE_URL = os.getenv("RUNPOD_CORE_BASE_URL", os.getenv("RUNPOD_BASE_URL", ""))
RUNPOD_STT_BASE_URL = os.getenv("RUNPOD_STT_BASE_URL", os.getenv("RUNPOD_BASE_URL", ""))
RUNPOD_OCR_BASE_URL = os.getenv("RUNPOD_OCR_BASE_URL", "")
RUNPOD_PARSED_BASE_URL = os.getenv("RUNPOD_PARSED_BASE_URL", os.getenv("RUNPOD_PARSERD_BASE_URL", ""))

# 내부 문서 업로드 허용 확장자. test_flow(kordoc)는 HWP·HWPX를 읽는다.
# HWP를 지원하지 않는 AI 서버(ai/parsed)에 연결할 때는 ".pdf,.docx,.txt"로 줄인다.
DOCUMENT_ALLOWED_EXTENSIONS = {
    ext.strip().lower() if ext.strip().startswith(".") else f".{ext.strip().lower()}"
    for ext in os.getenv("DOCUMENT_ALLOWED_EXTENSIONS", ".pdf,.hwp,.hwpx,.docx,.txt").split(",")
    if ext.strip()
}

RUNPOD_CHAT_URL = RUNPOD_CORE_BASE_URL
RUNPOD_BASE_URL = RUNPOD_CORE_BASE_URL
RUNPOD_MINUTES_URL = f"{RUNPOD_CORE_BASE_URL}/generate"
RAG_SERVER_URL = os.getenv(
    "RAG_SERVER_URL",
    f"{RUNPOD_CORE_BASE_URL}/chat" if RUNPOD_CORE_BASE_URL else "http://127.0.0.1:8088/chat",
)

# Jira 연동 (옵션)
JIRA_BASE_URL    = os.getenv("JIRA_BASE_URL", "")
JIRA_API_TOKEN   = os.getenv("JIRA_API_TOKEN", "")
JIRA_PROJECT_KEY = os.getenv("JIRA_PROJECT_KEY", "HPM")

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'


REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": (
        "apps.users.authentication.CustomJWTAuthentication",
    ),
    "DEFAULT_PERMISSION_CLASSES": (
        "rest_framework.permissions.IsAuthenticated",
    ),
}

SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME' : timedelta(days=1),
    'REFRESH_TOKEN_LIFETIME' : timedelta(days=1),
}

DEFAULT_USER_PASSWORD = os.getenv('DEFAULT_USER_PASSWORD')

# AWS SES
AWS_REGION = os.environ.get("AWS_REGION", "ap-northeast-2")
DEFAULT_FROM_EMAIL = os.environ.get("SES_FROM_EMAIL")

# AWS S3
# -------------------------------설명---------------------------------
# 문서 관리 페이지 접속
# → 백엔드가 S3에서 1시간짜리 presigned URL 새로 발급
# → 화면에 파일 목록 표시
# 1시간 안에 다운로드 클릭 → 성공
# 1시간 지난 후 다운로드 클릭 → 실패
#     → F5 새로고침 하면 새 URL 발급 → 다운로드 성공
# --------------------------------------------------------------------

# 어느 S3 버킷에 저장할지
AWS_STORAGE_BUCKET_NAME = os.environ.get("AWS_STORAGE_BUCKET_NAME", "")

# 버킷이 있는 리전 (ap-northeast-2 = 서울)
AWS_S3_REGION_NAME = os.environ.get("AWS_S3_REGION_NAME", "ap-northeast-2")
AWS_S3_ENDPOINT_URL = os.environ.get(
    "AWS_S3_ENDPOINT_URL",
    f"https://s3.{AWS_S3_REGION_NAME}.amazonaws.com",
)
AWS_S3_SIGNATURE_VERSION = "s3v4"

# 같은 이름 파일 업로드 시 덮어쓰지 않고 자동으로 이름 변경
AWS_S3_FILE_OVERWRITE = False

# 버킷을 비공개로 유지 (URL만 알면 누구나 접근 가능한 퍼블릭 아님)
AWS_DEFAULT_ACL = None

# 파일 다운로드 시 presigned URL 방식 사용
AWS_QUERYSTRING_AUTH = True

# presigned URL 유효시간 (3600초 = 1시간)
AWS_QUERYSTRING_EXPIRE = 3600

if AWS_STORAGE_BUCKET_NAME:   # .env에 버킷 이름이 있으면
    STORAGES = {
        # 파일 저장 기본값 → S3에 저장
        "default": {"BACKEND": "storages.backends.s3.S3Storage"},
        "staticfiles": {
            "BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage",
        },
    }
