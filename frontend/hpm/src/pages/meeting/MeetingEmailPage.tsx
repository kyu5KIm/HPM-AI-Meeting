import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  getMeetingDetail,
  getTaskList,
  sendMeetingSummaryEmail,
  getUserList,
  type Meeting,
  type Task,
  type UserListItem
} from "../../services/meeting";

const PRIORITY_LABEL: Record<string, string> = {
  Highest: "매우 높음",
  High: "높음",
  Medium: "중간",
  Low: "낮음",
  Lowest: "매우 낮음",
};

interface Recipient{
  id : string;
  label : string;
}

const formatDate = (value?: string | null) => {
  if (!value) return "-";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.replace("T", " ").slice(0, 16);

  const pad = (num: number) => String(num).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

export default function MeetingEmailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const meetingId = Number(id);

  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [allUsers, setAllUsers] = useState<UserListItem[]>([]);
  const [searchInput, setSearchInput] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [loadingMeetingId, setLoadingMeetingId] = useState(meetingId);

  // 다른 회의로 이동하면 렌더 중에 로딩 상태를 다시 켠다.
  if (!Object.is(loadingMeetingId, meetingId)) {
    setLoadingMeetingId(meetingId);
    setLoading(true);
  }

  useEffect(() => {
    Promise.all([getMeetingDetail(meetingId), getTaskList(meetingId)])
      .then(([meetingDetail, taskList]) => {
        setMeeting(meetingDetail);
        setTasks(Array.isArray(taskList) ? taskList : []);
        if (meetingDetail.participants?.length)
        {
          setRecipients(meetingDetail.participants.map((p) => ({ id : String(p.user_id), label : p.name})));
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));

      getUserList()
      .then((data) => setAllUsers(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, [meetingId]);

  const removeRecipient = (id: string) =>
    setRecipients((prev) => prev.filter((r) => r.id !== id));

  const addRecipient = (user: UserListItem) => {
    const id = String(user.users_id);
    if (recipients.some((r) => r.id === id)) return;
    setRecipients((prev) => [...prev, { id, label: user.name }]);
    setSearchInput("");
    setShowDropdown(false);
  };

  const filteredUsers = allUsers.filter(
    (u) =>
      u.name.includes(searchInput) &&
      !recipients.some((r) => r.id === String(u.users_id))
  );

  const handleSend = async () => {
  if (sending || recipients.length === 0) return;
  setSending(true);
  try {
    const recipientIds = recipients.map((r) => Number(r.id));
    await sendMeetingSummaryEmail(meetingId, recipientIds);
    setSent(true);
  } catch (error) {
    const message =
      (error as { response?: { data?: { error?: string; failed?: unknown[] } } }).response?.data?.error ||
      "요약 이메일 발송에 실패했습니다. 이메일 발송 설정 또는 수신자 정보를 확인해주세요.";
    alert(message);
  } finally {
    setSending(false);
  }
};

  if (loading) {
    return <div className="p-8 text-gray-400">메일 발송 정보를 불러오는 중...</div>;
  }

  if (!meeting) {
    return <div className="p-8 text-gray-400">회의를 찾을 수 없습니다.</div>;
  }

  return (
    <div className="mx-auto max-w-6xl p-8">
      <div className="mb-6">
        <h1 className="text-[24px] font-semibold text-[#141414]">요약 메일 발송</h1>
        <p className="mt-1 text-[13px] text-[#969696]">회의 참여자 전체에게 회의록과 태스크 요약을 발송합니다.</p>
      </div>

      {sent ? (
        <div className="rounded-xl border border-[#E6E1E6] bg-white px-8 py-14 text-center">
          <p className="text-[15px] font-semibold text-[#6A1FEB]">메일이 참여자 전체에게 발송되었습니다.</p>
          <div className="mt-6 flex justify-center gap-3">
            <button
              type="button"
              onClick={() => navigate(`/meetings/${meetingId}/archive`)}
              className="rounded-lg bg-[#6A1FEB] px-5 py-2 text-sm font-semibold text-white"
            >
              회의 후 상세보기
            </button>
            <button
              type="button"
              onClick={() => navigate("/meetings")}
              className="rounded-lg border border-[#E6E1E6] px-5 py-2 text-sm font-medium text-[#555] hover:bg-[#F4F5F8]"
            >
              회의 목록
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="flex gap-5">
            <div className="flex flex-1 flex-col gap-4">
              <div className="rounded-xl border border-[#E6E1E6] bg-white p-5">
                <p className="mb-1 text-[12px] text-[#969696]">회의 제목</p>
                <p className="text-[14px] font-medium text-[#141414]">{meeting.title}</p>
              </div>

              <div className="rounded-xl border border-[#E6E1E6] bg-white">
                <p className="px-5 pb-2 pt-4 text-[13px] font-medium text-[#141414]">회의 정보</p>
                <div className="flex flex-col gap-2 px-5 pb-4 text-[13px]">
                  <div className="flex gap-3">
                    <span className="min-w-[70px] text-[#969696]">회의 일시</span>
                    <span className="text-[#141414]">{formatDate(meeting.meeting_at)}</span>
                  </div>
                  <div className="flex gap-3">
                    <span className="min-w-[70px] text-[#969696]">회의 참석자</span>
                    <span className="text-[#141414]">
                      {recipients.map((r) => r.label).join(", ") || "-"}
                    </span>
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-[#E6E1E6] bg-white">
                <p className="px-5 pb-2 pt-4 text-[13px] font-medium text-[#141414]">부여된 태스크</p>
                <table className="w-full border-collapse text-[12px]">
                  <thead>
                    <tr className="border-y border-[#E6E1E6] bg-[#F4F5F8]">
                      <th className="px-4 py-2.5 text-left font-medium text-[#555]">태스크</th>
                      <th className="w-[80px] whitespace-nowrap px-4 py-2.5 text-left font-medium text-[#555]">담당자</th>
                      <th className="w-[100px] whitespace-nowrap px-4 py-2.5 text-left font-medium text-[#555]">기한</th>
                      <th className="w-[82px] whitespace-nowrap px-4 py-2.5 text-left font-medium text-[#555]">우선순위</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasks.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="px-4 py-6 text-center text-[#969696]">등록된 태스크가 없습니다.</td>
                      </tr>
                    ) : tasks.map((task, idx) => (
                      <tr key={task.meeting_task_id} className={idx < tasks.length - 1 ? "border-b border-[#E6E1E6]" : ""}>
                        <td className="px-4 py-3 text-[#141414]">{task.title}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#555]">{task.owner || "미배정"}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-[#555]">{task.due_date || "-"}</td>
                        <td className="whitespace-nowrap px-4 py-3">
                          <span className="rounded-full bg-[#F2F0FF] px-2 py-0.5 text-[11px] text-[#6A1FEB]">
                            {PRIORITY_LABEL[task.priority] || task.priority || "중간"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="rounded-xl border border-[#E6E1E6] bg-white p-4">
        <p className="mb-3 text-[13px] font-medium text-[#141414]">이메일 수신자</p>
        <div className="min-h-[48px] border border-[#E6E1E6] rounded-xl px-3 py-2.5 flex flex-wrap gap-2 mb-2">
          {recipients.map((r) => (
            <span
              key={r.id}
              className="flex items-center gap-1.5 px-3 py-1 rounded-lg text-[12px] text-[#141414] bg-[#F4F5F8] border border-[#E6E1E6]"
            >
              {r.label}
              <button
                type="button"
                onClick={() => removeRecipient(r.id)}
                className="text-[#969696] hover:text-[#141414] leading-none"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        {/* 수신자 추가 입력창 */}
        <div className="relative">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => { setSearchInput(e.target.value); setShowDropdown(true); }}
            onFocus={() => setShowDropdown(true)}
            onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            placeholder="이름으로 수신자 추가"
            className="w-full border border-[#E6E1E6] rounded-xl px-4 py-2 text-[13px] outline-none focus:border-[#6A1FEB] transition"
          />
          {showDropdown && filteredUsers.length > 0 && (
            <ul className="absolute z-10 left-0 right-0 top-full mt-1 bg-white border border-[#E6E1E6] rounded-xl shadow-md max-h-40 overflow-y-auto">
              {filteredUsers.map((u) => (
                <li
                  key={u.users_id}
                  onMouseDown={() => addRecipient(u)}
                  className="px-4 py-2 text-[13px] text-[#141414] hover:bg-[#F4F5F8] cursor-pointer"
                >
                  {u.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
            </div>

            <div className="w-[440px] shrink-0">
              <p className="mb-3 text-[14px] font-medium text-[#141414]">이메일 미리보기</p>
              <div className="rounded-xl border border-[#E6E1E6] bg-white px-6 py-5 text-[13px] leading-relaxed text-[#333]">
                <p className="mb-4">안녕하세요, OOO.</p>
                <p className="mb-4">회의록이 확정되었습니다. 아래 태스크가 부여되었으니 기한 내에 처리해 주세요.</p>
                <p className="mb-1 font-medium">[회의 정보]</p>
                <p>• 회의 제목: {meeting.title}</p>
                <p className="mb-4">• 회의 일시: {formatDate(meeting.meeting_at)}</p>
                <p className="mb-1 font-medium">[부여된 태스크]</p>
                {tasks.length === 0 ? (
                  <p>등록된 태스크가 없습니다.</p>
                ) : tasks.map((task, index) => (
                  <p key={task.meeting_task_id}>
                    {index + 1}. {task.title} (담당자: {task.owner || "미배정"}, 기한: {task.due_date || "-"}, 우선순위: {PRIORITY_LABEL[task.priority] || task.priority || "중간"})
                  </p>
                ))}
                <p className="mt-4">프로젝트에서 더 자세한 내용을 확인하실 수 있습니다.</p>
                <p>감사합니다.</p>
              </div>
            </div>
          </div>

          <div className="mt-5 flex justify-end">
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || recipients.length === 0}
              className="rounded-lg bg-[#6A1FEB] px-8 py-3 text-[14px] font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#969696]"
            >
              {sending ? "발송 중..." : "이메일 발송"}
            </button>
          </div>

          <div className="mt-6 text-center">
            <button
              type="button"
              onClick={() => navigate(`/meetings/${meetingId}/archive`)}
              className="text-sm text-[#969696] underline hover:text-[#555]"
            >
              메일 발송을 건너뛰겠습니까? 메일 발송 없이 회의가 마무리 됩니다.
            </button>
          </div>
        </>
      )}
    </div>
  );
}
