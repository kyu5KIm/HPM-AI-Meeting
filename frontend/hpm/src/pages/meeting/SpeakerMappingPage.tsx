import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import SpeakerMappingCard from "../../components/meeting/SpeakerMappingCard";
import StepBar from "../../components/meeting/StepBar";
import {
  getMeetingDetail,
  getTranscript,
  saveSpeakerMappings,
  generateMinutes,
  type Meeting,
  type TranscriptItem,
} from "../../services/meeting";
import { useAuth } from "../../context/AuthContext";
import useMeetingReviewNavigationGuard from "../../hooks/useMeetingReviewNavigationGuard";
import type { SpeakerParticipant, SpeakerSegment } from "../../types/speakerMapping";

const STEP_LABELS = ["발화자 매핑", "회의록 검토 & 태스크 수정", "Jira 태스크 등록"];

type MeetingParticipant = NonNullable<Meeting["participants"]>[number];

const participantLabel = (participant?: SpeakerParticipant) => {
  if (!participant || participant.id === "") {
    return "선택 안 함";
  }

  return participant.position ? `${participant.name} (${participant.position})` : participant.name;
};

const toSpeakerParticipants = (participants: MeetingParticipant[] = []): SpeakerParticipant[] => [
  { id: "", name: "선택 안 함", position: "" },
  ...participants
    .filter((participant) => participant.meeting_users_id != null)
    .map((participant) => ({
      id: String(participant.meeting_users_id),
      name: participant.name,
      position: participant.work || participant.email || "",
    })),
];

const buildSegments = (transcript: TranscriptItem[]): SpeakerSegment[] => {
  const grouped = new Map<string, SpeakerSegment>();

  transcript.forEach((item) => {
    const speaker = item.speaker || "SPEAKER";
    const mappedParticipantId = item.meeting_users ? String(item.meeting_users) : "";

    if (!grouped.has(speaker)) {
      grouped.set(speaker, {
        id: speaker,
        label: speaker,
        utteranceCount: 0,
        mappedParticipantId,
        hasAppliedAll: false,
        utterances: [],
      });
    }

    const segment = grouped.get(speaker)!;
    if (!segment.mappedParticipantId && mappedParticipantId) {
      segment.mappedParticipantId = mappedParticipantId;
    }

    segment.utterances.push({
      id: String(item.utterance_id),
      time: item.time || "-",
      content: [item.content || ""],
      mappedParticipantId,
      isOverride: false,
    });
  });

  return Array.from(grouped.values()).map((segment) => ({
    ...segment,
    utteranceCount: segment.utterances.length,
  }));
};

export default function SpeakerMappingPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const meetingId = Number(id);

  const [participants, setParticipants] = useState<SpeakerParticipant[]>([{ id: "", name: "선택 안 함", position: "" }]);
  const [segments, setSegments] = useState<SpeakerSegment[]>([]);
  const [activeSpeakerId, setActiveSpeakerId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const userId = user?.users_id;
  const [loadingKey, setLoadingKey] = useState({ meetingId, userId });

  // 회의나 사용자가 바뀌면 렌더 중에 로딩·오류 상태를 다시 맞춘다.
  if (!Object.is(loadingKey.meetingId, meetingId) || loadingKey.userId !== userId) {
    setLoadingKey({ meetingId, userId });
    setLoading(true);
    setError("");
  }

  const { allowReviewNavigation, reviewExitModal } = useMeetingReviewNavigationGuard({
    enabled: !loading && !error,
    meetingId,
  });

  useEffect(() => {
    let cancelled = false;

    const loadSpeakerMapping = async () => {
      try {
        const meeting = await getMeetingDetail(meetingId);
        if (meeting.creator !== user?.users_id) {
          navigate(`/meetings/${meetingId}/archive`, { replace: true });
          return;
        }

        const transcript = await getTranscript(meetingId);
        if (cancelled) return;

        const nextParticipants = toSpeakerParticipants(meeting.participants || []);
        const nextSegments = buildSegments(transcript || []);

        setParticipants(nextParticipants);
        setSegments(nextSegments);
        setActiveSpeakerId(nextSegments[0]?.id || "");
      } catch (err) {
        if (cancelled) return;
        console.error("발화자 매핑 정보 로드 실패:", err);
        setError("발화자 매핑 정보를 불러오지 못했습니다.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadSpeakerMapping();

    return () => {
      cancelled = true;
    };
  }, [meetingId, navigate, user?.users_id]);

  const activeSegment = useMemo(
    () => segments.find((segment) => segment.id === activeSpeakerId) ?? segments[0],
    [activeSpeakerId, segments],
  );

  const updateSegmentMapping = (participantId: string) => {
    if (!activeSegment) return;

    setSegments((current) =>
      current.map((segment) =>
        segment.id === activeSegment.id
          ? {
              ...segment,
              mappedParticipantId: participantId,
              hasAppliedAll: false,
              utterances: segment.utterances.map((utterance) => ({
                ...utterance,
                isOverride: false,
              })),
            }
          : segment,
      ),
    );
  };

  const updateUtteranceMapping = (utteranceId: string, participantId: string) => {
    if (!activeSegment) return;

    setSegments((current) =>
      current.map((segment) =>
        segment.id === activeSegment.id
          ? {
              ...segment,
              utterances: segment.utterances.map((utterance) =>
                utterance.id === utteranceId
                  ? {
                      ...utterance,
                      mappedParticipantId: participantId,
                      isOverride: Boolean(segment.hasAppliedAll && participantId !== segment.mappedParticipantId),
                    }
                  : utterance,
              ),
            }
          : segment,
      ),
    );
  };

  const applyAll = () => {
    if (!activeSegment) return;

    setSegments((current) =>
      current.map((segment) =>
        segment.id === activeSegment.id
          ? {
              ...segment,
              hasAppliedAll: true,
              utterances: segment.utterances.map((utterance) => ({
                ...utterance,
                mappedParticipantId: segment.mappedParticipantId,
                isOverride: false,
              })),
            }
          : segment,
      ),
    );
  };

  const goNext = async () => {
    if (!Number.isFinite(meetingId) || saving || generating) return;

    setSaving(true);
    try {
      const mappings = segments.flatMap((segment) =>
        segment.utterances.map((utterance) => ({
          utterance_id: Number(utterance.id),
          meeting_users_id: utterance.mappedParticipantId ? Number(utterance.mappedParticipantId) : null,
        })),
      );

      if (mappings.length > 0) {
        await saveSpeakerMappings(meetingId, mappings);
      }

      setSaving(false);
      setGenerating(true);
      await generateMinutes(meetingId);

      allowReviewNavigation();
      navigate(`/meetings/${meetingId}/minutes`);
    } catch (err) {
      console.error("발화자 매핑 및 회의록 생성 실패:", err);
      alert("발화자 매핑 저장 또는 회의록 생성에 실패했습니다.");
    } finally {
      setSaving(false);
      setGenerating(false);
    }
  };

  if (loading) {
    return <div className="p-8 text-gray-400">발화자 매핑 정보를 불러오는 중...</div>;
  }

  if (error) {
    return <div className="p-8 text-gray-400">{error}</div>;
  }

  return (
    <>
    <div className="mx-auto w-full max-w-[1280px] p-8">
      <StepBar steps={STEP_LABELS} activeStep={1} />

      <section className="overflow-hidden rounded-[12px] border border-[#ebebed] bg-white">
        <div className="flex items-center justify-between border-b border-[#ededf0] px-6 py-5">
          <div className="flex flex-wrap gap-2">
            {segments.map((segment) => {
              const active = segment.id === activeSegment?.id;

              return (
                <button
                  className={`flex h-[45px] items-center gap-[6px] rounded-[8px] px-[12px] py-[11px] text-left transition-colors ${
                    active
                      ? "bg-[#f2f0ff] text-[#6A1FEB]"
                      : "border border-[#e6e1e6] bg-[#fffdfd] text-[#4c4c54] hover:bg-[#f8f7fc]"
                  }`}
                  key={segment.id}
                  onClick={() => setActiveSpeakerId(segment.id)}
                  type="button"
                >
                  <span className="whitespace-nowrap text-[13px] font-semibold">{segment.label}</span>
                  <span
                    className={`flex h-[22px] min-w-[22px] items-center justify-center rounded-[11px] px-[6px] text-center text-[11px] font-semibold leading-none ${
                      active ? "bg-[#6A1FEB] text-white" : "bg-[#e6e1e6] text-[#141414]"
                    }`}
                  >
                    {segment.utteranceCount}
                  </span>
                </button>
              );
            })}
          </div>

          {activeSegment ? (
            <div className="flex items-center gap-3">
              <span className="text-[14px] text-[#808087]">현재 매핑</span>
              <select
                aria-label="현재 매핑"
                className="h-[42px] w-[190px] rounded-[8px] border border-[#e5e5e8] bg-[#fafafa] px-[14px] text-[14px] font-medium text-[#333338] outline-none focus:border-[#6A1FEB]"
                onChange={(event) => updateSegmentMapping(event.target.value)}
                value={activeSegment.mappedParticipantId}
              >
                {participants.map((participant) => (
                  <option key={participant.id} value={participant.id}>
                    {participantLabel(participant)}
                  </option>
                ))}
              </select>
              <button
                className="flex h-[42px] items-center justify-center rounded-[8px] bg-[#6A1FEB] px-[14px] text-[13px] font-semibold text-white transition-colors hover:bg-[#5635a8] active:scale-[0.98]"
                onClick={applyAll}
                type="button"
              >
                전체 적용
              </button>
            </div>
          ) : null}
        </div>

        <div className="min-h-[520px] px-6 py-5">
          {!activeSegment ? (
            <div className="flex h-[420px] items-center justify-center text-[14px] text-[#969696]">
              발화 내역이 없습니다.
            </div>
          ) : (
            <>
              <p className="mb-5 text-[15px] font-semibold text-[#1a1a1f]">
                {activeSegment.label} 의 발화 내역 ({activeSegment.utterances.length}건)
              </p>
              <div className="flex max-h-[460px] flex-col gap-[22px] overflow-y-auto pr-2">
                {activeSegment.utterances.map((utterance) => (
                  <SpeakerMappingCard
                    key={utterance.id}
                    participants={participants}
                    utterance={utterance}
                    onMappingChange={updateUtteranceMapping}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <div className="mt-5 flex justify-end">
        <button
          className="flex h-[48px] w-[150px] items-center justify-center rounded-[7px] bg-[#6A1FEB] text-[17px] font-medium text-[#fdfdfd] transition-colors hover:bg-[#5635a8] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#969696]"
          disabled={saving || generating}
          onClick={goNext}
          type="button"
        >
          {saving ? "저장 중..." : generating ? "회의록 생성 중..." : "다음"}
        </button>
      </div>
    </div>
    {reviewExitModal}
    </>
  );
}
