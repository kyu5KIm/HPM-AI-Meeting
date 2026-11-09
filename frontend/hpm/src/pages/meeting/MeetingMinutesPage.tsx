import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createTask,
  deleteTask,
  getMeetingDetail,
  getTaskList,
  updateTask,
  updateMeeting,
  approveMinutes,
  rejectMinutes,
  completeMeetingMappedTranscriptOnly,
  type Meeting,
  type Task,
} from "../../services/meeting";
import warningIcon from "../../assets/table/warning2.png";
import StepBar from "../../components/meeting/StepBar";
import useMeetingReviewNavigationGuard from "../../hooks/useMeetingReviewNavigationGuard";

const PRIORITY_LABEL: Record<string, string> = {
  Highest: "매우 높음", High: "높음", Medium: "중간", Low: "낮음", Lowest: "매우 낮음",
};

const STEP_LABELS = ["발화자 매핑", "회의록 검토 & 태스크 수정", "Jira 태스크 등록"];

const formatMeetingDateTime = (value?: string | null) => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.replace("T", " ").slice(0, 16);
  }

  const pad = (num: number) => String(num).padStart(2, "0");
  return [
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    `${pad(date.getHours())}:${pad(date.getMinutes())}`,
  ].join(" ");
};

export default function MeetingMinutesPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meetingId = Number(id);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  const [collapsedTasks, setCollapsedTasks] = useState<Set<number>>(new Set());
  const [openPriorityDropdown, setOpenPriorityDropdown] = useState<number | null>(null);
  const [openAssigneeDropdown, setOpenAssigneeDropdown] = useState<number | null>(null);
  const [requested, setRequested] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const completedNavigationRef = useRef(false);
  const { allowReviewNavigation, reviewExitModal } = useMeetingReviewNavigationGuard({
    enabled: Boolean(meeting && !meeting.is_meeting_approve),
    meetingId,
    onConfirmExit: () => completeMeetingMappedTranscriptOnly(meetingId),
  });

  const toggleCollapse = (taskId: number) => {
    setCollapsedTasks(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const [loadingMeetingId, setLoadingMeetingId] = useState(meetingId);

  // 다른 회의로 이동하면 렌더 중에 로딩 상태를 다시 켠다.
  if (!Object.is(loadingMeetingId, meetingId)) {
    setLoadingMeetingId(meetingId);
    setLoading(true);
  }

  useEffect(() => {
    Promise.all([getMeetingDetail(meetingId), getTaskList(meetingId)])
      .then(([m, t]) => {
        if (m) setMeeting(m);
        if (t) setTasks(t);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [meetingId]);

  const finalizeMinutesReview = useCallback(async () => {
    if (!meeting || meeting.is_meeting_approve) return true;

    const meetingDocument = meeting.meeting_document?.trim() || "";
    if (!meetingDocument) {
      alert("회의록 내용을 입력한 뒤 검토 완료를 눌러주세요.");
      return false;
    }

    setRequested(true);
    try {
      await updateMeeting(meetingId, { meeting_document: meetingDocument });
      await approveMinutes(meetingId);
      setMeeting(m => m ? { ...m, meeting_document: meetingDocument, is_meeting_approve: true, minutes_status: "approved" } : m);
      return true;
    } catch {
      alert("검토 완료 처리에 실패했습니다.");
      setRequested(false);
      return false;
    }
  }, [meeting, meetingId]);

  useEffect(() => {
    if (meeting?.is_meeting_approve && !completedNavigationRef.current) {
      allowReviewNavigation();
      navigate(`/meetings/${meetingId}/archive`, { replace: true });
    }
  }, [allowReviewNavigation, meeting?.is_meeting_approve, meetingId, navigate]);

  if (loading) return <div className="p-8 text-gray-400">불러오는 중...</div>;
  if (!meeting) return <div className="p-8 text-gray-400">회의를 찾을 수 없습니다.</div>;

  const minutesStatus = meeting.is_meeting_approve ? "approved" : meeting.minutes_status || "draft";

  const handleReviewComplete = async () => {
    const finalized = await finalizeMinutesReview();
    if (!finalized) return;
    completedNavigationRef.current = true;
    allowReviewNavigation();
    navigate(`/meetings/${meetingId}/jira`);
  };

  const handleApprove = async () => {
    const finalized = await finalizeMinutesReview();
    if (!finalized) return;
    completedNavigationRef.current = true;
    allowReviewNavigation();
    navigate(`/meetings/${meetingId}/jira`);
  };

  const handleReject = async () => {
    try {
      await rejectMinutes(meetingId);
      setMeeting(m => m ? { ...m, minutes_status: "rejected" } : m);
    } catch { alert("거절에 실패했습니다."); }
  };

  const handleTaskUpdate = async (task: Task, field: keyof Task, value: string) => {
    const nextValue = field === "due_date" && value === "" ? null : value;
    // 즉시 UI 반영 (optimistic update)
    setTasks(prev => prev.map(t =>
      t.meeting_task_id === task.meeting_task_id ? { ...t, [field]: nextValue } : t
    ));
    try {
      await updateTask(meetingId, task.meeting_task_id, { [field]: nextValue });
    } catch (e) { console.error(e); }
  };

  const handleTaskAssigneeUpdate = async (
    task: Task,
    participant?: NonNullable<Meeting["participants"]>[number],
  ) => {
    setTasks(prev => prev.map(t =>
      t.meeting_task_id === task.meeting_task_id
        ? { ...t, owner: participant?.name || "", meeting_users: participant?.meeting_users_id ?? null }
        : t
    ));

    try {
      await updateTask(meetingId, task.meeting_task_id, {
        meeting_users_id: participant?.meeting_users_id ?? null,
        user_id: participant?.user_id ?? null,
      });
    } catch (e) { console.error(e); }
  };

  const handleAddTask = async () => {
    if (addingTask) return;
    setAddingTask(true);

    try {
      const task = await createTask(meetingId, {
        title: "새 업무",
        content: "",
        due_date: null,
        priority: "Medium",
      });
      setTasks(prev => [...prev, task]);
    } catch (e) {
      console.error(e);
      alert("업무 추가에 실패했습니다.");
    } finally {
      setAddingTask(false);
    }
  };

  const handleDeleteTask = async (task: Task) => {
    const previousTasks = tasks;
    setTasks(prev => prev.filter(item => item.meeting_task_id !== task.meeting_task_id));

    try {
      await deleteTask(meetingId, task.meeting_task_id);
    } catch (e) {
      console.error(e);
      setTasks(previousTasks);
      alert("업무 삭제에 실패했습니다.");
    }
  };

  return (
    <>
    <div className="p-8 max-w-5xl mx-auto">

      <StepBar steps={STEP_LABELS} activeStep={2} />

      {/* 상태 배너 */}
      {minutesStatus === "reviewing" && (
        <div className="mb-4 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg text-sm font-medium text-amber-800">
          ⏳ 프로젝트 생성자의 승인을 기다리고 있습니다.
        </div>
      )}
      {minutesStatus === "rejected" && (
        <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm font-medium text-red-700">
          ❌ 승인이 거절되었습니다. 회의록을 수정한 후 재요청해 주세요.
        </div>
      )}

      {/* 회의록 카드 */}
      <div className="bg-white rounded-xl border border-gray-200 mb-4">
        {/* 카드 헤더 */}
        <div className="flex items-center justify-between px-6 py-4">
          <h2 className="text-lg font-bold text-gray-900">회의록</h2>
          <div className="flex gap-2">
            {minutesStatus === "draft" && (
              <button
                onClick={handleReviewComplete}
                disabled={requested}
                className="px-5 py-2 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-80"
                style={{ backgroundColor: "#6A1FEB" }}
              >
                {requested ? "처리 중..." : "검토 완료"}
              </button>
            )}
            {minutesStatus === "reviewing" && (
              <>
                <button
                  onClick={handleReject}
                  className="px-5 py-2 bg-red-500 text-white rounded-lg text-sm font-semibold hover:bg-red-600"
                >
                  거절
                </button>
                <button
                  onClick={handleApprove}
                  className="px-5 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700"
                >
                  승인
                </button>
              </>
            )}
          </div>
        </div>

        {/* 회의 정보 테이블 */}
        <table className="w-full text-sm border-collapse border-t border-gray-100">
          <tbody>
            <tr className="border-b border-gray-100">
              <td className="px-6 py-3 w-28 text-gray-500 whitespace-nowrap">회의 주제</td>
              <td className="px-4 py-3 text-gray-800" colSpan={3}>{meeting.title}</td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-6 py-3 text-gray-500 whitespace-nowrap">회의 일시</td>
              <td className="px-4 py-3 text-gray-800">{formatMeetingDateTime(meeting.meeting_at)}</td>
              <td className="px-6 py-3 text-gray-500 whitespace-nowrap w-20 border-l border-gray-100">작성자</td>
              <td className="px-4 py-3 text-gray-800">
                {meeting.creator_name || meeting.participants?.[0]?.name || "-"}
              </td>
            </tr>
            <tr className="border-b border-gray-100">
              <td className="px-6 py-3 text-gray-500 whitespace-nowrap">회의 장소</td>
              <td className="px-4 py-3 text-gray-800" colSpan={3}>{meeting.location || "미정"}</td>
            </tr>
            <tr>
              <td className="px-6 py-3 text-gray-500 whitespace-nowrap">참석자</td>
              <td className="px-4 py-3 text-gray-800" colSpan={3}>
                {meeting.participants?.map(p => p.name).join(", ")}
              </td>
            </tr>
          </tbody>
        </table>

        {/* 회의 내용 헤더 */}
        <div className="bg-gray-100 text-center py-2 text-sm font-semibold text-gray-700 border-t border-gray-200">
          회의 내용
        </div>

        {/* 회의 내용 본문 */}
        <div className="p-6">
          <textarea
            value={meeting.meeting_document || ""}
            onChange={e => setMeeting(m => m ? { ...m, meeting_document: e.target.value } : m)}
            className="w-full border border-gray-200 rounded-lg p-4 text-sm text-gray-700 leading-relaxed min-h-[320px] resize-y outline-none focus:border-[#6A1FEB]"
            placeholder="회의 내용이 없습니다."
          />
        </div>
      </div>

      {/* 업무 카드 */}
      <div className="bg-white rounded-xl border border-gray-200">
        {/* 업무 헤더 */}
        <div className="flex items-center justify-between px-6 py-3 bg-gray-50 border-b border-gray-200 rounded-t-xl">
          <span className="text-sm font-bold text-gray-800">업무</span>
          <span className="text-xs text-amber-600 flex items-center gap-1">
            <img src={warningIcon} alt="warning" className="w-4 h-4" /> 업무는 Jira에 등록할 태스크입니다!
          </span>
        </div>

        {/* 컬럼 헤더 */}
        <div className="grid gap-2 px-4 py-2 border-b border-gray-100 text-xs text-gray-500 font-medium"
          style={{ gridTemplateColumns: "1fr auto auto auto 2rem" }}>
          <span className="pl-2">업무 명</span>
          <span className="w-36 text-center">담당자</span>
          <span className="w-32 text-center">기한</span>
          <span className="w-28 text-center">우선순위</span>
          <span aria-hidden="true" />
        </div>

        {/* 태스크 목록 */}
        <div className="divide-y divide-gray-100">
          {tasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              <span>등록된 업무가 없습니다.</span>
            </div>
          ) : tasks.map(task => {
            const isCollapsed = collapsedTasks.has(task.meeting_task_id);
            const isPriorityOpen = openPriorityDropdown === task.meeting_task_id;
            return (
              <div key={task.meeting_task_id} className="px-4 py-3">
                <div className="flex items-center gap-2">
                  {/* 업무명 */}
                  <input
                    defaultValue={task.title}
                    onBlur={e => handleTaskUpdate(task, "title", e.target.value)}
                    className="h-9 flex-1 rounded-[7px] border border-[#E6E1E6] px-3 text-[13px] font-medium text-[#141414] outline-none transition focus:border-[#6A1FEB]"
                    placeholder="업무명을 입력하세요"
                  />
                  <button
                    type="button"
                    onClick={() => toggleCollapse(task.meeting_task_id)}
                    className="text-xs font-medium whitespace-nowrap hover:underline"
                    style={{ color: "#6A1FEB" }}
                  >
                    {isCollapsed ? "펼치기 ▼" : "접기 ▲"}
                  </button>
                  {/* 담당자 커스텀 드롭다운 */}
                  <div className="relative w-36">
                    <button
                      onClick={() => setOpenAssigneeDropdown(
                        openAssigneeDropdown === task.meeting_task_id ? null : task.meeting_task_id
                      )}
                      className="flex h-9 w-full items-center justify-between rounded-[7px] border border-[#969696] bg-[#FFFDFD] px-3 text-left text-[13px] font-semibold text-[#141414] outline-none transition hover:border-[#6A1FEB] hover:bg-[#F4F1FF]"
                    >
                      <span className="truncate">{task.owner || "미배정"}</span>
                      <span className="ml-1 text-[12px] text-[#6A1FEB]">▾</span>
                    </button>
                    {openAssigneeDropdown === task.meeting_task_id && (
                      <>
                        <div className="fixed inset-0 z-10" onClick={() => setOpenAssigneeDropdown(null)} />
                        <div className="absolute z-20 top-full mt-1 right-0 w-44 overflow-hidden rounded-[7px] border border-[#6A1FEB] bg-white py-1 shadow-lg shadow-[#6A1FEB]/10">
                          {meeting.participants?.map(p => (
                            <button
                              key={p.user_id}
                              onClick={() => {
                                handleTaskAssigneeUpdate(task, p);
                                setOpenAssigneeDropdown(null);
                              }}
                              className={`w-full px-4 py-2.5 text-left text-[13px] font-medium transition
                                ${task.owner === p.name
                                  ? "bg-[#DCD0FE] text-[#6A1FEB] font-semibold"
                                  : "text-[#141414] hover:bg-[#F4F1FF] hover:text-[#6A1FEB]"}`}
                            >
                              {p.name}
                            </button>
                          ))}
                          <button
                            onClick={() => {
                              handleTaskAssigneeUpdate(task);
                              setOpenAssigneeDropdown(null);
                            }}
                            className="w-full px-4 py-2.5 text-left text-[13px] font-medium text-[#969696] hover:bg-[#F4F1FF] hover:text-[#6A1FEB]"
                          >
                            미배정
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                  {/* 기한 */}
                  <input
                    type="date"
                    defaultValue={task.due_date || ""}
                    onBlur={e => handleTaskUpdate(task, "due_date", e.target.value)}
                    className="h-9 w-32 rounded-[7px] border border-[#E6E1E6] px-2 text-[13px] font-medium text-[#141414] outline-none transition focus:border-[#6A1FEB]"
                  />
                  {/* 우선순위 커스텀 드롭다운 */}
                  <div className="relative w-28">
                    <button
                      onClick={() => setOpenPriorityDropdown(isPriorityOpen ? null : task.meeting_task_id)}
                      className="flex h-9 w-full items-center justify-between rounded-[7px] border border-[#6A1FEB] bg-[#DCD0FE] px-3 text-left text-[13px] font-semibold text-[#6A1FEB] outline-none transition hover:bg-[#C4B6E5]"
                    >
                      <span>{PRIORITY_LABEL[task.priority] || task.priority}</span>
                      <span className="text-[12px] text-[#6A1FEB]">▾</span>
                    </button>
                    {isPriorityOpen && (
                      <>
                        {/* 닫기 오버레이 */}
                        <div className="fixed inset-0 z-10" onClick={() => setOpenPriorityDropdown(null)} />
                        {/* 드롭다운 목록 */}
                        <div className="absolute z-20 top-full mt-1 right-0 w-32 overflow-hidden rounded-[7px] border border-[#6A1FEB] bg-white py-1 shadow-lg shadow-[#6A1FEB]/10">
                          {[
                            { value: "Highest", label: "매우 높음" },
                            { value: "High", label: "높음" },
                            { value: "Medium", label: "중간" },
                            { value: "Low", label: "낮음" },
                            { value: "Lowest", label: "매우 낮음" },
                          ].map(opt => (
                            <button
                              key={opt.value}
                              onClick={() => {
                                handleTaskUpdate(task, "priority", opt.value);
                                setOpenPriorityDropdown(null);
                              }}
                              className={`w-full px-3 py-2.5 text-left text-[13px] font-medium transition
                                ${task.priority === opt.value
                                  ? "mx-1 w-[calc(100%-8px)] rounded-[7px] bg-[#DCD0FE] text-[#6A1FEB] font-semibold"
                                  : "text-[#141414] hover:bg-[#F4F1FF] hover:text-[#6A1FEB]"}`}
                            >
                              {opt.label}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDeleteTask(task)}
                    aria-label="업무 삭제"
                    title="업무 삭제"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded text-lg leading-none text-gray-500 hover:bg-gray-50 hover:text-gray-900"
                  >
                    ×
                  </button>
                </div>
                {!isCollapsed && (
                  <textarea
                    defaultValue={task.content || ""}
                    onBlur={e => handleTaskUpdate(task, "content", e.target.value)}
                    className="mt-2 min-h-[72px] w-full resize-y rounded-[7px] border border-[#E6E1E6] bg-[#F4F5F8] px-3 py-2 text-[12px] text-[#555] outline-none transition focus:border-[#6A1FEB] focus:bg-white"
                    placeholder="업무 내용을 입력하세요"
                  />
                )}
              </div>
            );
          })}
        </div>
        <div className="px-4 py-4">
          <button
            type="button"
            onClick={handleAddTask}
            disabled={addingTask}
            className="text-sm font-medium text-gray-700 hover:text-[#6A1FEB] disabled:cursor-not-allowed disabled:opacity-60"
          >
            + 추가 하기
          </button>
        </div>
      </div>

      {/* 하단 버튼 */}
      <div className="flex justify-end items-center mt-5">
        {minutesStatus === "approved" && (
          <button
            onClick={() => {
              completedNavigationRef.current = true;
              allowReviewNavigation();
              navigate(`/meetings/${meetingId}/jira`);
            }}
            className="px-5 py-2 text-white rounded-lg text-sm font-semibold"
            style={{ backgroundColor: "#6A1FEB" }}
          >
            Jira 등록 →
          </button>
        )}
      </div>
    </div>
    {reviewExitModal}
    </>
  );
}
