import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useRecording } from "../../context/RecordingContext";
import { useAuth } from "../../context/AuthContext";
import mikeImg from "../../assets/meeting/mike.png";
import recordingImg from "../../assets/meeting/recording.png";
import stopImg from "../../assets/meeting/stop.png";
import sendImg from "../../assets/meeting/send.png";
import {
  getMeetingDetail,
  startMeeting,
  resetMeetingRecording,
  pauseMeeting,
  resumeMeeting,
  endMeeting,
  sendChatMessage,
  saveAgendaList,
  getPrepMaterial,
  savePrepMaterial,
  type Meeting,
  type MeetingPreparation,
} from "../../services/meeting";
import * as DESIGN from "../../constants/design";
import { dedupePreparationSources } from "../../utils/dedupeSources";

type ChatMsg = { role: "user" | "bot"; content: string; source?: string };
const MISSING_AUDIO_MESSAGE = "녹음 파일이 없습니다. 마이크 권한을 허용한 뒤 다시 녹음해주세요.";

export default function MeetingDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const meetingId = Number(id);

  const { showAgenda = true, showPrepMaterial = true, status: navStatus } =
    (location.state as { showAgenda?: boolean; showPrepMaterial?: boolean; status?: string }) ?? {};

  const { meetingId: ctxMeetingId, startTime: ctxStartTime, isPaused: ctxIsPaused, startRecording, finishRecording, stopRecording, pauseRecording, resumeRecording } = useRecording();

  const isReturningToRecording = ctxMeetingId === meetingId && ctxStartTime !== null;
  const initialStatus = isReturningToRecording || navStatus === "in_progress" ? "in_progress" : "scheduled";

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const { user } = useAuth();
  const currentUserId = user?.users_id;
  const isCreator = Boolean(meeting && currentUserId && meeting.creator === currentUserId);
  const [elapsed, setElapsed] = useState(() =>
    isReturningToRecording && ctxStartTime !== null
      ? Math.floor((Date.now() - ctxStartTime) / 1000)
      : 0,
  );
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatLoading, setChatLoading] = useState(false);
  const [endLoading, setEndLoading] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [showTenMinWarningModal, setShowTenMinWarningModal] = useState(false);
  const [showMaxTimeModal, setShowMaxTimeModal] = useState(false);
  const [agendaOpen, setAgendaOpen] = useState(true);
  const [materialsOpen, setMaterialsOpen] = useState(true);
  const [loading, setLoading] = useState(true);

  const [isEditingAgenda, setIsEditingAgenda] = useState(false);
  const [editedAgendas, setEditedAgendas] = useState<string[]>([]);

  const [prepMaterial, setPrepMaterial] = useState<MeetingPreparation | null>(null);
  const uniquePrepSources = useMemo(
    () => dedupePreparationSources(prepMaterial?.sources),
    [prepMaterial?.sources],
  );
  const [isEditingPrep, setIsEditingPrep] = useState(false);
  const [editedPrep, setEditedPrep] = useState({
    purpose: "",
    project_status: "",
    rule: "",
    effect: ""
  });

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<HTMLDivElement>(null);
  const tenMinWarnedRef = useRef(false);
  const maxTimeTriggeredRef = useRef(false);

  useEffect(() => {
    if (initialStatus === "in_progress" && ctxMeetingId !== meetingId) {
      startRecording(meetingId);
    }
  }, []);

  useEffect(() => {
    setLoading(true);

    getMeetingDetail(meetingId)
      .then((data) => {
        if (!data || !data.title) {
          setMeeting(null);
          return;
        }

        if (data.status !== "scheduled" && data.status !== "in_progress") {
          stopRecording();
          navigate(
            data.status === "finished" && data.creator === currentUserId
              ? `/meetings/${meetingId}/speaker-mapping`
              : `/meetings/${meetingId}/archive`,
            { replace: true },
          );
          return;
        }

        setMeeting({
          ...data,
          status: data.status,
        });

        if (data.elapsed_seconds !== undefined) {
          setElapsed(data.elapsed_seconds);
        }

        if (data.meeting_document) {
          getPrepMaterial(meetingId)
            .then((prep) => setPrepMaterial(prep))
            .catch((err) => console.error("준비자료 로드 실패:", err));
        }
      })
      .catch((error) => {
        console.error("회의 상세 조회 실패:", error);
        setMeeting(null);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [meetingId, navigate, stopRecording, currentUserId]);

  useEffect(() => {
    if (meeting?.status === "in_progress" && !isPaused) {
      timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [meeting?.status, isPaused]);

  useEffect(() => {
    if (meeting?.status !== "in_progress" || isPaused) return;

    if (elapsed >= 6600 && !tenMinWarnedRef.current) {
      tenMinWarnedRef.current = true;
      setShowTenMinWarningModal(true);
    }

    if (elapsed >= 7200 && !maxTimeTriggeredRef.current) {
      maxTimeTriggeredRef.current = true;
      setShowMaxTimeModal(true);
    }
  }, [elapsed, meeting?.status, isPaused]);

  useEffect(() => {
    if (!meeting || meeting.status === "finished") return;

    const interval = setInterval(async () => {
      try {
        const data = await getMeetingDetail(meetingId);
        if (data) {
          const statusChanged = data.status !== meeting.status;
          const pauseChanged = data.is_paused !== meeting.is_paused;

          if (statusChanged || pauseChanged) {
            setMeeting(data);
            if (data.status === "finished") {
              stopRecording();
              navigate(
                data.creator === currentUserId
                  ? `/meetings/${meetingId}/speaker-mapping`
                  : `/meetings/${meetingId}/archive`,
                { replace: true },
              );
            }
          }

          if (data.status === "in_progress") {
            // 참석자: 녹음 컨텍스트 동기화
            if (ctxMeetingId !== meetingId) {
              startRecording(meetingId, data.elapsed_seconds ?? 0);
            } else if (data.is_paused && !ctxIsPaused) {
              pauseRecording(data.elapsed_seconds ?? 0);
            } else if (!data.is_paused && ctxIsPaused) {
              resumeRecording();
            }

            if (data.is_paused) {
              setElapsed(data.elapsed_seconds ?? 0);
            } else if (data.elapsed_seconds !== undefined) {
              setElapsed((prev) => {
                if (Math.abs(data.elapsed_seconds! - prev) > 3) {
                  return data.elapsed_seconds!;
                }
                return prev;
              });
            }
          }
        }
      } catch (err) {
        console.error("폴링 중 오류:", err);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [meeting?.status, meeting?.is_paused, meetingId, ctxMeetingId, ctxIsPaused, startRecording, stopRecording, pauseRecording, resumeRecording, navigate, currentUserId]);

  useEffect(() => {
    if (meeting) {
      setIsPaused(meeting.is_paused || false);
    }
  }, [meeting?.is_paused]);

  useEffect(() => {
    const refetch = async () => {
      try {
        const data = await getMeetingDetail(meetingId);
        if (data && data.title) {
          setMeeting(data);
          if (data.elapsed_seconds !== undefined) {
            setElapsed(data.elapsed_seconds);
          }
          if (data.status !== "scheduled" && data.status !== "in_progress") {
            stopRecording();
            navigate(
              data.status === "finished" && data.creator === currentUserId
                ? `/meetings/${meetingId}/speaker-mapping`
                : `/meetings/${meetingId}/archive`,
              { replace: true },
            );
          }
        }
      } catch (err) {
        console.error("Refetch failed:", err);
      }
    };

    const handlePageShow = () => {
      refetch();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        refetch();
      }
    };

    window.addEventListener("pageshow", handlePageShow);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [meetingId, navigate, stopRecording, currentUserId]);

  useEffect(() => {
    chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, chatLoading]);

  if (loading) {
    return <div className="p-8 text-gray-400">회의 정보를 불러오는 중...</div>;
  }

  if (!meeting) {
    return <div className="p-8 text-gray-400">회의를 찾을 수 없습니다.</div>;
  }

  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const clearLocalRecordingState = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    tenMinWarnedRef.current = false;
    maxTimeTriggeredRef.current = false;
    setIsPaused(false);
    setElapsed(0);
    stopRecording();
  };

  const handleStart = async () => {
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);

      await startMeeting(meetingId);
      startRecording(meetingId, 0, recorder);
      recorder.start();

      setMeeting((m) => (m ? { ...m, status: "in_progress" } : m));
      setElapsed(0);
    } catch (err) {
      console.error("회의 시작 중 에러 발생:", err);
      stream?.getTracks().forEach((track) => track.stop());
      alert("마이크 권한이 필요합니다. 브라우저에서 마이크 권한을 허용한 뒤 다시 시작해주세요.");
    }
  };

  const handlePause = async () => {
    if (timerRef.current) clearInterval(timerRef.current);
    setIsPaused(true);
    pauseRecording(elapsed);

    try {
      await pauseMeeting(meetingId);
    } catch (err) {
      console.error("회의 일시중지 백엔드 반영 실패:", err);
    }
  };

  const handleResume = async () => {
    timerRef.current = setInterval(() => setElapsed((e) => e + 1), 1000);
    setIsPaused(false);
    resumeRecording();

    try {
      await resumeMeeting(meetingId);
    } catch (err) {
      console.error("회의 재개 백엔드 반영 실패:", err);
    }
  };

  const doEndMeeting = async () => {
    if (timerRef.current) clearInterval(timerRef.current);

    setEndLoading(true);

    try {
      const audioFile = await finishRecording(`meeting-${meetingId}.webm`);

      if (!audioFile || audioFile.size === 0) {
        throw new Error(MISSING_AUDIO_MESSAGE);
      }

      await endMeeting(meetingId, audioFile);
      stopRecording();
      navigate(`/meetings/${meetingId}/speaker-mapping`);
    } catch (err) {
      console.error("회의 종료 에러:", err);
      const message =
        (err as { response?: { data?: { error?: string } }; message?: string }).response?.data?.error ||
        (err as Error).message ||
        "회의 종료 또는 STT 처리에 실패했습니다.";
      alert(message);
      if (message === MISSING_AUDIO_MESSAGE) {
        try {
          const resetMeeting = await resetMeetingRecording(meetingId);
          clearLocalRecordingState();
          setMeeting(resetMeeting);
        } catch (resetError) {
          console.error("녹음 상태 초기화 실패:", resetError);
          alert("녹음 상태 초기화에 실패했습니다. 회의 목록으로 이동한 뒤 다시 시도해주세요.");
        }
      }
    } finally {
      setEndLoading(false);
    }
  };

  const handleEnd = async () => {
    await doEndMeeting();
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const query = chatInput.trim();
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", content: query }]);
    setChatLoading(true);

    try {
      const res = await sendChatMessage(meetingId, query);
      const sourcesStr = res.sources && res.sources.length > 0 ? res.sources.join(", ") : undefined;

      setChatMessages((prev) => [...prev, { role: "bot", content: res.answer, source: sourcesStr }]);
    } catch {
      setChatMessages((prev) => [...prev, { role: "bot", content: "답변을 가져오는데 실패했습니다." }]);
    } finally {
      setChatLoading(false);
    }
  };

  const startEditingAgenda = () => {
    setEditedAgendas(meeting?.agenda?.map(item => item.content) || []);
    setIsEditingAgenda(true);
  };

  const handleAgendaChange = (idx: number, value: string) => {
    setEditedAgendas(prev => {
      const copy = [...prev];
      copy[idx] = value;
      return copy;
    });
  };

  const addAgendaItem = () => {
    setEditedAgendas(prev => [...prev, ""]);
  };

  const removeAgendaItem = (idx: number) => {
    setEditedAgendas(prev => prev.filter((_, i) => i !== idx));
  };

  const saveEditedAgendas = async () => {
    try {
      const payload = editedAgendas
        .filter(content => content.trim() !== "")
        .map(content => ({ title: content, reason: "" }));
      await saveAgendaList(meetingId, payload);
      
      setMeeting(prev => {
        if (!prev) return null;
        return {
          ...prev,
          agenda: editedAgendas
            .filter(content => content.trim() !== "")
            .map((content, idx) => ({
              agenda_id: prev.agenda?.[idx]?.agenda_id || idx,
              meeting: meetingId,
              content,
              reason: "",
            })),
        };
      });
      setIsEditingAgenda(false);
    } catch (e) {
      alert("안건 수정 저장에 실패했습니다.");
    }
  };

  const startEditingPrep = () => {
    if (prepMaterial) {
      setEditedPrep({
        purpose: prepMaterial.purpose || "",
        project_status: prepMaterial.project_status || "",
        rule: prepMaterial.rule || "",
        effect: prepMaterial.effect || ""
      });
    }
    setIsEditingPrep(true);
  };

  const saveEditedPrep = async () => {
    try {
      const updated = await savePrepMaterial(meetingId, {
        purpose: editedPrep.purpose,
        project_status: editedPrep.project_status,
        rule: editedPrep.rule,
        effect: editedPrep.effect
      });
      setPrepMaterial(updated);
      setIsEditingPrep(false);
      
      setMeeting(prev => {
        if (!prev) return null;
        return {
          ...prev,
          meeting_document: "compiled"
        };
      });
    } catch (e) {
      alert("준비자료 수정 저장에 실패했습니다.");
    }
  };

  const isScheduled = meeting.status === "scheduled";
  const isInProgress = meeting.status === "in_progress";
  const isChatEnabled = true;
  const hasAgenda = Boolean(meeting.agenda && meeting.agenda.length > 0);
  const hasPrepMaterial = Boolean(meeting.meeting_document);

  return (
    <>
      {/* 10분 후 종료 예정 경고 모달 */}
      {showTenMinWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl w-80 overflow-hidden shadow-xl">
            <div className="px-8 py-10 text-center">
              <p className="text-[#6A1FEB] text-[14px] leading-relaxed whitespace-pre-line">
                {"회의 녹음 최대 시간은 2시간입니다.\n10분 후 회의가 종료될 예정입니다."}
              </p>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => setShowTenMinWarningModal(false)}
                className="w-full py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 최대 시간 도달 자동 종료 모달 */}
      {showMaxTimeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl w-80 overflow-hidden shadow-xl">
            <div className="px-8 py-10 text-center">
              <p className="text-[#6A1FEB] text-[14px] leading-relaxed whitespace-pre-line">
                {"회의가 최대 시간에 도달하였습니다.\n회의를 종료합니다."}
              </p>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => { setShowMaxTimeModal(false); doEndMeeting(); }}
                className="w-full py-4 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

    <div className="flex w-full h-[calc(100vh-112px)] overflow-hidden">
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div
          className={`flex flex-col md:flex-row items-center justify-between p-6 ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.RADIUS_SIZES.xl} ${DESIGN.BACKGROUND_COLORS.white} shadow-sm gap-6`}
        >
          <div className="flex-1">
            <h1 className={`${DESIGN.FONT_SIZES.h3} ${DESIGN.COLORS.black} font-medium mb-2`}>
              {meeting.title}
            </h1>

            <div className={`flex flex-wrap items-center gap-4 ${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray} mb-3`}>
              <span>
                {meeting.meeting_at?.slice(0, 10)} · {meeting.meeting_at?.slice(11, 16) || "00:00"}
              </span>
              <span>{meeting.location || "장소 미정"}</span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className={`${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray} mr-1`}>
                참석자 {meeting.participants?.length ?? 0}명 :
              </span>

              {meeting.participants?.map((p, idx) => (
                <span key={p.user_id} className={`${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.black} font-semibold`}>
                  {p.name}
                  {idx < (meeting.participants?.length || 0) - 1 ? "," : ""}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="text-[32px] font-medium tabular-nums text-gray-900 leading-none">
              {isInProgress ? fmt(elapsed) : "00:00:00"}
            </div>

            {isCreator && (
              <>
                <button
                  onClick={isScheduled ? handleStart : isPaused ? handleResume : handlePause}
                  disabled={endLoading}
                  className="active:scale-95 transition w-[60px] h-[60px] flex items-center justify-center"
                >
                  {isScheduled && <img src={mikeImg} alt="녹음 시작" className="w-full h-full object-contain" />}
                  {isInProgress && !isPaused && (
                    <img src={recordingImg} alt="녹음 중지" className="w-[38px] h-[38px] object-contain" />
                  )}
                  {isInProgress && isPaused && (
                    <img src={stopImg} alt="녹음 재개" className="w-[38px] h-[38px] object-contain" />
                  )}
                </button>
                {isInProgress ? (
                  <button
                    type="button"
                    onClick={handleEnd}
                    disabled={endLoading}
                    className="rounded-[8px] bg-[#6A1FEB] px-4 py-2 text-sm font-semibold text-white disabled:bg-[#969696]"
                  >
                    회의 종료
                  </button>
                ) : null}
              </>
            )}
          </div>
        </div>

        {showAgenda && (
          <>
            {hasAgenda ? (
              <div className={`${DESIGN.BACKGROUND_COLORS.grayLight} ${DESIGN.RADIUS_SIZES.xl} overflow-hidden shadow-sm`}>
                <button
                  onClick={() => setAgendaOpen(!agendaOpen)}
                  className="w-full flex items-center justify-between p-5 text-left outline-none"
                >
                  <span className={`${DESIGN.FONT_SIZES.lg} ${DESIGN.COLORS.black} font-semibold`}>기초 안건</span>
                  <span className={`transform transition-transform duration-200 ${agendaOpen ? "rotate-180" : ""}`}>
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>

                {agendaOpen && (
                  <div className="px-5 pb-5 pt-1 space-y-3">
                    {isEditingAgenda ? (
                      <>
                        {editedAgendas.map((content, idx) => (
                          <div
                            key={idx}
                            className={`${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.RADIUS_SIZES.md} p-4 border border-[#E6E1E6] flex gap-3 items-center`}
                          >
                            <span className="text-[#6A1FEB] font-medium text-[15px] flex-shrink-0">{idx + 1}.</span>
                            <input
                              type="text"
                              value={content}
                              onChange={(e) => handleAgendaChange(idx, e.target.value)}
                              className="flex-1 border border-[#E6E1E6] rounded-lg px-3 py-2 text-sm text-[#141414] outline-none focus:border-[#6A1FEB] transition"
                              placeholder="안건 내용을 입력하세요"
                            />
                            <button
                              type="button"
                              onClick={() => removeAgendaItem(idx)}
                              className="text-gray-400 hover:text-red-500 font-medium text-lg px-2"
                            >
                              ×
                            </button>
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={addAgendaItem}
                          className="w-full py-2.5 border-2 border-dashed border-gray-300 rounded-xl text-gray-500 text-sm hover:border-[#6A1FEB] hover:text-[#6A1FEB] transition"
                        >
                          + 안건 추가
                        </button>
                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={saveEditedAgendas}
                            className="px-4 py-2 text-[13px] rounded-lg border transition font-semibold"
                            style={{ backgroundColor: "#6A1FEB", color: "#ffffff", borderColor: "#6A1FEB" }}
                          >
                            완료
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {meeting.agenda?.map((item, idx) => (
                          <div
                            key={idx}
                            className={`${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.RADIUS_SIZES.md} p-4 border border-[#E6E1E6] flex gap-3 items-start`}
                          >
                            <span className="text-[#6A1FEB] font-medium text-[15px]">{idx + 1}.</span>
                            <div>
                              <p className={`${DESIGN.FONT_SIZES.md} ${DESIGN.COLORS.black} font-medium`}>
                                {item.content}
                              </p>
                            </div>
                          </div>
                        ))}
                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={startEditingAgenda}
                            className="px-4 py-2 text-[13px] rounded-lg border transition font-semibold bg-white text-[#141414] border-[#E6E1E6] hover:bg-gray-50"
                          >
                            수정하기
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className={`${DESIGN.BACKGROUND_COLORS.grayLight} ${DESIGN.RADIUS_SIZES.xl} p-6 shadow-sm`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={`${DESIGN.FONT_SIZES.lg} ${DESIGN.COLORS.black} font-semibold`}>
                      기초 안건이 없습니다
                    </p>
                    <p className={`${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray} mt-1`}>
                      회의 시작 전에 기초 안건을 생성해 주세요.
                    </p>
                  </div>

                  <button
                    onClick={() => navigate(`/meetings/${meetingId}/upload`, { state: { showAgenda: true, showPrepMaterial } })}
                    className="px-4 py-2 rounded-lg bg-[#6A1FEB] text-white text-sm font-semibold hover:opacity-90 active:scale-95 transition"
                  >
                    기초 안건 생성
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {showPrepMaterial && (
          <>
            {hasPrepMaterial ? (
              <div className={`${DESIGN.BACKGROUND_COLORS.grayLight} ${DESIGN.RADIUS_SIZES.xl} overflow-hidden shadow-sm`}>
                <button
                  onClick={() => setMaterialsOpen(!materialsOpen)}
                  className="w-full flex items-center justify-between p-5 text-left outline-none"
                >
                  <span className={`${DESIGN.FONT_SIZES.lg} ${DESIGN.COLORS.black} font-semibold`}>
                    회의 준비 자료
                  </span>
                  <span className={`transform transition-transform duration-200 ${materialsOpen ? "rotate-180" : ""}`}>
                    <svg className="w-5 h-5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </span>
                </button>

                {materialsOpen && (
                  <div className="px-5 pb-5 pt-1 space-y-6">
                    {isEditingPrep ? (
                      <>
                        <div>
                          <p className="font-medium text-sm text-[#141414] mb-2">회의 목적</p>
                          <textarea
                            value={editedPrep.purpose}
                            onChange={(e) => setEditedPrep(prev => ({ ...prev, purpose: e.target.value }))}
                            rows={3}
                            className="w-full bg-white rounded-xl p-4 border border-[#E6E1E6] text-sm text-[#141414] outline-none focus:border-[#6A1FEB] resize-none transition"
                          />
                        </div>

                        <div>
                          <p className="font-medium text-sm text-[#141414] mb-2">프로젝트 현재 상태</p>
                          <textarea
                            value={editedPrep.project_status}
                            onChange={(e) => setEditedPrep(prev => ({ ...prev, project_status: e.target.value }))}
                            rows={5}
                            className="w-full bg-white rounded-xl p-4 border border-[#E6E1E6] text-sm text-[#141414] outline-none focus:border-[#6A1FEB] resize-none transition"
                          />
                        </div>

                        <div>
                          <p className="font-medium text-sm text-[#141414] mb-2">관련 규정 및 제약사항</p>
                          <div className="bg-gray-50 rounded-xl p-4 border border-[#E6E1E6]">
                            <p className="whitespace-pre-wrap text-[13px] text-[#767676]">{editedPrep.rule || "-"}</p>
                          </div>
                        </div>

                        <div>
                          <p className="font-medium text-sm text-[#141414] mb-2">회의 종료 후 기대 결과</p>
                          <textarea
                            value={editedPrep.effect}
                            onChange={(e) => setEditedPrep(prev => ({ ...prev, effect: e.target.value }))}
                            rows={3}
                            className="w-full bg-white rounded-xl p-4 border border-[#E6E1E6] text-sm text-[#141414] outline-none focus:border-[#6A1FEB] resize-none transition"
                          />
                        </div>

                        <div>
                          <p className="font-medium text-sm text-[#141414] mb-2">출처</p>
                          <div className="bg-gray-50 rounded-xl p-4 border border-[#E6E1E6] space-y-2">
                            {uniquePrepSources.length > 0 ? (
                              uniquePrepSources.map((src, i) => (
                                <div key={i} className="flex items-center gap-2 text-[13px]">
                                  <span className="text-[#767676]">- {src.title}</span>
                                  {src.file_url ? (
                                    <a
                                      href={src.file_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#6A1FEB] hover:underline font-semibold cursor-pointer"
                                    >
                                      더보기
                                    </a>
                                  ) : (
                                    <span className="text-gray-400 font-medium select-none">더보기 없음</span>
                                  )}
                                </div>
                              ))
                            ) : (
                              <p className="text-[13px] text-[#969696]">- 출처가 없습니다.</p>
                            )}
                          </div>
                        </div>

                        <div className="flex justify-end gap-2 pt-2">
                          <button
                            type="button"
                            onClick={() => setIsEditingPrep(false)}
                            className="px-4 py-2 text-[13px] rounded-lg border transition font-semibold bg-white text-[#141414] border-[#E6E1E6] hover:bg-gray-50"
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            onClick={saveEditedPrep}
                            className="px-4 py-2 text-[13px] rounded-lg border transition font-semibold"
                            style={{ backgroundColor: "#6A1FEB", color: "#ffffff", borderColor: "#6A1FEB" }}
                          >
                            완료
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        {prepMaterial ? (
                          <>
                            <div>
                              <p className="font-medium text-sm text-[#141414] mb-2">회의 목적</p>
                              <div className="bg-white rounded-xl p-4 border border-[#E6E1E6]">
                                <p className="whitespace-pre-wrap text-[13px] text-[#555555]">{prepMaterial.purpose || "-"}</p>
                              </div>
                            </div>

                            <div>
                              <p className="font-medium text-sm text-[#141414] mb-2">프로젝트 현재 상태</p>
                              <div className="bg-white rounded-xl p-4 border border-[#E6E1E6]">
                                <p className="whitespace-pre-wrap text-[13px] text-[#555555]">{prepMaterial.project_status || "-"}</p>
                              </div>
                            </div>

                            <div>
                              <p className="font-mediumum text-sm text-[#141414] mb-2">관련 규정 및 제약사항</p>
                              <div className="bg-white rounded-xl p-4 border border-[#E6E1E6]">
                                <p className="whitespace-pre-wrap text-[13px] text-[#555555]">{prepMaterial.rule || "-"}</p>
                              </div>
                            </div>

                            <div>
                              <p className="font-medium text-sm text-[#141414] mb-2">회의 종료 후 기대 결과</p>
                              <div className="bg-white rounded-xl p-4 border border-[#E6E1E6]">
                                <p className="whitespace-pre-wrap text-[13px] text-[#555555]">{prepMaterial.effect || "-"}</p>
                              </div>
                            </div>

                            <div>
                              <p className="font-medium text-sm text-[#141414] mb-2">출처</p>
                              <div className="bg-white rounded-xl p-4 border border-[#E6E1E6] space-y-2">
                                {uniquePrepSources.length > 0 ? (
                                  uniquePrepSources.map((src, i) => (
                                    <div key={i} className="flex items-center gap-2 text-[13px]">
                                      <span className="text-[#141414]">- {src.title}</span>
                                      {src.file_url ? (
                                        <a
                                          href={src.file_url}
                                          target="_blank"
                                          rel="noopener noreferrer"
                                          className="text-[#6A1FEB] hover:underline font-semibold cursor-pointer"
                                        >
                                          더보기
                                        </a>
                                      ) : (
                                        <span className="text-gray-400 font-medium select-none">더보기 없음</span>
                                      )}
                                    </div>
                                  ))
                                ) : (
                                  <p className="text-[13px] text-[#969696]">- 출처가 없습니다.</p>
                                )}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="bg-white rounded-xl p-4 border border-[#E6E1E6]">
                            <p className="text-[13px] text-[#969696]">{String(meeting.meeting_document)}</p>
                          </div>
                        )}
                        <div className="flex justify-end pt-2">
                          <button
                            type="button"
                            onClick={startEditingPrep}
                            className="px-4 py-2 text-[13px] rounded-lg border transition font-semibold bg-white text-[#141414] border-[#E6E1E6] hover:bg-gray-50"
                          >
                            수정하기
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div className={`${DESIGN.BACKGROUND_COLORS.grayLight} ${DESIGN.RADIUS_SIZES.xl} p-6 shadow-sm`}>
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className={`${DESIGN.FONT_SIZES.lg} ${DESIGN.COLORS.black} font-semibold`}>
                      회의 준비 자료가 없습니다
                    </p>
                    <p className={`${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray} mt-1`}>
                      회의 시작 전에 회의 준비 자료를 생성해 주세요.
                    </p>
                  </div>

                  <button
                    onClick={() => navigate(`/meetings/${meetingId}/upload`, {
                      state: { type: "prep", projectId: meeting.project, showAgenda, showPrepMaterial }
                    })}
                    className="px-4 py-2 rounded-lg bg-[#6A1FEB] text-white text-sm font-semibold hover:opacity-90 active:scale-95 transition"
                  >
                    회의 준비 자료 생성
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <div className="w-[320px] flex-shrink-0 bg-white border-l border-gray-100 flex flex-col h-full">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <span className={`${DESIGN.FONT_SIZES.md} ${DESIGN.COLORS.black} font-medium`}>회의 챗봇</span>
        </div>

        <div ref={chatRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 flex flex-col gap-3">
          {!isChatEnabled && chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-300">
              <p className={`${DESIGN.FONT_SIZES.sm} text-gray-400`}>회의 시작 후 사용 가능합니다</p>
            </div>
          ) : chatMessages.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-300 p-4">
              <p className="text-xs text-gray-400">회의 준비 자료나 안건에 대해 자유롭게 질문해 보세요!</p>
            </div>
          ) : (
            chatMessages.map((msg, i) => (
              <div key={i} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"}`}>
                <div
                  className={`text-xs px-3 py-2 rounded-2xl max-w-[85%] border break-all ${
                    msg.role === "user"
                      ? "bg-[#F3F0FF] border-[#6A1FEB] text-[#141414] rounded-tr-sm"
                      : "bg-[#FAF9F7] border-[#FAF9F7] text-[#141414] rounded-tl-sm"
                  }`}
                >
                  <p className="whitespace-pre-wrap">{msg.content}</p>
            
                </div>
              </div>
            ))
          )}

          {chatLoading && (
            <div className="items-start flex flex-col">
              <div className="bg-gray-100 text-gray-400 text-xs px-3 py-2 rounded-2xl rounded-tl-sm">
                답변 생성 중...
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-100">
          <div className="relative flex items-center">
            <input
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              disabled={!isChatEnabled}
              placeholder={isChatEnabled ? "챗봇한테 질문해보세요" : "회의 시작 후 사용 가능합니다"}
              className="w-full text-xs pl-4 pr-10 py-3 border border-gray-200 rounded-xl outline-none focus:border-[#6A1FEB] disabled:bg-gray-50 disabled:text-gray-300 transition"
            />

            <button
              onClick={sendChat}
              disabled={!isChatEnabled}
              className="absolute right-2.5 w-7 h-7 flex items-center justify-center hover:opacity-70 active:scale-95 disabled:opacity-30 transition"
              aria-label="전송"
            >
              <img src={sendImg} alt="전송" className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
    </>
  );
}
