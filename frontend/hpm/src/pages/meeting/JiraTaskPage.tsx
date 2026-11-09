import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import { getTaskList, registerJiraTasks, type Task } from "../../services/meeting";
import StepBar from "../../components/meeting/StepBar";

const PRIORITY_LABEL: Record<string, string> = {
  Highest: "매우 높음", High: "높음", Medium: "중간", Low: "낮음", Lowest: "매우 낮음",
};

const PRIORITY_COLOR: Record<string, string> = {
  Highest: "border border-[#6A1FEB] bg-[#DCD0FE] text-[#6A1FEB]",
  High: "border border-[#6A1FEB] bg-[#DCD0FE] text-[#6A1FEB]",
  Medium: "border border-[#6A1FEB] bg-[#DCD0FE] text-[#6A1FEB]",
  Low: "border border-[#6A1FEB] bg-[#DCD0FE] text-[#6A1FEB]",
  Lowest: "border border-[#6A1FEB] bg-[#DCD0FE] text-[#6A1FEB]",
};

const STEP_LABELS = ["발화자 매핑", "회의록 검토 & 태스크 수정", "Jira 태스크 등록"];

export default function JiraTaskPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const meetingId = Number(id);

  const [tasks, setTasks] = useState<Task[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [registered, setRegistered] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [showRetryModal, setShowRetryModal] = useState(false);
  const [loadingMeetingId, setLoadingMeetingId] = useState(meetingId);

  // 다른 회의로 이동하면 렌더 중에 로딩 상태를 다시 켠다.
  if (!Object.is(loadingMeetingId, meetingId)) {
    setLoadingMeetingId(meetingId);
    setLoading(true);
  }

  useEffect(() => {
    getTaskList(meetingId)
      .then(list => {
        const nextTasks = list || [];
        setTasks(nextTasks);
        setSelected(new Set(nextTasks.map(task => task.meeting_task_id)));
        setRegistered(new Set());
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [meetingId]);

  const toggle = (taskId: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const runRegister = async () => {
    if (selected.size === 0) return;

    setRegistering(true);
    try {
      const taskIds = [...selected];
      const result = await registerJiraTasks(meetingId, taskIds, user?.users_id);
      const registeredTaskIds = result.registered.map(item => item.task_id);
      setRegistered(prev => {
        const next = new Set(prev);
        registeredTaskIds.forEach(taskId => next.add(taskId));
        return next;
      });
      setSelected(prev => {
        const next = new Set(prev);
        registeredTaskIds.forEach(taskId => next.delete(taskId));
        return next;
      });

      if (result.failed.length > 0 || result.registered.length === 0) {
        setShowRetryModal(true);
        return;
      }

      navigate(`/meetings/${meetingId}/archive`);
    } catch (error) {
      console.error("Jira 등록 실패:", error);
      setShowRetryModal(true);
    } finally {
      setRegistering(false);
    }
  };

  return (
    <>
    <div className="mx-auto max-w-[960px] p-8">
      <StepBar steps={STEP_LABELS} activeStep={3} />

      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-[24px] font-semibold text-[#141414]">Jira 태스크 등록</h1>
        <button
          type="button"
          disabled={selected.size === 0 || registering}
          onClick={runRegister}
          className="rounded-[8px] bg-[#6A1FEB] px-5 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#969696]"
        >
          {registering ? "등록 중..." : `선택 등록 (${selected.size})`}
        </button>
      </div>

      {loading ? (
        <div className="rounded-[12px] bg-[#F4F5F8] p-8 text-center text-sm text-[#969696]">
          태스크를 불러오는 중입니다.
        </div>
      ) : tasks.length === 0 ? (
        <div className="rounded-[12px] bg-[#F4F5F8] p-8 text-center text-sm text-[#969696]">
          등록할 태스크가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => {
            const isRegistered = registered.has(task.meeting_task_id);
            const isSelected = selected.has(task.meeting_task_id);

            return (
              <button
                key={task.meeting_task_id}
                type="button"
                disabled={isRegistered}
                onClick={() => toggle(task.meeting_task_id)}
                className={`rounded-[12px] border p-4 text-left transition ${
                  isSelected
                    ? "border-[#6A1FEB] bg-[#F4F1FF]"
                    : "border-[#E6E1E6] bg-white hover:border-[#6A1FEB]"
                } ${isRegistered ? "cursor-not-allowed opacity-60" : ""}`}
              >
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-[#141414]">{task.title}</p>
                    <p className="mt-1 text-xs text-[#969696]">
                      담당자 {task.owner || "미정"} · 마감 {task.due_date || "미정"}
                    </p>
                  </div>
                  <span
                    className={`flex h-9 shrink-0 items-center rounded-[7px] px-3 text-[13px] font-semibold ${
                      PRIORITY_COLOR[task.priority] || "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {PRIORITY_LABEL[task.priority] || task.priority || "중간"}
                  </span>
                </div>
                {isRegistered ? (
                  <p className="mt-2 text-xs text-[#6A1FEB]">이미 Jira에 등록되었습니다.</p>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => {
            navigate(`/meetings/${meetingId}/archive`);
          }}
          className="text-sm text-[#969696] underline hover:text-[#555]"
        >
          Jira 태스크 등록을 건너뛰시겠습니까? 이후 자동 등록은 불가합니다.
        </button>
      </div>
      {showRetryModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-80 overflow-hidden rounded-2xl bg-white shadow-xl">
            <div className="px-8 py-10 text-center">
              <p className="font-medium leading-relaxed text-[#6A1FEB]">
                Jira 등록에 실패하였습니다.<br />재시도 하시겠습니까?
              </p>
            </div>
            <div className="flex border-t border-gray-200">
              <button
                type="button"
                onClick={() => {
                  setShowRetryModal(false);
                  void runRegister();
                }}
                className="flex-1 border-r border-gray-200 py-4 text-sm text-gray-700 transition hover:bg-gray-50"
              >
                확인
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowRetryModal(false);
                  navigate(`/meetings/${meetingId}/archive`);
                }}
                className="flex-1 py-4 text-sm text-gray-700 transition hover:bg-gray-50"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}
