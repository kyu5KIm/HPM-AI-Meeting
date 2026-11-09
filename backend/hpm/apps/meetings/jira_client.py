import os
import re
import requests

JIRA_STATUS_TO_COLUMN = {
    "To Do":       "todo",
    "할 일":        "todo",
    "해야 할 일":   "todo",
    "In Progress": "progress",
    "진행 중":      "progress",
    "In Review":   "review",
    "검토":         "review",
    "검토 중":      "review",
    "Done":        "done",
    "완료":         "done",
    "해결됨":       "done",
}

COLUMN_TO_TRANSITION_NAME = {
    "todo":     "To Do",
    "progress": "In Progress",
    "review":   "In Review",
    "done":     "Done",
}

COLUMN_TO_STATUS_NAMES = {
    "todo": ["To Do", "해야 할 일"],
    "progress": ["In Progress", "진행 중"],
    "review": ["In Review", "검토 중"],
    "done": ["Done", "완료", "해결됨"],
}


def _jira_error_detail(error: requests.RequestException):
    if not getattr(error, "response", None):
        return ""
    try:
        return error.response.json()
    except Exception:
        return error.response.text


def _is_assignee_create_error(detail) -> bool:
    text = str(detail).lower()
    return "assignee" in text or "accountid" in text or "assign" in text or "담당" in text


def create_jira_project(project_name: str, access_token: str, cloud_id: str) -> dict:
    """Jira에 새 프로젝트를 생성하고 key와 name을 반환."""
    # project key: 대문자 알파벳으로만, 최대 10자
    raw = re.sub(r"[^A-Za-z0-9]", "", project_name).upper()[:10] or "PROJ"
    project_key = raw if raw else "PROJ"

    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/project"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "key": project_key,
        "name": project_name,
        "projectTypeKey": "software",
        "projectTemplateKey": "com.pyxis.greenhopper.jira:gh-kanban-template",
        "assigneeType": "PROJECT_LEAD",
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        if response.status_code == 400:
            # key 충돌 가능성 — suffix 추가
            import random, string
            suffix = "".join(random.choices(string.ascii_uppercase, k=3))
            payload["key"] = (project_key[:7] + suffix)[:10]
            response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return {"success": True, "key": data.get("key"), "name": data.get("name")}
    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text
        return {"success": False, "error": str(e), "detail": error_detail}


def rank_jira_issue(
    issue_key: str,
    access_token: str,
    cloud_id: str,
    *,
    before_issue_key: str | None = None,
    after_issue_key: str | None = None,
) -> dict:
    """이슈를 기준 이슈의 앞(before) 또는 뒤(after)로 순서 이동(Rank)."""
    if not before_issue_key and not after_issue_key:
        return {"success": False, "error": "기준 이슈(before/after)가 필요합니다."}

    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/agile/1.0/issue/rank"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {"issues": [issue_key]}
    if before_issue_key:
        payload["rankBeforeIssue"] = before_issue_key
    else:
        payload["rankAfterIssue"] = after_issue_key

    try:
        response = requests.put(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        return {"success": True, "issue_key": issue_key}
    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text
        return {
            "success": False,
            "reason": "rank_failed",
            "jira_messages": jira_error_messages(error_detail),
            "error": str(e),
            "detail": error_detail,
        }


def jira_error_messages(error_detail) -> list[str]:
    """Jira 오류 응답({"errorMessages": [...], "errors": {...}})에서 사람이 읽을 메시지만 꺼낸다."""
    if not isinstance(error_detail, dict):
        return []
    messages = [str(m) for m in error_detail.get("errorMessages") or [] if m]
    messages += [f"{field}: {msg}" for field, msg in (error_detail.get("errors") or {}).items() if msg]
    return messages


def get_jira_config():
    return {
        "client_id": os.getenv("JIRA_CLIENT_ID", ""),
        "client_secret": os.getenv("JIRA_CLIENT_SECRET", ""),
        "project_key": os.getenv("JIRA_PROJECT_KEY", ""),
    }


def create_jira_issue(title: str, owner: str, access_token: str, cloud_id: str) -> dict:
    
    config = get_jira_config()

    if not all([access_token, cloud_id, config["project_key"]]):
        return {"success": False, "error": "Jira 연동 정보가 없습니다. Jira 로그인이 필요합니다."}

    summary = f"[{owner}] {title}" if owner and owner != "미정" else title

    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    payload = {
        "fields": {
            "project": {"key": config["project_key"]},
            "summary": summary,
            "issuetype": {"name": "스토리"},
        }
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return {
            "success": True,
            "issue_key": data.get("key"),   # e.g. HRJK-42
            "issue_id": data.get("id"),
            "summary": summary,
        }
    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text
        return {"success": False, "error": str(e), "detail": error_detail}


def create_jira_issues_from_todo(todo_list: list, access_token: str, cloud_id: str) -> list:
   
    results = []
    for todo in todo_list:
        if not isinstance(todo, dict):
            continue
        title = str(todo.get("title") or "").strip()
        owner = str(todo.get("owner") or "미정").strip()
        if not title:
            continue
        result = create_jira_issue(title, owner, access_token, cloud_id)
        result["original_title"] = title
        result["original_owner"] = owner
        results.append(result)
    return results



def get_jira_issues(access_token: str, cloud_id: str, project_key: str) -> dict:

    if not all([access_token, cloud_id, project_key]):
        return {"success": False, "error": "Jira 연동 정보가 없습니다."}

    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/search/jql"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    }

    payload = {
        "jql": f"project = {project_key} ORDER BY created DESC",
        "maxResults": 100,
        "fields": ["summary", "status", "assignee", "priority", "duedate", "created"],
    }

    try:
        response = requests.post(url, json=payload, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()

        columns = {"todo": [], "progress": [], "review": [], "done": []}

        for issue in data.get("issues", []):
            fields = issue.get("fields", {})

            jira_status = fields.get("status", {}).get("name", "")
            column_id = JIRA_STATUS_TO_COLUMN.get(jira_status, "todo")

            assignee = ""
            if fields.get("assignee"):
                assignee = fields["assignee"].get("displayName", "")

            priority = ""
            if fields.get("priority"):
                priority = fields["priority"].get("name", "")

            columns[column_id].append({
                "issue_key": issue.get("key"),
                "title": fields.get("summary", ""),
                "assignee": assignee,
                "priority": priority,
                "due_date": fields.get("duedate", ""),
            })
        return {"success": True, "columns": columns}

    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text
        return {"success": False, "error": str(e), "detail": error_detail}   


def update_jira_issue_status(
    issue_key: str,
    column_id: str,
    access_token: str,
    cloud_id: str,
    target_status_names: list[str] | None = None,
) -> dict:

    # 실패 시 reason으로 원인을 구분한다:
    # unknown_column / transitions_fetch_failed / transition_not_found / transition_failed
    transition_name = COLUMN_TO_TRANSITION_NAME.get(column_id)
    if not transition_name and target_status_names:
        transition_name = target_status_names[0]
    if not transition_name:
        return {"success" : False, "reason" : "unknown_column", "error" : f"알 수 없는 column_id: {column_id}"}

    headers = {
        "Authorization" : f"Bearer {access_token}",
        "Content-Type" : "application/json",
        "Accept" : "application/json",
    }

    transitions_url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue/{issue_key}/transitions"

    try:
        trans_response = requests.get(transitions_url, headers=headers, timeout =10)
        trans_response.raise_for_status()
        transitions =  trans_response.json().get("transitions" ,[])

    except requests.RequestException as e:
        response = getattr(e, "response", None)
        return {
            "success" : False,
            "reason" : "transitions_fetch_failed",
            "jira_status" : response.status_code if response is not None else None,
            "error" : f"transition 조회 실패: {str(e)}",
        }

    status_names = target_status_names or COLUMN_TO_STATUS_NAMES.get(column_id, [transition_name])
    desired_names = {name.lower() for name in status_names if name}
    transition_id = None
    for t in transitions:
        transition_label = (t.get("name") or "").lower()
        target_label = ((t.get("to") or {}).get("name") or "").lower()
        if transition_label in desired_names or target_label in desired_names:
            transition_id = t.get("id")
            break

    if not transition_id:
        # 워크플로우상 현재 상태에서 갈 수 없는 상태다. 사용자 안내용으로 현재 상태와 갈 수 있는 상태를 함께 돌려준다.
        current_status = ""
        try:
            issue_response = requests.get(
                f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue/{issue_key}?fields=status",
                headers=headers,
                timeout=10,
            )
            if issue_response.ok:
                current_status = ((issue_response.json().get("fields") or {}).get("status") or {}).get("name", "")
        except requests.RequestException:
            pass

        return {
            "success" : False,
            "reason" : "transition_not_found",
            "target_status" : transition_name,
            "current_status" : current_status,
            "available_statuses" : [
                (t.get("to") or {}).get("name") or t.get("name") for t in transitions
            ],
            "error" : f"'{transition_name}' transition을 찾을 수 없습니다. Jira 워크플로우를 확인하세요."
        }

    try:
        exec_response = requests.post(
            transitions_url,
            json = {"transition" : {"id" : transition_id}},
            headers = headers,
            timeout=10,
        )
        exec_response.raise_for_status()
        return {"success" : True, "issue_key" : issue_key, "new_column" : column_id}

    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text

        return {
            "success" : False,
            "reason" : "transition_failed",
            "target_status" : transition_name,
            "jira_messages" : jira_error_messages(error_detail),
            "error" : str(e),
            "detail" : error_detail,
        }
    

def delete_jira_issue(issue_key: str, access_token: str, cloud_id: str) -> dict:


    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue/{issue_key}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Accept": "application/json",
    }

    try:
        response = requests.delete(url, headers= headers, timeout=10)
        response.raise_for_status()

        return {"success" : True, "issue_key" : issue_key}
    
    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try :
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text
        return {"success" : False, "error" : str(e), "detail" : error_detail}


def create_jira_issue_for_board(
    title: str,
    access_token: str,
    cloud_id: str,
    project_key: str,
    description: str = "",
    due_date: str | None = None,
    priority: str | None = None,
    assignee_account_id: str | None = None,
    parent_key: str | None = None,
) -> dict:
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    # 1. 이슈 타입 동적 조회
    project_url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/project/{project_key}"
    try:
        project_response = requests.get(project_url, headers=headers, timeout=10)
        project_response.raise_for_status()
        issue_types = project_response.json().get("issueTypes", [])

        PREFERRED = ["task", "작업", "story", "스토리"]
        EXCLUDE = {"epic", "subtask", "에픽"}

        valid_type = None
        for preferred_name in PREFERRED:
            valid_type = next(
                (t for t in issue_types if t["name"].lower() == preferred_name),
                None
            )
            if valid_type:
                break

        if not valid_type:
            valid_type = next(
                (t for t in issue_types if t["name"].lower() not in EXCLUDE),
                None
            )

        if not valid_type:
            return {"success": False, "error": "사용 가능한 이슈 타입이 없습니다."}

        issue_type_id = valid_type["id"]

    except requests.RequestException as e:
        return {"success": False, "error": f"이슈 타입 조회 실패: {str(e)}"}

    # 2. 이슈 생성
    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue"
    fields = {
        "project": {"key": project_key},
        "summary": title,
        "issuetype": {"id": issue_type_id},
    }

    if description:
        fields["description"] = {
            "version": 1,
            "type": "doc",
            "content": [
                {
                    "type": "paragraph",
                    "content": [{"type": "text", "text": description}],
                }
            ],
        }
    if due_date:
        fields["duedate"] = due_date
    if priority:
        fields["priority"] = {"name": priority}
    if assignee_account_id:
        fields["assignee"] = {"accountId": assignee_account_id}
    if parent_key:
        fields["parent"] = {"key": parent_key}

    def post_issue(issue_fields: dict) -> dict:
        response = requests.post(url, json={"fields": issue_fields}, headers=headers, timeout=10)
        response.raise_for_status()
        data = response.json()
        return {"success": True, "issue_key": data.get("key")}

    try:
        result = post_issue(fields)
        result["assignee_applied"] = bool(assignee_account_id)
        return result

    except requests.RequestException as e:
        error_detail = _jira_error_detail(e)
        if assignee_account_id and _is_assignee_create_error(error_detail):
            retry_fields = {key: value for key, value in fields.items() if key != "assignee"}
            try:
                result = post_issue(retry_fields)
                result.update({
                    "assignee_applied": False,
                    "assignee_skipped_reason": "담당자가 Jira 프로젝트에 배정 가능하지 않아 미배정으로 등록했습니다.",
                    "assignee_error": error_detail,
                })
                return result
            except requests.RequestException as retry_error:
                retry_detail = _jira_error_detail(retry_error)
                return {"success": False, "error": str(retry_error), "detail": retry_detail}

        return {"success": False, "error": str(e), "detail": error_detail}
    

_UNSET = object()


def _jira_adf_text(text: str) -> dict:
    return {
        "version": 1,
        "type": "doc",
        "content": [
            {
                "type": "paragraph",
                "content": [{"type": "text", "text": text}],
            }
        ],
    }


def update_jira_issue(
    issue_key: str,
    title: str,
    description: str,
    access_token: str,
    cloud_id: str,
    *,
    description_provided: bool = False,
    due_date=_UNSET,
    priority=_UNSET,
    assignee_account_id=_UNSET,
    parent_key=_UNSET,
) -> dict:

    url = f"https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue/{issue_key}"
    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }

    fields = {}
    title = (title or "").strip()
    if title:
        fields["summary"] = title
    if description_provided:
        fields["description"] = _jira_adf_text(description) if description else None
    elif description:
        # Jira는 description을 ADF(Atlassian Document Format) 형식으로 받음.
        fields["description"] = _jira_adf_text(description)
    if due_date is not _UNSET:
        fields["duedate"] = due_date or None
    if priority is not _UNSET:
        fields["priority"] = {"name": priority} if priority else None
    if assignee_account_id is not _UNSET:
        fields["assignee"] = {"accountId": assignee_account_id} if assignee_account_id else None
    if parent_key is not _UNSET:
        fields["parent"] = {"key": parent_key} if parent_key else None

    if not fields:
        return {"success": True, "issue_key": issue_key}

    try:
        response = requests.put(url, json={"fields": fields}, headers=headers, timeout=10)
        response.raise_for_status()
        return {"success": True, "issue_key": issue_key}

    except requests.RequestException as e:
        error_detail = ""
        if hasattr(e, "response") and e.response is not None:
            try:
                error_detail = e.response.json()
            except Exception:
                error_detail = e.response.text
        return {"success": False, "error": str(e), "detail": error_detail}
