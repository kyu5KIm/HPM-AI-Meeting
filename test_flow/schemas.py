from __future__ import annotations

from typing import Annotated, Any

from pydantic import AfterValidator, BaseModel, Field


def _not_blank(value: str) -> str:
    # 빈 값·공백만 있는 값은 LLM까지 보내지 않고 422로 거절한다.
    if not value.strip():
        raise ValueError("must not be blank")
    return value


NonBlankStr = Annotated[str, AfterValidator(_not_blank)]


class MinutesRequest(BaseModel):
    text: str = Field(..., description="STT transcript text.")
    meeting_id: str = ""
    project_id: str = ""
    title: str = ""
    meeting_datetime: str = ""
    location: str = ""
    project_context: str = ""


class MeetingIngestRequest(BaseModel):
    """이미 만들어진 회의록을 Qdrant에 다시 적재할 때 쓴다(재적재·컬렉션 교체용)."""

    meeting_id: str
    project_id: str = ""
    title: str = ""
    meeting_datetime: str = ""
    content: str = Field("", description="회의록 본문")
    summary: str = ""
    todo_list: list[dict[str, Any]] = Field(default_factory=list)


class AgendaRequest(BaseModel):
    title: NonBlankStr
    previous_summary: str = ""
    ocr_text: str = ""


class PreparationRequest(BaseModel):
    title: NonBlankStr = Field(..., description="Meeting topic or title used to generate preparation material.")
    preparation_id: str | int | None = None
    meeting_id: str = ""
    project_id: str = ""
    meeting_datetime: str = ""
    location: str = ""
    project_context: str = ""
    ocr_text: str = ""
    participants: list[dict[str, str]] = Field(default_factory=list)
    agendas: list[str] = Field(default_factory=list)
    max_previous_meetings: int = Field(5, ge=0)


class ChatRequest(BaseModel):
    question: NonBlankStr
    context: str = ""
    history: list[dict[str, str]] = Field(default_factory=list)
    sources: list[str] = Field(default_factory=list)
    project_id: str = ""
    meeting_id: str = ""
    source_scope: str = "project"
    source_types: list[str] = Field(default_factory=list)
    max_previous_meetings: int = Field(5, ge=0)
    min_relevance_score: float | None = None


class TextResponse(BaseModel):
    result: Any
    elapsed_sec: float
    model: str
