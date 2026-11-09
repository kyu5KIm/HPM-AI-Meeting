"""임베딩 모델·청킹을 바꾼 뒤 내부 문서와 회의록을 새 Qdrant 컬렉션에 다시 적재한다.

사용 예:
    python manage.py reingest_rag --dry-run
    python manage.py reingest_rag --project 3
    python manage.py reingest_rag --skip-meetings
"""
import os
import time

import requests
from django.conf import settings
from django.core.management.base import BaseCommand

from apps.documents.models import Document
from apps.documents.views import _parsed_base_url, _start_parsed_ingest_from_storage
from apps.meetings.models import Meeting, MeetingTask
from apps.meetings.views import meeting_datetime_text

DONE_STATUSES = {"succeeded", "failed"}


def _batched(items, size):
    for start in range(0, len(items), size):
        yield items[start : start + size]


def _todo_list(meeting):
    tasks = MeetingTask.objects.filter(meeting=meeting).select_related("meeting_users__user")
    todos = []
    for task in tasks:
        owner = getattr(getattr(task.meeting_users, "user", None), "name", None) if task.meeting_users_id else None
        todos.append(
            {
                "title": task.title,
                "owner": owner or "미정",
                "due_date": task.due_date.isoformat() if task.due_date else "미정",
                "priority": task.priority or "미정",
                "content": task.content or "",
            }
        )
    return todos


class Command(BaseCommand):
    help = "내부 문서와 회의록을 현재 AI 서버 설정(임베딩·컬렉션)으로 다시 적재합니다."

    def add_arguments(self, parser):
        parser.add_argument("--project", type=int, action="append", help="대상 프로젝트 ID (여러 번 지정 가능, 기본: 전체)")
        parser.add_argument("--skip-documents", action="store_true")
        parser.add_argument("--skip-meetings", action="store_true")
        parser.add_argument("--batch-size", type=int, default=10, help="적재 작업 하나에 넣을 문서 수 (업로드 제한과 같은 10)")
        parser.add_argument("--no-wait", action="store_true", help="문서 적재 작업 완료를 기다리지 않음")
        parser.add_argument("--poll-sec", type=float, default=10.0)
        parser.add_argument("--dry-run", action="store_true", help="대상만 출력하고 적재하지 않음")

    def handle(self, *args, **options):
        project_ids = options["project"] or sorted(
            set(Document.objects.values_list("project_id", flat=True))
            | set(Meeting.objects.values_list("project_id", flat=True))
        )
        failures = 0
        for project_id in project_ids:
            self.stdout.write(self.style.MIGRATE_HEADING(f"[프로젝트 {project_id}]"))
            if not options["skip_documents"]:
                failures += self._documents(project_id, options)
            if not options["skip_meetings"]:
                failures += self._meetings(project_id, options)
        if failures:
            self.stderr.write(self.style.ERROR(f"실패 {failures}건. 위 로그를 확인하세요."))
        else:
            self.stdout.write(self.style.SUCCESS("재적재 완료"))

    def _documents(self, project_id, options):
        documents = [
            doc
            for doc in Document.objects.filter(project_id=project_id).order_by("document_id")
            if os.path.splitext(doc.title)[1].lower() in settings.DOCUMENT_ALLOWED_EXTENSIONS
        ]
        self.stdout.write(f"  문서 {len(documents)}개")
        if options["dry_run"] or not documents:
            for doc in documents:
                self.stdout.write(f"    - {doc.document_id}: {doc.title}")
            return 0
        failures = 0
        for batch in _batched(documents, options["batch_size"]):
            info = _start_parsed_ingest_from_storage(project_id, batch)
            job_id = info.get("ingest_job_id")
            names = ", ".join(doc.title for doc in batch)
            if not job_id:
                failures += 1
                self.stderr.write(f"    적재 요청 실패: {info.get('ingest_error')} ({names})")
                continue
            self.stdout.write(f"    작업 {job_id}: {names}")
            if not options["no_wait"]:
                failures += self._wait(job_id, options["poll_sec"])
        return failures

    def _wait(self, job_id, poll_sec):
        url = f"{_parsed_base_url()}/internal-docs/ingest/jobs/{job_id}"
        while True:
            try:
                snapshot = requests.get(url, timeout=60).json()
            except (requests.RequestException, ValueError) as exc:
                self.stderr.write(f"    상태 확인 실패({exc}), {poll_sec:.0f}초 후 재시도")
                time.sleep(poll_sec)
                continue
            status = snapshot.get("status")
            if status in DONE_STATUSES:
                if status == "failed":
                    self.stderr.write(f"    작업 {job_id} 실패: {snapshot.get('error')}")
                    return 1
                result = snapshot.get("result") or {}
                self.stdout.write(f"    작업 {job_id} 완료: {result.get('upserted', '?')}개 청크")
                return 0
            time.sleep(poll_sec)

    def _meetings(self, project_id, options):
        meetings = list(
            Meeting.objects.filter(project_id=project_id, meeting_status=Meeting.MeetingStatus.FINISHED)
            .exclude(meeting_document__isnull=True)
            .exclude(meeting_document="")
            .order_by("meeting_id")
        )
        self.stdout.write(f"  회의록 {len(meetings)}개")
        if options["dry_run"] or not meetings:
            for meeting in meetings:
                self.stdout.write(f"    - {meeting.meeting_id}: {meeting.title}")
            return 0
        base_url = (getattr(settings, "RUNPOD_CORE_BASE_URL", "") or "").rstrip("/")
        if not base_url:
            self.stderr.write("    RUNPOD_CORE_BASE_URL이 설정되지 않아 회의록을 적재할 수 없습니다.")
            return len(meetings)
        failures = 0
        for meeting in meetings:
            payload = {
                "meeting_id": str(meeting.meeting_id),
                "project_id": str(project_id),
                "title": meeting.title,
                "meeting_datetime": meeting_datetime_text(meeting),
                "content": meeting.meeting_document,
                "todo_list": _todo_list(meeting),
            }
            try:
                response = requests.post(f"{base_url}/meeting-minutes/ingest", json=payload, timeout=600)
                response.raise_for_status()
                data = response.json()
                self.stdout.write(f"    {meeting.meeting_id}: {meeting.title} -> {data.get('upserted_points')}개 청크")
            except (requests.RequestException, ValueError) as exc:
                failures += 1
                self.stderr.write(f"    {meeting.meeting_id}: {meeting.title} 실패: {exc}")
        return failures
