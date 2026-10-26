import os
import re
import requests
from datetime import datetime
import boto3

from django.conf import settings
from django.db.models import Q
from django.utils import timezone
from rest_framework import status
from rest_framework.decorators import api_view
from rest_framework.response import Response

from apps.notifications.models import Notification
from apps.users.models import Users
from apps.users.views import get_valid_access_token
from apps.projects.models import Project, ProjectUsers
from apps.meetings.jira_client import create_jira_issue_for_board
from .models import Meeting, MeetingAgendas, MeetingTask, MeetingUsers, Record, RecordUtterance, MeetingPreparation, PreparationDocument,MeetingOcrDocument
from .serializers import (
    MeetingAgendaSerializer,
    MeetingSerializer,
    MeetingTaskSerializer,
    RecordUtteranceSerializer,
    MeetingPreparationSerializer,
    build_meeting_participants,
)


def _request_user_id(request):
    if isinstance(request.auth, dict) and request.auth.get("user_id") is not None:
        user_id = request.auth["user_id"]
    else:
        user_id = getattr(request.user, "users_id", None)

    try:
        return int(user_id)
    except (TypeError, ValueError):
        return user_id


def _can_access_meeting(request, meeting):
    user_id = _request_user_id(request)
    if meeting.creator_id == user_id:
        return True

    return MeetingUsers.objects.filter(meeting=meeting, user_id=user_id).exists()


def _can_control_meeting(request, meeting):
    return meeting.creator_id == _request_user_id(request)


def _get_accessible_meeting(request, meeting_id):
    try:
        meeting = Meeting.objects.select_related("project", "creator").get(meeting_id=meeting_id)
    except Meeting.DoesNotExist:
        return None, Response({"error": "회의를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    if not _can_access_meeting(request, meeting):
        return None, Response({"error": "회의 접근 권한이 없습니다."}, status=status.HTTP_403_FORBIDDEN)

    return meeting, None


def _is_project_member(project, user_id):
    return ProjectUsers.objects.filter(project=project, user_id=user_id).exists()


def _ocr_upload_document_response(document):
    if document is None:
        return {}
    return {
        "document_id": document.document_id,
        "document": {
            "document_id": document.document_id,
            "name": document.title,
            "path": document.path,
        },
    }


def meeting_datetime_text(meeting):
    """회의 일시를 서버 시간대(Asia/Seoul) 기준 'YYYY-MM-DD HH:MM'으로. 회의록과 검색 청크 헤더에 같이 쓴다."""
    if not meeting.meeting_at:
        return ""
    value = timezone.localtime(meeting.meeting_at) if timezone.is_aware(meeting.meeting_at) else meeting.meeting_at
    return value.strftime("%Y-%m-%d %H:%M")


def _minutes_payload(meeting, text):
    return {
        "text": text,
        "meeting_id": str(meeting.meeting_id),
        "project_id": str(meeting.project_id),
        "title": meeting.title or "",
        "meeting_datetime": meeting_datetime_text(meeting),
        "location": meeting.location or "",
    }


def _minutes_result(data):
    if not isinstance(data, dict):
        return {}
    result = data.get("result")
    return result if isinstance(result, dict) else data


def _create_notification(user, notification_type, content, target_id=None):
    Notification.objects.create(
        user=user,
        notification_type=notification_type,
        content=content,
        target_id=target_id,
        is_read=False,
    )

def _send_invite_email(user, meeting) :
    """AWS SES로 회의 초대 이메일 발송"""
    try :
        client=boto3.client("ses", region_name = settings.AWS_REGION)
        client.send_email(
            Source=settings.DEFAULT_FROM_EMAIL,
            Destination={"ToAddresses" : [user.email]},
            Message={
                "Subject" : {
                    "Data" : f"[HPM] {meeting.title}회의에 초대 되었습니다."
                },
                "Body" : {
                    "Text" : {
                        "Data" : f"{user.name}님, \n\n '{meeting.title}' 회의에 초대되었습니다. \n\n 일시 : {meeting.meeting_at} \n\n 장소 : {meeting.location} \n\n https://hpm-meeting.site/meetings/{meeting.meeting_id}/"
                    }
                }
            }
        )

    except Exception as e:
        print(f"이메일 발송 실패 ({user.email}) : {e}")

def _meeting_email_recipients(meeting):
    recipients = []
    seen_user_ids = set()

    if meeting.creator_id and meeting.creator:
        recipients.append(meeting.creator)
        seen_user_ids.add(meeting.creator_id)

    meeting_users = MeetingUsers.objects.filter(meeting=meeting).select_related("user")
    for meeting_user in meeting_users:
        user = meeting_user.user
        if user.users_id in seen_user_ids:
            continue
        recipients.append(user)
        seen_user_ids.add(user.users_id)

    return recipients

def _send_summary_email(user, meeting, tasks):
    task_lines = []
    for idx, task in enumerate(tasks, start=1):
        owner = task.meeting_users.user.name if task.meeting_users_id and task.meeting_users else "미배정"
        due_date = task.due_date.isoformat() if task.due_date else "-"
        priority = task.priority or "-"
        task_lines.append(
            f"{idx}. {task.title} (담당자: {owner}, 기한: {due_date}, 우선순위: {priority})"
        )

    task_text = "\n".join(task_lines) if task_lines else "등록된 태스크가 없습니다."
    meeting_document = meeting.meeting_document or "회의록 내용이 없습니다."

    body = (
        f"{user.name}님,\n\n"
        f"회의록이 확정되었습니다.\n\n"
        f"[회의 정보]\n"
        f"- 회의 제목: {meeting.title}\n"
        f"- 회의 일시: {timezone.localtime(meeting.meeting_at).strftime('%Y-%m-%d %H:%M') if meeting.meeting_at else '-'}\n"
        f"- 회의 장소: {meeting.location or '-'}\n\n"
        f"[회의록]\n"
        f"{meeting_document}\n\n"
        f"[부여된 태스크]\n"
        f"{task_text}\n\n"
        f"프로젝트에서 더 자세한 내용을 확인하실 수 있습니다.\n"
        f"감사합니다."
    )

    client = boto3.client("ses", region_name=settings.AWS_REGION)
    client.send_email(
        Source=settings.DEFAULT_FROM_EMAIL,
        Destination={"ToAddresses": [user.email]},
        Message={
            "Subject": {"Data": f"[HPM] {meeting.title} 회의록 및 태스크 공유"},
            "Body": {"Text": {"Data": body}},
        },
    )

def _notify_task_assigned(task):
    if not task.meeting_users_id or not task.meeting_users:
        return

    _create_notification(
        user=task.meeting_users.user,
        notification_type=Notification.TASK_ASSIGNED,
        content=f"[{task.title}] 업무가 배정되었습니다.",
        target_id=task.meeting_task_id,
    )


def _resolve_meeting_user(meeting, data):
    meeting_users_id = data.get("meeting_users_id")
    if meeting_users_id not in (None, ""):
        try:
            return MeetingUsers.objects.get(
                meeting=meeting,
                meeting_users_id=meeting_users_id,
            )
        except MeetingUsers.DoesNotExist:
            pass

    user_id = data.get("user_id")
    if user_id not in (None, ""):
        try:
            user = Users.objects.get(pk=user_id)
            meeting_user, _ = MeetingUsers.objects.get_or_create(
                meeting=meeting,
                user=user,
            )
            return meeting_user
        except Users.DoesNotExist:
            pass

    return None


def _format_stt_time(value):
    try:
        seconds = int(float(value))
    except (TypeError, ValueError):
        return str(value or "")

    return f"[{seconds // 60:02d}:{seconds % 60:02d}]"


def _parse_formatted_transcript(text):
    parsed = []
    line_pattern = re.compile(
        r"^\[(?P<time>\d{1,2}:\d{2}(?::\d{2})?)\]\s*(?P<speaker>[^:：]+)[:：]\s*(?P<content>.*)$"
    )

    for line in str(text or "").splitlines():
        line = line.strip()
        if not line or line in {"[참석자]", "[발화 원문]"} or line.startswith("- "):
            continue

        match = line_pattern.match(line)
        if not match:
            continue

        content = match.group("content").strip()
        if not content:
            continue

        parsed.append({
            "speaker": match.group("speaker").strip(),
            "time": f"[{match.group('time')}]",
            "content": content,
        })

    return parsed


def _stt_utterance_items(result, full_text):
    if not isinstance(result, dict):
        result = {}

    items = (
        result.get("utterances")
        or result.get("segments")
        or result.get("speaker_segments")
        or result.get("diarization")
        or []
    )
    if isinstance(items, dict):
        items = items.get("items") or items.get("segments") or []

    normalized = []
    if isinstance(items, list):
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue

            content = item.get("content") or item.get("text") or item.get("transcript") or ""
            content = str(content).strip()
            if not content:
                continue

            speaker = (
                item.get("speaker")
                or item.get("speaker_id")
                or item.get("speaker_label")
                or item.get("label")
                or f"SPEAKER_{index:02d}"
            )
            time_value = item.get("time")
            if time_value in (None, ""):
                time_value = item.get("start")
            if time_value in (None, ""):
                time_value = item.get("start_time")
            if time_value is None:
                time_value = ""
            normalized.append({
                "speaker": str(speaker),
                "time": str(time_value) if str(time_value).startswith("[") else _format_stt_time(time_value),
                "content": content,
            })

    if normalized:
        return normalized

    text = str(full_text or "").strip()
    if not text:
        return []

    parsed = _parse_formatted_transcript(text)
    if parsed:
        return parsed

    return [{"speaker": "SPEAKER_00", "time": "[00:00]", "content": text}]


def _replace_record_utterances(record, result, full_text):
    RecordUtterance.objects.filter(record=record).delete()
    utterances = _stt_utterance_items(result, full_text)
    return [
        RecordUtterance.objects.create(
            record=record,
            speaker=item["speaker"],
            time=item["time"],
            content=item["content"],
        )
        for item in utterances
    ]


# ── 회의 목록 / 생성 ─────────────────────────────────────────────
@api_view(["GET", "POST"])
def meeting_list(request):
    if request.method == "GET":
        project_id = request.query_params.get("project_id")
        qs = Meeting.objects.all()
        user_id = _request_user_id(request)
        qs = qs.filter(
            Q(creator_id=user_id) | Q(meetingusers__user_id=user_id)
        ).distinct()
        if project_id:
            qs = qs.filter(project_id=project_id)
        qs = qs.order_by("-meeting_at")
        return Response(MeetingSerializer(qs, many=True).data)

    data = request.data
    user_id = _request_user_id(request)

    try:
        project = Project.objects.get(pk=data.get("project_id", 1))
    except Project.DoesNotExist:
        return Response({"error": "프로젝트를 찾을 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    if not _is_project_member(project, user_id):
        return Response({"error": "프로젝트 구성원만 회의를 생성할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

    title = data.get("title", "")
    if not title or len(title) > 30:
        return Response({"error": "회의 주제는 1~30자여야 합니다."}, status=status.HTTP_400_BAD_REQUEST)


    location = data.get("location", "")
    if not location or len(location) > 50:
        return Response({"error": "장소는 1~50자여야 합니다."}, status=status.HTTP_400_BAD_REQUEST)


    from django.utils import timezone
    meeting_at = data.get("meeting_at")
    if not meeting_at:
        return Response({"error": "회의 일정을 입력해주세요."}, status=status.HTTP_400_BAD_REQUEST)
    from datetime import timezone as dt_timezone
    if datetime.fromisoformat(str(meeting_at)).replace(tzinfo=dt_timezone.utc) <= timezone.now():
        return Response({"error": "현재 시각 이후의 일정만 등록할 수 있습니다."}, status=status.HTTP_400_BAD_REQUEST)


    participants = data.get("participants", [])
    if len(participants) < 1:  
        return Response({"error": "참여자를 최소 1명 이상 추가해야 합니다."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        participant_ids = {int(participant_id) for participant_id in participants}
    except (TypeError, ValueError):
        return Response({"error": "참여자 목록이 올바르지 않습니다."}, status=status.HTTP_400_BAD_REQUEST)
    project_member_ids = set(
        ProjectUsers.objects
        .filter(project=project, user_id__in=participant_ids)
        .values_list("user_id", flat=True)
    )
    invalid_participant_ids = participant_ids - project_member_ids
    if invalid_participant_ids:
        return Response(
            {"error": "프로젝트 구성원만 회의 참여자로 추가할 수 있습니다."},
            status=status.HTTP_400_BAD_REQUEST,
        )

 
    invalid_users = Users.objects.filter(users_id__in=participants, status__in=[1, 2])
    if invalid_users.exists():
        names = ", ".join(u.name for u in invalid_users)
        return Response({"error": f"휴직 또는 퇴사 처리된 사용자는 참여자로 추가할 수 없습니다: {names}"}, status=status.HTTP_400_BAD_REQUEST)

    creator = Users.objects.get(pk=user_id)
    meeting = Meeting.objects.create(
        project=project,
        title=data.get("title", ""),
        location=data.get("location", ""),
        meeting_at=data.get("meeting_at"),
        meeting_status=Meeting.MeetingStatus.SCHEDULED,
        creator = creator,
    )

    participant_ids = [creator.users_id, *data.get("participants", [])]
    seen_participant_ids = set()
    for participant_id in participant_ids:
        if participant_id in seen_participant_ids:
            continue
        seen_participant_ids.add(participant_id)
        try:
            participant = Users.objects.get(pk=participant_id)
            MeetingUsers.objects.get_or_create(meeting=meeting, user=participant)
            if participant.users_id != creator.users_id:
                _create_notification(
                    user=participant,
                    notification_type=Notification.MEETING_INVITED,
                    content=f"[{meeting.title}] 회의에 초대되었습니다.",
                    target_id=meeting.meeting_id,
                )
                _send_invite_email(participant, meeting)
        except Users.DoesNotExist:
            pass

    return Response(MeetingSerializer(meeting).data, status=status.HTTP_201_CREATED)


# ── 회의 상세 / 수정 / 삭제 ─────────────────────────────────────────────
@api_view(["GET", "PATCH", "DELETE"])
def meeting_detail(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    if request.method == "GET":
        data = MeetingSerializer(meeting).data
        data["participants"] = build_meeting_participants(meeting)
        data["agenda"] = MeetingAgendaSerializer(MeetingAgendas.objects.filter(meeting=meeting), many=True).data
        data["tasks"] = MeetingTaskSerializer(MeetingTask.objects.filter(meeting=meeting), many=True).data
        return Response(data)

    if request.method == "PATCH":
        if "meeting_document" not in request.data:
            return Response({"error": "수정할 회의록 내용이 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

        meeting.meeting_document = request.data.get("meeting_document") or ""
        meeting.save(update_fields=["meeting_document"])
        data = MeetingSerializer(meeting).data
        data["participants"] = build_meeting_participants(meeting)
        data["agenda"] = MeetingAgendaSerializer(MeetingAgendas.objects.filter(meeting=meeting), many=True).data
        data["tasks"] = MeetingTaskSerializer(MeetingTask.objects.filter(meeting=meeting), many=True).data
        return Response(data)

    if request.method == "DELETE":
       
        if meeting.creator_id != _request_user_id(request):
            return Response({"error": "회의 생성자만 삭제할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

     
        if meeting.meeting_status != Meeting.MeetingStatus.SCHEDULED:
            return Response({"error": "진행 전인 회의만 삭제할 수 있습니다."}, status=status.HTTP_400_BAD_REQUEST)

      
        if getattr(meeting, "minutes_status", None) == "approved":
            return Response({"error": "회의록이 확정된 회의는 삭제할 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

        meeting.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# ── 기초 안건 ────────────────────────────────────────────────────
@api_view(["GET", "POST"])
def agenda_list(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    if request.method == "GET":
        return Response(MeetingAgendaSerializer(MeetingAgendas.objects.filter(meeting=meeting), many=True).data)

    items = request.data.get("agenda", [])
    MeetingAgendas.objects.filter(meeting=meeting).delete()
    # reason, is_confirmed 제거 (모델에 없음)
    created = [
        MeetingAgendas.objects.create(
            meeting=meeting,
            content=i.get("title", ""),
        )
        for i in items
    ]
    return Response(MeetingAgendaSerializer(created, many=True).data, status=status.HTTP_201_CREATED)


@api_view(["POST"])
def confirm_agenda(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response
    # is_confirmed 제거 (모델에 없음) → 확정 개념 자체를 제거
    return Response({"message": "안건이 확정되었습니다."})


# ── 회의 시작 / 종료 ─────────────────────────────────────────────
@api_view(["POST"])
def start_meeting(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response
    if not _can_control_meeting(request, meeting):
        return Response({"error": "회의 생성자만 회의를 시작할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

    if meeting.meeting_status == Meeting.MeetingStatus.IN_PROGRESS:
        return Response({"error": "이미 진행 중인 회의입니다."}, status=status.HTTP_400_BAD_REQUEST)

    meeting.meeting_status = Meeting.MeetingStatus.IN_PROGRESS
    meeting.meeting_at = timezone.now()
    meeting.during_time = "0"
    meeting.is_paused = False
    meeting.save(update_fields=["meeting_status", "meeting_at", "during_time", "is_paused"])

    # OneToOneField라서 get_or_create 사용
    Record.objects.get_or_create(meeting=meeting)

    # 회의 참여자들에게 시작 알림 생성 (생성자 제외)
    meeting_users = MeetingUsers.objects.filter(meeting=meeting)
    for mu in meeting_users:
        if mu.user_id != _request_user_id(request):
            _create_notification(
                user=mu.user,
                notification_type="meeting_started",
                content=f"'{meeting.title}' 회의가 시작되었습니다.",
                target_id=meeting.meeting_id
            )

    return Response({"message": "회의가 시작되었습니다.", "meeting_id": meeting_id})


@api_view(["POST"])
def pause_meeting(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response
    if not _can_control_meeting(request, meeting):
        return Response({"error": "회의 생성자만 회의를 일시 중지할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

    if not meeting.is_paused:
        meeting.is_paused = True
        if meeting.meeting_at:
            delta = timezone.now() - meeting.meeting_at
            try:
                curr_sec = int(meeting.during_time or "0")
            except ValueError:
                curr_sec = 0
            meeting.during_time = str(curr_sec + int(delta.total_seconds()))
        meeting.save(update_fields=["is_paused", "during_time"])

    return Response({"message": "회의가 일시 중지되었습니다.", "meeting_id": meeting_id, "is_paused": True})


@api_view(["POST"])
def resume_meeting(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response
    if not _can_control_meeting(request, meeting):
        return Response({"error": "회의 생성자만 회의를 재개할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

    if meeting.is_paused:
        meeting.is_paused = False
        meeting.meeting_at = timezone.now()
        meeting.save(update_fields=["is_paused", "meeting_at"])

    return Response({"message": "회의가 재개되었습니다.", "meeting_id": meeting_id, "is_paused": False})


@api_view(["POST"])
def reset_meeting_recording(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response
    if not _can_control_meeting(request, meeting):
        return Response({"error": "회의 생성자만 녹음 상태를 초기화할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)
    if meeting.meeting_status == Meeting.MeetingStatus.FINISHED:
        return Response({"error": "이미 종료된 회의는 녹음 상태를 초기화할 수 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    meeting.meeting_status = Meeting.MeetingStatus.SCHEDULED
    meeting.during_time = "0"
    meeting.is_paused = False
    meeting.save(update_fields=["meeting_status", "during_time", "is_paused"])

    data = MeetingSerializer(meeting).data
    data["participants"] = build_meeting_participants(meeting)
    data["agenda"] = MeetingAgendaSerializer(MeetingAgendas.objects.filter(meeting=meeting), many=True).data
    data["tasks"] = MeetingTaskSerializer(MeetingTask.objects.filter(meeting=meeting), many=True).data
    return Response(data)


@api_view(["POST"])
def end_meeting(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response
    if not _can_control_meeting(request, meeting):
        return Response({"error": "회의 생성자만 회의를 종료할 수 있습니다."}, status=status.HTTP_403_FORBIDDEN)

    audio_file = request.FILES.get("audio")
    if not audio_file:
        return Response(
            {"error": "녹음 파일이 없습니다. 마이크 권한을 허용한 뒤 다시 녹음해주세요.", "meeting_id": meeting_id},
            status=status.HTTP_400_BAD_REQUEST,
        )

    final_during_time = meeting.during_time
    if not meeting.is_paused and meeting.meeting_at:
        delta = timezone.now() - meeting.meeting_at
        try:
            curr_sec = int(meeting.during_time or "0")
        except ValueError:
            curr_sec = 0
        final_during_time = str(curr_sec + int(delta.total_seconds()))

    minutes_data = {"content": "", "todo_list": []}
    if audio_file:
        save_dir = os.path.join(settings.MEDIA_ROOT, "records", str(meeting_id))
        os.makedirs(save_dir, exist_ok=True)
        file_path = os.path.join(save_dir, audio_file.name)
        with open(file_path, "wb+") as f:
            for chunk in audio_file.chunks():
                f.write(chunk)

        stt_base_url = getattr(settings, "RUNPOD_STT_BASE_URL", "") or settings.RUNPOD_BASE_URL
        if not stt_base_url:
            return Response(
                {"error": "STT 서버 주소가 설정되지 않았습니다.", "meeting_id": meeting_id},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        try:
            with open(file_path, "rb") as f:
                stt_res = requests.post(f"{stt_base_url}/transcribe/jobs", files={"file": f}, timeout=600)
            stt_res.encoding = "utf-8"
            stt_res.raise_for_status()
            stt_data = stt_res.json()

            job_id = stt_data.get("job_id")
            if not job_id:
                raise Exception("STT 작업 등록 실패: job_id가 반환되지 않았습니다.")

            # 비동기 STT Job 완료 시까지 폴링
            import time
            while True:
                status_res = requests.get(f"{stt_base_url}/transcribe/jobs/{job_id}", timeout=10)
                status_res.raise_for_status()
                status_res.encoding = "utf-8"
                status_data = status_res.json()
                job_status = str(status_data.get("status", "")).lower()

                if job_status == "succeeded":
                    stt_data = status_data
                    break
                elif job_status in ["failed", "error", "cancelled"]:
                    raise Exception(f"STT 작업이 실패했습니다. 상태: {job_status}")

                time.sleep(2)

            result = stt_data.get("result", {})
            if not isinstance(result, dict):
                result = {}
            full_text = result.get("text", "")

            # OneToOneField라서 .get() 사용 (record_path 제거)
            record, _ = Record.objects.get_or_create(meeting=meeting)
            _replace_record_utterances(record, result, full_text)

            txt_dir = os.path.join(settings.MEDIA_ROOT, "texts", str(meeting_id))
            os.makedirs(txt_dir, exist_ok=True)
            with open(os.path.join(txt_dir, f"meeting-{meeting_id}.txt"), "w", encoding="utf-8") as f:
                f.write(full_text)

        except Exception as e:
            import traceback
            print("❌ end_meeting 에러 발생:")
            traceback.print_exc()
            return Response(
                {"error": f"STT 처리 실패: {str(e)}", "meeting_id": meeting_id},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    meeting.meeting_status = Meeting.MeetingStatus.FINISHED
    meeting.is_meeting_approve = False
    meeting.during_time = final_during_time
    meeting.is_paused = False
    meeting.save(update_fields=["meeting_status", "is_meeting_approve", "during_time", "is_paused"])

    return Response({
        "message": "회의가 종료되었습니다. STT 변환이 완료되었습니다.",
        "meeting_id": meeting_id,
        "minutes_data": {"content": "", "todo_list": []}
    })


def _create_tasks_from_todo(meeting, todo_list):
    """
    LLM이 추출한 todo_list에서 태스크 생성
    owner(담당자 이름)로 SpeakerMapping 조회 → meeting_users FK 저장
    """
    for todo in todo_list:
        due_date_str = todo.get("due_date", "")
        try:
            due_date = datetime.strptime(due_date_str, "%Y-%m-%d").date()
        except (ValueError, TypeError):
            due_date = None

        # owner(SPEAKER_00 등)로 SpeakerMapping 조회 → meeting_users FK 연결
        owner_label = todo.get("owner", "")
        meeting_users = None
        if owner_label:
            mapping = RecordUtterance.objects.filter(
                record__meeting=meeting,
                speaker=owner_label,
                meeting_users__isnull=False,
            ).select_related("meeting_users").first()
            if mapping:
                meeting_users = mapping.meeting_users

        task = MeetingTask.objects.create(
            meeting=meeting,
            meeting_users=meeting_users,   # FK로 저장 (owner 문자열 제거)
            title=todo.get("title", ""),
            content=todo.get("content", ""),
            due_date=due_date,
            priority=todo.get("priority", "Medium"),
            status=0,
        )
        _notify_task_assigned(task)


# ── 발화자 매핑 ──────────────────────────────────────────────────
@api_view(["GET", "POST"])
def speaker_mapping_list(request, meeting_id):
    """발화자 매핑 조회 / 저장"""
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    if request.method == "GET":
        mappings = (
            RecordUtterance.objects
            .filter(record__meeting=meeting)
            .select_related("meeting_users__user")
            .order_by("time", "utterance_id")
        )
        return Response(RecordUtteranceSerializer(mappings, many=True).data)

    # POST - 기존 발화 row의 담당자만 갱신
    # 요청 형식: {"mappings": [{"utterance_id": 1, "meeting_users_id": 3}, ...]}
    items = request.data.get("mappings", [])
    if not isinstance(items, list):
        return Response({"error": "mappings는 배열이어야 합니다."}, status=status.HTTP_400_BAD_REQUEST)

    for item in items:
        if not isinstance(item, dict):
            continue

        utterance_id = item.get("utterance_id")
        if not utterance_id:
            continue

        try:
            utterance = RecordUtterance.objects.get(
                utterance_id=utterance_id,
                record__meeting=meeting,
            )
        except RecordUtterance.DoesNotExist:
            continue

        meeting_users_id = item.get("meeting_users_id")
        if meeting_users_id in (None, ""):
            utterance.meeting_users = None
            utterance.save(update_fields=["meeting_users"])
            continue

        try:
            meeting_user = MeetingUsers.objects.get(
                meeting=meeting,
                meeting_users_id=meeting_users_id,
            )
        except MeetingUsers.DoesNotExist:
            continue

        utterance.meeting_users = meeting_user
        utterance.save(update_fields=["meeting_users"])

    mappings = (
        RecordUtterance.objects
        .filter(record__meeting=meeting)
        .select_related("meeting_users__user")
        .order_by("time", "utterance_id")
    )
    return Response(RecordUtteranceSerializer(mappings, many=True).data)


@api_view(["POST"])
def complete_raw_transcript_only(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    record = None
    try:
        record = Record.objects.get(meeting=meeting)
    except Record.DoesNotExist:
        pass

    raw_text = _get_raw_transcript(record) if record else ""

    if meeting.meeting_status == Meeting.MeetingStatus.IN_PROGRESS and not meeting.is_paused and meeting.meeting_at:
        delta = timezone.now() - meeting.meeting_at
        try:
            curr_sec = int(meeting.during_time or "0")
        except ValueError:
            curr_sec = 0
        meeting.during_time = str(curr_sec + int(delta.total_seconds()))

    RecordUtterance.objects.filter(record__meeting=meeting).update(meeting_users=None)
    MeetingTask.objects.filter(meeting=meeting).delete()

    meeting.meeting_status = Meeting.MeetingStatus.FINISHED
    meeting.meeting_document = raw_text or ""
    meeting.is_meeting_approve = False
    meeting.is_paused = False
    meeting.save(update_fields=["meeting_status", "meeting_document", "is_meeting_approve", "is_paused", "during_time"])

    return Response({
        "message": "회의 원문만 저장하고 검토를 종료했습니다.",
        "meeting_id": meeting_id,
    })


@api_view(["POST"])
def complete_mapped_transcript_only(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    try:
        record = Record.objects.get(meeting=meeting)
    except Record.DoesNotExist:
        return Response({"error": "녹음 원문 데이터가 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    mapped_text = _get_mapped_transcript(record) or _get_raw_transcript(record) or ""

    if meeting.meeting_status == Meeting.MeetingStatus.IN_PROGRESS and not meeting.is_paused and meeting.meeting_at:
        delta = timezone.now() - meeting.meeting_at
        try:
            curr_sec = int(meeting.during_time or "0")
        except ValueError:
            curr_sec = 0
        meeting.during_time = str(curr_sec + int(delta.total_seconds()))

    MeetingTask.objects.filter(meeting=meeting).delete()

    meeting.meeting_status = Meeting.MeetingStatus.FINISHED
    meeting.meeting_document = mapped_text
    meeting.is_meeting_approve = False
    meeting.is_paused = False
    meeting.save(update_fields=["meeting_status", "meeting_document", "is_meeting_approve", "is_paused", "during_time"])

    return Response({
        "message": "회의 발화자 지정 원문만 저장하고 검토를 종료했습니다.",
        "meeting_id": meeting_id,
    })


# ── 회의록 승인 플로우 ───────────────────────────────────────────

@api_view(["POST"])
def complete_minutes_review(request, meeting_id):
    """회의록 검토 완료 처리"""
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    if not meeting.meeting_document:
        return Response({"error": "확정할 회의록이 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    was_approved = meeting.is_meeting_approve
    meeting.is_meeting_approve = True
    meeting.save(update_fields=["is_meeting_approve"])
    if not was_approved:
        _notify_meeting_users(
            meeting,
            Notification.MINUTES_APPROVED,
            f"[{meeting.title}] 회의록이 확정되었습니다.",
        )
    return Response({"message": "검토 완료되었습니다.", "minutes_status": "approved"})

def _notify_meeting_users(meeting, notification_type, content):
    for mu in MeetingUsers.objects.filter(meeting=meeting).select_related("user"):
        _create_notification(
            user=mu.user,
            notification_type=notification_type,
            content=content,
            target_id=meeting.meeting_id,
        )


# ── 태스크 ───────────────────────────────────────────────────────
@api_view(["GET", "POST"])
def task_list(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    if request.method == "GET":
        return Response(MeetingTaskSerializer(MeetingTask.objects.filter(meeting=meeting), many=True).data)

    data = request.data
    meeting_users = _resolve_meeting_user(meeting, data)

    task = MeetingTask.objects.create(
        meeting=meeting,
        meeting_users=meeting_users,
        title=data.get("title", ""),
        content=data.get("content", ""),
        due_date=data.get("due_date"),
        priority=data.get("priority", "Medium"),
        status=0,
    )
    _notify_task_assigned(task)
    return Response(MeetingTaskSerializer(task).data, status=status.HTTP_201_CREATED)


@api_view(["PATCH"])
def task_detail(request, meeting_id, task_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    try:
        task = MeetingTask.objects.get(meeting_task_id=task_id, meeting=meeting)
    except MeetingTask.DoesNotExist:
        return Response({"error": "태스크를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    old_meeting_users_id = task.meeting_users_id

    for field in ["title", "content", "due_date", "priority", "status"]:
        if field in request.data:
            setattr(task, field, request.data[field])

    if "meeting_users_id" in request.data or "user_id" in request.data:
        if request.data.get("meeting_users_id") in ("", None) and request.data.get("user_id") in ("", None):
            task.meeting_users = None
        else:
            task.meeting_users = _resolve_meeting_user(task.meeting, request.data)

    task.save()
    if task.meeting_users_id and task.meeting_users_id != old_meeting_users_id:
        _notify_task_assigned(task)
    return Response(MeetingTaskSerializer(task).data)


# ── Jira 등록 (OAuth 방식) ───────────────────────────────────────
@api_view(["POST"])
def register_jira_tasks(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    if not meeting.project.jira_project_key:
        return Response({"error": "프로젝트에 Jira 프로젝트 키가 설정되지 않았습니다."}, status=status.HTTP_400_BAD_REQUEST)


    user_id = request.data.get("user_id") or _request_user_id(request)
    if not user_id:
        return Response({"error": "user_id가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

    try:
        user = Users.objects.get(users_id=user_id)
    except Users.DoesNotExist:
        return Response({"error": "사용자를 찾을 수 없습니다."}, status=status.HTTP_404_NOT_FOUND)

    access_token = get_valid_access_token(user)
    if not access_token:
        return Response({"error": "Jira 연동이 필요합니다."}, status=status.HTTP_401_UNAUTHORIZED)

    cloud_id = user.jira_cloud_id
    if not cloud_id:
        return Response({"error": "Jira 클라우드 ID가 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    task_ids = request.data.get("task_ids", [])

    registered, failed = [], []

    for task_id in task_ids:
        try:
            task = MeetingTask.objects.get(meeting_task_id=task_id, meeting=meeting)
        except MeetingTask.DoesNotExist:
            failed.append({"task_id": task_id, "reason": "태스크 없음"})
            continue

        assignee_account_id = None
        if task.meeting_users_id and task.meeting_users and task.meeting_users.user:
            assignee_account_id = task.meeting_users.user.jira_account_id

        result = create_jira_issue_for_board(
            task.title,
            access_token,
            cloud_id,
            meeting.project.jira_project_key,
            description=task.content or task.title,
            due_date=str(task.due_date) if task.due_date else None,
            priority=task.priority or "Medium",
            assignee_account_id=assignee_account_id,
        )

        if result.get("success"):
            registered.append(
                {
                    "task_id": task_id,
                    "jira_key": result.get("issue_key", ""),
                    "assignee_applied": result.get("assignee_applied", False),
                    "assignee_skipped_reason": result.get("assignee_skipped_reason", ""),
                }
            )
        else:
            failed.append({"task_id": task_id, "reason": result})

    return Response({"registered": registered, "failed": failed})

@api_view(["POST"])
def send_summary_email(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    recipients = _meeting_email_recipients(meeting)
    recipient_user_ids = request.data.get("recipient_user_ids")
    if recipient_user_ids is not None:
        try:
            selected_user_ids = {int(user_id) for user_id in recipient_user_ids}
        except (TypeError, ValueError):
            return Response({"error": "수신자 목록이 올바르지 않습니다."}, status=status.HTTP_400_BAD_REQUEST)
        recipients = [user for user in recipients if user.users_id in selected_user_ids]

    if not recipients:
        return Response({"error": "이메일을 발송할 참여자가 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    if not settings.DEFAULT_FROM_EMAIL:
        return Response({"error": "발신 이메일 설정이 없습니다."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

    tasks = list(
        MeetingTask.objects
        .filter(meeting=meeting)
        .select_related("meeting_users__user")
        .order_by("meeting_task_id")
    )
    sent, failed = [], []

    for user in recipients:
        if not user.email:
            failed.append({"user_id": user.users_id, "name": user.name, "reason": "이메일 없음"})
            continue

        try:
            _send_summary_email(user, meeting, tasks)
            sent.append({"user_id": user.users_id, "name": user.name, "email": user.email})
        except Exception as exc:
            failed.append({"user_id": user.users_id, "name": user.name, "email": user.email, "reason": str(exc)})

    if failed:
        return Response({"sent": sent, "failed": failed}, status=status.HTTP_502_BAD_GATEWAY)

    return Response({"sent": sent})

# ── 회의록 생성 (RunPod 엔드포인트) ─────────────────────────────
def _get_mapped_transcript(record):
    utterances = RecordUtterance.objects.filter(record=record).select_related("meeting_users__user").order_by("time", "utterance_id")
    if not utterances.exists():
        return None
    lines = []
    for u in utterances:
        speaker_name = u.meeting_users.user.name if (u.meeting_users and u.meeting_users.user) else u.speaker
        lines.append(f"{u.time} {speaker_name}: {u.content}")
    return "\n".join(lines)


def _get_raw_transcript(record):
    utterances = RecordUtterance.objects.filter(record=record).order_by("time", "utterance_id")
    if not utterances.exists():
        return None
    lines = []
    for u in utterances:
        lines.append(f"{u.time} {u.speaker}: {u.content}")
    return "\n".join(lines)


@api_view(["POST"])
def generate_minutes(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    try:
        record = Record.objects.get(meeting=meeting)
    except Record.DoesNotExist:
        return Response({"error": "녹음 데이터가 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    raw_text = _get_raw_transcript(record)
    if not raw_text:
        return Response({"error": "변환된 텍스트가 없습니다."}, status=status.HTTP_400_BAD_REQUEST)

    mapped_text = _get_mapped_transcript(record)
    if not mapped_text:
        mapped_text = raw_text

    base_url = settings.RUNPOD_BASE_URL
    try:
        response = requests.post(
            f"{base_url}/generate-minutes",
            json=_minutes_payload(meeting, mapped_text),
            timeout=300,
        )
        response.raise_for_status()
        print(response.json())
        data = _minutes_result(response.json())
    except requests.RequestException as e:
        return Response({"error": f"RunPod 연결 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    meeting.meeting_document = data.get("content") or data.get("cotent", "")
    meeting.save()
    
    # 기존 자동 생성되었던 태스크들 중복 방지를 위해 삭제 후 재생성
    MeetingTask.objects.filter(meeting=meeting).delete()
    _create_tasks_from_todo(meeting, data.get("todo_list", []))

    return Response({
        "message": "회의록 및 태스크 생성이 완료되었습니다.",
        "meeting_id": meeting_id,
        "content": data.get("cotent") or data.get("content", ""),
        "todo_list": data.get("todo_list", [])
    })

def _store_ocr_source_document(meeting, uploaded_file, file_bytes, user_id, kind):
    """OCR에 넣은 원본 파일을 S3에 저장 + Document 등록 + 회의 OCR 문서로 연결."""
    from apps.documents.views import get_project_user_or_response
    from apps.documents.models import Document
    from django.core.files.base import ContentFile
    from django.core.files.storage import default_storage

    uploader = get_project_user_or_response(meeting.project_id, user_id)
    if isinstance(uploader, Response):
        return None  # 프로젝트 구성원이 아니면 등록만 생략

    # 바이트를 ContentFile로 감싸 default_storage에 저장 → 저장된 경로를 받음
    s3_key = f"documents/{meeting.project_id}/{uploaded_file.name}"
    saved_path = default_storage.save(s3_key, ContentFile(file_bytes))

    # DB에 문서 한 줄 추가 (objects.create = INSERT)
    doc = Document.objects.create(
        project_id=meeting.project_id,
        uploader=uploader,
        title=uploaded_file.name,
        path=saved_path,
    )

    # 같은 회의·같은 용도 기존 기록은 정리하고 새로 연결
    MeetingOcrDocument.objects.filter(meeting=meeting, kind=kind).delete()
    MeetingOcrDocument.objects.create(
        meeting=meeting,
        document_id=doc.document_id,
        kind=kind,
    )
    return doc



# ── OCR + 기초 안건 생성 ─────────────────────────────────────────
@api_view(["POST"])
def generate_agenda(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    ocr_text = ""
    uploaded_file = request.FILES.get("file")

    if uploaded_file:
        ocr_base_url = settings.RUNPOD_OCR_BASE_URL
        if not ocr_base_url:
            return Response({"error": "OCR 서버 주소가 설정되지 않았습니다."}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        try:
            file_bytes = uploaded_file.read()
            document = None
            try:
                document = _store_ocr_source_document(
                    meeting, uploaded_file, file_bytes, request.auth["user_id"], "agenda"
                )
            except Exception as e:
                print("OCR 원본 저장 실패(무시):", e)

            files = {"file": (uploaded_file.name, file_bytes, uploaded_file.content_type)}
            ocr_res = requests.post(f"{ocr_base_url}/ocr/jobs", files=files, timeout=300)
            ocr_res.raise_for_status()
            job_id = ocr_res.json().get("job_id")
            return Response({
                "status": "processing",
                "job_id": job_id,
                **_ocr_upload_document_response(document),
            }, status=status.HTTP_202_ACCEPTED)
        except Exception as e:
            return Response({"error": f"OCR 처리 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    base_url = settings.RUNPOD_BASE_URL
    try:
        payload = {"title": meeting.title, "ocr_text": ocr_text, "context": meeting.project.context or ""}
        print("기초안건 내용 잘 들어감?", payload)
        agenda_res = requests.post(f"{base_url}/generate-agendas", json=payload, timeout=300)
        agenda_res.raise_for_status()
        agenda_res.encoding = "utf-8"
        agenda_data = agenda_res.json()
    except Exception as e:
        return Response({"error": f"안건 생성 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    items = agenda_data.get("result", {}).get("agendas", [])

    MeetingAgendas.objects.filter(meeting=meeting).delete()
    created = [
        MeetingAgendas.objects.create(
            meeting=meeting,
            content=i.get("title", ""),
        )
        for i in items
    ]

    return Response({
        "status": "completed",
        "ocr_text": ocr_text,
        "agenda": MeetingAgendaSerializer(created, many=True).data,
    }, status=status.HTTP_201_CREATED)

@api_view(["GET"])
def check_agenda_status(request, meeting_id):
    job_id = request.query_params.get("job_id")
    if not job_id:
        return Response({"error": "job_id가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    ocr_base_url = settings.RUNPOD_OCR_BASE_URL
    
    try:
        status_res = requests.get(f"{ocr_base_url}/ocr/jobs/{job_id}", timeout=10)
        status_res.raise_for_status()
        status_res.encoding = "utf-8"
        status_data = status_res.json()
        print("🚨 런팟 상태 확인 로그:", status_data)
        job_status = status_data.get("status", "")

        job_status_lower = str(job_status).lower()
        if job_status_lower in ["failed", "error", "cancelled"]:
            return Response({"error": f"OCR 작업이 실패했습니다. 상태: {job_status}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        elif job_status_lower != "succeeded": 
            return Response({"status": "processing"})
            
        ocr_text = status_data.get("result", {}).get("text", "")

    except Exception as e:
        return Response({"error": f"OCR 상태 확인 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    base_url = settings.RUNPOD_BASE_URL
    try:
        payload = {"title": meeting.title, "ocr_text": ocr_text, "context": meeting.project.context or ""}
        agenda_res = requests.post(f"{base_url}/generate-agendas", json=payload, timeout=300)
        agenda_res.raise_for_status()
        agenda_res.encoding = "utf-8"
        agenda_data = agenda_res.json()
    except Exception as e:
        return Response({"error": f"안건 생성 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    items = agenda_data.get("result", {}).get("agendas", [])
    
    MeetingAgendas.objects.filter(meeting=meeting).delete()
    created = [
        MeetingAgendas.objects.create(
            meeting=meeting,
            content=i.get("title", ""),
        )
        for i in items
    ]

    return Response({
        "status": "completed",
        "ocr_text": ocr_text,
        "agenda": MeetingAgendaSerializer(created, many=True).data,
    }, status=status.HTTP_200_OK)

def _parse_prep_markdown(text):
    sections = {
        "purpose": "",
        "project_status": "",
        "rule": "",
        "effect": ""
    }
    
    parts = re.split(r'(####?\s+\d+\.\s+[^\n]+)', text)
    current_section = None
    for part in parts:
        part = part.strip()
        if not part:
            continue
        
        header_match = re.match(r'####?\s+(\d+)\.\s+([^\n]+)', part)
        if header_match:
            num = int(header_match.group(1))
            title = header_match.group(2)
            if num == 2 or "목적" in title:
                current_section = "purpose"
            elif num in [3, 5] or "맥락" in title or "상태" in title or "논의" in title:
                current_section = "project_status"
            elif num in [4, 6] or "근거" in title or "규정" in title or "리스크" in title:
                current_section = "rule"
            elif num == 7 or "준비" in title or "기대" in title or "효과" in title or "결과" in title:
                current_section = "effect"
            else:
                current_section = None
        else:
            if current_section and part:
                if sections[current_section]:
                    sections[current_section] += "\n\n" + part
                else:
                    sections[current_section] = part
                    
    for k in sections:
        sections[k] = sections[k].strip()
    return sections


def _compile_prep_markdown(prep):
    effect = prep.effect or ""
    if "\n\n__RAW_SOURCES__\n" in effect:
        effect = effect.split("\n\n__RAW_SOURCES__\n", 1)[0]
    lines = [
        "### 회의 준비 자료",
        "",
        "#### 1. 회의 목적",
        prep.purpose or "",
        "",
        "#### 2. 프로젝트 현재 상태",
        prep.project_status or "",
        "",
        "#### 3. 관련 규정 및 제약사항",
        prep.rule or "",
        "",
        "#### 4. 회의 종료 후 기대 결과",
        effect
    ]
    return "\n".join(lines)


@api_view(["GET", "POST", "PATCH"])
def prep_material_detail(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    prep = MeetingPreparation.objects.filter(meeting=meeting).first()

    if request.method == "GET":
        if not prep:
            return Response({
                "preration_id": None,
                "meeting": meeting_id,
                "purpose": "",
                "project_status": "",
                "rule": "",
                "effect": ""
            })
        serializer = MeetingPreparationSerializer(prep, context={"request": request})
        return Response(serializer.data)

    data = request.data
    if not prep:
        prep = MeetingPreparation.objects.create(
            meeting=meeting,
            purpose=data.get("purpose", ""),
            project_status=data.get("project_status", ""),
            rule=data.get("rule", ""),
            effect=data.get("effect", "")
        )
    else:
        prep.purpose = data.get("purpose", prep.purpose)
        prep.project_status = data.get("project_status", prep.project_status)
        prep.rule = data.get("rule", prep.rule)
        
        new_effect = data.get("effect", prep.effect)
        if prep.effect and "\n\n__RAW_SOURCES__\n" in prep.effect:
            raw_sources_part = prep.effect.split("\n\n__RAW_SOURCES__\n", 1)[1]
            if "\n\n__RAW_SOURCES__\n" not in new_effect:
                new_effect = f"{new_effect}\n\n__RAW_SOURCES__\n{raw_sources_part}"
        prep.effect = new_effect
        prep.save()

    meeting.meeting_document = _compile_prep_markdown(prep)
    meeting.save(update_fields=["meeting_document"])

    serializer = MeetingPreparationSerializer(prep, context={"request": request})
    return Response(serializer.data)



@api_view(["POST"])
def generate_prep_material(request, meeting_id):
    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    uploaded_file = request.FILES.get("file")

    if uploaded_file:
        ocr_base_url = settings.RUNPOD_OCR_BASE_URL
        if not ocr_base_url:
            return Response({"error": "OCR 서버 주소가 설정되지 않았습니다."}, status=status.HTTP_502_BAD_GATEWAY)
        try:
            file_bytes = uploaded_file.read()
            document = None
            try:
                document = _store_ocr_source_document(
                    meeting, uploaded_file, file_bytes, request.auth["user_id"], "prep"
                )
            except Exception as e:
                print("OCR 원본 저장 실패(무시):", e)

            files = {"file": (uploaded_file.name, file_bytes, uploaded_file.content_type)}
            ocr_res = requests.post(f"{ocr_base_url}/ocr/jobs", files=files, timeout=300)
            ocr_res.raise_for_status()
            job_id = ocr_res.json().get("job_id")
            return Response({
                "status": "processing",
                "job_id": job_id,
                **_ocr_upload_document_response(document),
            }, status=status.HTTP_202_ACCEPTED)
        except Exception as e:
            return Response({"error": f"OCR 처리 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    participants = []
    meeting_users = MeetingUsers.objects.filter(meeting=meeting).select_related("user")
    for mu in meeting_users:
        participants.append({
            "name": mu.user.name,
            "work": mu.user.work or ""
        })

    agendas = [agenda.content for agenda in MeetingAgendas.objects.filter(meeting=meeting)]

    payload = {
        "title": meeting.title,
        "meeting_id": str(meeting.meeting_id),
        "project_id": str(meeting.project_id),
        "meeting_datetime": meeting.meeting_at.isoformat() if meeting.meeting_at else "",
        "location": meeting.location or "",
        "project_context": meeting.project.context or "",
        "participants": participants,
        "agendas": agendas,
        "max_previous_meetings": 5,
        "ocr_text": ""
    }
    print("회의 준비 자료 내용 잘 들어감?", payload)
    base_url = settings.RUNPOD_BASE_URL
    try:
        response = requests.post(f"{base_url}/generate-preparation", json=payload, timeout=300)
        response.raise_for_status()
        response.encoding = "utf-8"
        resp_data = response.json()
    except Exception as e:
        return Response({"error": f"준비자료 생성 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    result_data = resp_data.get("result", {})

    import json
    effect_val = result_data.get("effect") or ""
    raw_sources_str = json.dumps(result_data.get("sources", []), ensure_ascii=False)

    prep, created = MeetingPreparation.objects.get_or_create(meeting=meeting)
    prep.purpose = result_data.get("purpose") or ""
    prep.project_status = result_data.get("project_status") or ""
    prep.rule = result_data.get("rule") or ""
    prep.effect = f"{effect_val}\n\n__RAW_SOURCES__\n{raw_sources_str}"
    prep.save()

    meeting.meeting_document = _compile_prep_markdown(prep)
    meeting.save(update_fields=["meeting_document"])

    from apps.documents.models import Document
    PreparationDocument.objects.filter(preparation=prep).delete()
    for source in result_data.get("sources", []):
        try:
            raw_doc_id = source.get("document_id")
            doc_id = None
            if raw_doc_id not in (None, "", "null", "None"):
                try:
                    doc_id = int(raw_doc_id)
                except (ValueError, TypeError):
                    pass

            if doc_id is None:
                title = source.get("title", "")
                import re
                def normalize_filename(name):
                    name_part = re.split(r'\s+p\.', name, flags=re.IGNORECASE)[0]
                    name_part = re.split(r'\s+page', name_part, flags=re.IGNORECASE)[0]
                    name_part = re.sub(r'\.[a-zA-Z0-9]+$', '', name_part)
                    return re.sub(r'[\s_\-\(\)]+', '', name_part).lower()

                target_norm = normalize_filename(title)
                doc = None
                for d in Document.objects.filter(project=meeting.project):
                    if normalize_filename(d.title) == target_norm:
                        doc = d
                        break

                if not doc:
                    for d in Document.objects.filter(project=meeting.project):
                        d_norm = normalize_filename(d.title)
                        if target_norm and d_norm and (target_norm in d_norm or d_norm in target_norm):
                            doc = d
                            break

                if doc:
                    doc_id = doc.document_id

            if doc_id is not None:
                PreparationDocument.objects.create(
                    preparation=prep,
                    document_id=doc_id
                )
        except Exception as e:
            print("Error saving preparation document:", e)

    serializer = MeetingPreparationSerializer(prep, context={"request": request})
    print(serializer.data)
    return Response({
        "status": "completed",
        "prep": serializer.data
    }, status=status.HTTP_201_CREATED)


@api_view(["GET"])
def check_prep_status(request, meeting_id):
    job_id = request.query_params.get("job_id")
    if not job_id:
        return Response({"error": "job_id가 필요합니다."}, status=status.HTTP_400_BAD_REQUEST)

    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    ocr_base_url = settings.RUNPOD_OCR_BASE_URL
    try:
        status_res = requests.get(f"{ocr_base_url}/ocr/jobs/{job_id}", timeout=10)
        status_res.raise_for_status()
        status_res.encoding = "utf-8"
        status_data = status_res.json()
        job_status = status_data.get("status", "")

        job_status_lower = str(job_status).lower()
        if job_status_lower in ["failed", "error", "cancelled"]:
            return Response({"error": f"OCR 작업이 실패했습니다. 상태: {job_status}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
        elif job_status_lower != "succeeded":
            return Response({"status": "processing"})

        ocr_context = status_data.get("result", {}).get("text", "")
    except Exception as e:
        import traceback
        print("❌ OCR 상태 확인 에러 발생:")
        traceback.print_exc()
        return Response({"error": f"OCR 상태 확인 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    participants = []
    meeting_users = MeetingUsers.objects.filter(meeting=meeting).select_related("user")
    for mu in meeting_users:
        participants.append({
            "name": mu.user.name,
            "work": mu.user.work or ""
        })

    agendas = [agenda.content for agenda in MeetingAgendas.objects.filter(meeting=meeting)]

    payload = {
        "title": meeting.title,
        "meeting_id": str(meeting.meeting_id),
        "project_id": str(meeting.project_id),
        "meeting_datetime": meeting.meeting_at.isoformat() if meeting.meeting_at else "",
        "location": meeting.location or "",
        "project_context": meeting.project.context or "",
        "participants": participants,
        "agendas": agendas,
        "max_previous_meetings": 5,
        "ocr_text": ocr_context
    }

    base_url = settings.RUNPOD_BASE_URL
    try:
        response = requests.post(f"{base_url}/generate-preparation", json=payload, timeout=300)
        response.raise_for_status()
        response.encoding = "utf-8"
        resp_data = response.json()

        print("=== RUNPOD RESPONSE ===")
        print(resp_data)
    except Exception as e:
        import traceback
        print("❌ 준비자료 생성 에러 발생:")
        traceback.print_exc()
        return Response({"error": f"준비자료 생성 실패: {str(e)}"}, status=status.HTTP_502_BAD_GATEWAY)

    result_data = resp_data.get("result", {})

    prep, created = MeetingPreparation.objects.get_or_create(meeting=meeting)
    prep.purpose = result_data.get("purpose") or ""
    prep.project_status = result_data.get("project_status") or ""
    prep.rule = result_data.get("rule") or ""
    import json
    effect_val = result_data.get("effect") or ""
    raw_sources_str = json.dumps(result_data.get("sources", []), ensure_ascii=False)
    prep.effect = f"{effect_val}\n\n__RAW_SOURCES__\n{raw_sources_str}"
    prep.save()

    meeting.meeting_document = _compile_prep_markdown(prep)
    meeting.save(update_fields=["meeting_document"])

    from apps.documents.models import Document
    PreparationDocument.objects.filter(preparation=prep).delete()
    for source in result_data.get("sources", []):
        try:
            raw_doc_id = source.get("document_id")
            doc_id = None
            if raw_doc_id not in (None, "", "null", "None"):
                try:
                    doc_id = int(raw_doc_id)
                except (ValueError, TypeError):
                    pass

            if doc_id is None:
                title = source.get("title", "")
                import re
                def normalize_filename(name):
                    name_part = re.split(r'\s+p\.', name, flags=re.IGNORECASE)[0]
                    name_part = re.split(r'\s+page', name_part, flags=re.IGNORECASE)[0]
                    name_part = re.sub(r'\.[a-zA-Z0-9]+$', '', name_part)
                    return re.sub(r'[\s_\-\(\)]+', '', name_part).lower()

                target_norm = normalize_filename(title)
                doc = None
                for d in Document.objects.filter(project=meeting.project):
                    if normalize_filename(d.title) == target_norm:
                        doc = d
                        break

                if not doc:
                    for d in Document.objects.filter(project=meeting.project):
                        d_norm = normalize_filename(d.title)
                        if target_norm and d_norm and (target_norm in d_norm or d_norm in target_norm):
                            doc = d
                            break

                if doc:
                    doc_id = doc.document_id

            if doc_id is not None:
                PreparationDocument.objects.create(
                    preparation=prep,
                    document_id=doc_id
                )
        except Exception as e:
            print("Error saving preparation document:", e)

    serializer = MeetingPreparationSerializer(prep, context={"request": request})
    print(serializer.data)
    return Response({
        "status": "completed",
        "prep": serializer.data
    }, status=status.HTTP_200_OK)

@api_view(["GET"])
def meeting_ocr_documents(request, meeting_id):
    from apps.documents.models import Document
    from django.core.files.storage import default_storage

    meeting, error_response = _get_accessible_meeting(request, meeting_id)
    if error_response:
        return error_response

    kind = request.query_params.get("kind")  
    links = MeetingOcrDocument.objects.filter(meeting=meeting)
    if kind:
        links = links.filter(kind=kind)

    result = []
    for link in links:
        doc = Document.objects.filter(document_id=link.document_id).first()
        if not doc:
            continue
        file_url = ""
        if doc.path:
            try:
                file_url = default_storage.url(doc.path) 
            except Exception:
                file_url = ""
        result.append({
            "document_id": doc.document_id,
            "title": doc.title,
            "file_url": file_url,
            "kind": link.kind,
        })
    return Response(result)
