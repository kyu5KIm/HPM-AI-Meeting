import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import {
  getMeetingDetail,
  getTaskList,
  sendMeetingSummaryEmail,
  getTranscript,
  getAgendaList,
  getPrepMaterial,
  type Meeting,
  type Task,
  type TranscriptItem,
  type AgendaItem,
  type MeetingPreparation,
} from "../../services/meeting";

type TabKey = "minutes" | "record" | "material" | "email";

const TABS: { key: TabKey; label: string }[] = [
  { key: "minutes",  label: "회의록" },
  { key: "record",   label: "녹음 원문" },
  { key: "material", label: "회의 자료" },
  { key: "email",    label: "이메일 발송" },
];

const EMPTY_MEETING: Meeting = {
  meeting_id: 0,
  title: "",
  location: "",
  meeting_at: "",
  status: "finished",
  minutes_status: null,
  meeting_document: null,
  is_meeting: false,
  project: 0,
  participants: [],
};

const PRIORITY_LABEL: Record<string, string> = {
  Highest: "매우 높음", High: "높음", Medium: "중간", Low: "낮음", Lowest: "매우 낮음",
};

const EMPTY_MATERIAL_TEXT = "자료가 존재하지 않습니다";

export default function MeetingArchivePage() {
  const { id } = useParams();
  const meetingId = Number(id);

  const [tab, setTab] = useState<TabKey>("minutes");
  const [meeting, setMeeting] = useState<Meeting>(EMPTY_MEETING);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [agenda, setAgenda] = useState<AgendaItem[]>([]);
  const [prep, setPrep] = useState<MeetingPreparation | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [downloading, setDownloading] = useState(false);

  // 이메일 발송
  const [recipients, setRecipients] = useState<NonNullable<Meeting["participants"]>>([]);
  const [emailRecipientQuery, setEmailRecipientQuery] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [showEmailConfirmModal, setShowEmailConfirmModal] = useState(false);

  useEffect(() => {
    Promise.all([
      getMeetingDetail(meetingId),
      getTaskList(meetingId),
      getTranscript(meetingId),
      getAgendaList(meetingId),
      getPrepMaterial(meetingId),
    ])
      .then(([m, t, tr, ag, pr]) => {
        if (m) {
          setMeeting(m);
          setRecipients(m.participants || []);
        }
        setTasks(t || []);
        setTranscript(tr || []);
        setAgenda(ag || []);
        setPrep(pr || null);
      })
      .catch(() => {});
  }, [meetingId]);

  const toggleExpand = (taskId: number) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  };

  const formatDate = (iso: string) =>
    iso ? iso.replace("T", " ").slice(0, 16) : "-";

  const participantNames = meeting.participants?.map(p => p.name).join(", ") || "-";
  const writer = meeting.participants?.[0]?.name || "-";
  const hasMeetingMaterial = Boolean(
    agenda.length > 0 ||
    prep?.purpose ||
    prep?.project_status ||
    prep?.rule ||
    prep?.effect ||
    prep?.sources?.length,
  );
  const selectedRecipientIds = new Set(recipients.map(recipient => recipient.user_id));
  const normalizedRecipientQuery = emailRecipientQuery.trim().toLowerCase();
  const matchingRecipients = normalizedRecipientQuery
    ? (meeting.participants || []).filter(participant => {
        if (selectedRecipientIds.has(participant.user_id)) return false;
        return [
          participant.name,
          participant.email || "",
          participant.work || "",
        ].some(value => value.toLowerCase().includes(normalizedRecipientQuery));
      })
    : [];

  const handlePdfDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const W = 794;
      const wrapper = document.createElement("div");
      wrapper.style.cssText = `
        position:absolute; top:-9999px; left:-9999px;
        width:${W}px; background:#fff;
        padding:48px 48px 60px;
        font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
        box-sizing:border-box; color:#141414;
      `;

      // 회의록 카드
      const card = document.createElement("div");
      card.style.cssText = `border:1px solid #D0D0D0; border-radius:12px; margin-bottom:20px; overflow:hidden;`;

      const cardHeader = document.createElement("div");
      cardHeader.style.cssText = `padding:14px 20px; border-bottom:1px solid #D0D0D0; font-size:15px; font-weight:700; text-align:left;`;
      cardHeader.textContent = "회의록";
      card.appendChild(cardHeader);

      const table = document.createElement("table");
      table.style.cssText = `width:100%; border-collapse:collapse; table-layout:fixed; font-size:13px;`;

      const colgroup = document.createElement("colgroup");
      ["120px", "calc((100% - 240px) / 2)", "120px", "calc((100% - 240px) / 2)"].forEach(width => {
        const col = document.createElement("col");
        col.style.width = width;
        colgroup.appendChild(col);
      });
      table.appendChild(colgroup);

    
      const mkTd = (text: string, isLabel: boolean, opts: { colSpan?: number; borderRight?: boolean; borderBottom?: boolean } = {}) => {
        const td = document.createElement("td");
        if (opts.colSpan) td.colSpan = opts.colSpan;
        const borderR = opts.borderRight !== false && isLabel ? "border-right:1px solid #D0D0D0;" : (opts.borderRight ? "border-right:1px solid #D0D0D0;" : "");
        const borderB = opts.borderBottom !== false ? "border-bottom:1px solid #D0D0D0;" : "";
        td.style.cssText = isLabel
          ? `padding:14px 16px; font-weight:600; color:#555; background:#FAFAFA; width:110px; white-space:nowrap; ${borderR}${borderB}`
          : `padding:14px 16px; color:#141414; ${borderR}${borderB}`;
        td.textContent = text;
        return td;
      };

      // 회의 주제
      const r1 = document.createElement("tr");
      r1.appendChild(mkTd("회의 주제", true, { borderBottom: true }));
      r1.appendChild(mkTd(meeting.title, false, { colSpan: 3, borderBottom: true }));
      table.appendChild(r1);

      // 회의 일시 + 작성자
      const r2 = document.createElement("tr");
      r2.appendChild(mkTd("회의 일시", true, { borderBottom: true }));
      r2.appendChild(mkTd(formatDate(meeting.meeting_at), false, { borderRight: true, borderBottom: true }));
      r2.appendChild(mkTd("작성자", true, { borderBottom: true }));
      r2.appendChild(mkTd(writer, false, { borderBottom: true }));
      table.appendChild(r2);

      // 회의 장소
      const r3 = document.createElement("tr");
      r3.appendChild(mkTd("회의 장소", true, { borderBottom: true }));
      r3.appendChild(mkTd(meeting.location || "-", false, { colSpan: 3, borderBottom: true }));
      table.appendChild(r3);

      // 참석자 
      const r4 = document.createElement("tr");
      r4.appendChild(mkTd("참석자", true, { borderBottom: false }));
      r4.appendChild(mkTd(participantNames, false, { colSpan: 3, borderBottom: false }));
      table.appendChild(r4);

      card.appendChild(table);

      // 회의 내용
      const secHeader = document.createElement("div");
      secHeader.style.cssText = `padding:12px 20px; text-align:center; font-size:13px; font-weight:600; color:#141414; background:#F4F5F8; border-top:1px solid #D0D0D0; border-bottom:1px solid #D0D0D0;`;
      secHeader.textContent = "회의 내용";
      card.appendChild(secHeader);

      const docBox = document.createElement("div");
      docBox.style.cssText = `padding:16px 20px; font-size:13px; line-height:1.9; white-space:pre-wrap; color:#333; min-height:96px;`;
      docBox.textContent = meeting.meeting_document?.trim() || "회의록 내용이 없습니다.";
      card.appendChild(docBox);

      wrapper.appendChild(card);

      // 업무 카드 
      const taskCard = document.createElement("div");
      taskCard.style.cssText = `border:1px solid #D0D0D0; border-radius:12px; overflow:hidden;`;

      const taskHeader = document.createElement("div");
      taskHeader.style.cssText = `padding:12px 20px; text-align:center; font-size:13px; font-weight:600; color:#141414; background:#F4F5F8; border-bottom:1px solid #D0D0D0;`;
      taskHeader.textContent = "업무 내용";
      taskCard.appendChild(taskHeader);

      // 컬럼 헤더
      const taskColHeader = document.createElement("div");
      taskColHeader.style.cssText = `display:grid; grid-template-columns:1fr 120px 130px 100px; padding:12px 20px; font-size:12px; font-weight:700; color:#555; background:#FAFAFA; border-bottom:1px solid #D0D0D0;`;
      ["업무명", "담당자", "기한", "우선순위"].forEach((label, i) => {
        const span = document.createElement("span");
        span.textContent = label;
        if (i > 0) span.style.textAlign = "center";
        taskColHeader.appendChild(span);
      });
      taskCard.appendChild(taskColHeader);

      if (tasks.length === 0) {
        const emptyRow = document.createElement("div");
        emptyRow.style.cssText = `padding:18px 20px; font-size:13px; color:#666; text-align:center;`;
        emptyRow.textContent = "등록된 업무가 없습니다.";
        taskCard.appendChild(emptyRow);
      }

      tasks.forEach((t) => {
        // 업무 메인 행
        const row = document.createElement("div");
        row.style.cssText = `display:grid; grid-template-columns:1fr 120px 130px 100px; padding:14px 20px; font-size:13px; align-items:center; border-bottom:1px solid #D0D0D0;`;

        const nameSpan = document.createElement("span"); nameSpan.textContent = t.title; nameSpan.style.cssText = "color:#141414; font-weight:600;";
        const ownerSpan = document.createElement("span"); ownerSpan.textContent = t.owner || "-"; ownerSpan.style.cssText = "text-align:center; color:#555;";
        const dateSpan = document.createElement("span"); dateSpan.textContent = t.due_date || "-"; dateSpan.style.cssText = "text-align:center; color:#555;";
        const prioSpan = document.createElement("span"); prioSpan.textContent = PRIORITY_LABEL[t.priority] || t.priority || "-"; prioSpan.style.cssText = "text-align:center; color:#555;";

        row.appendChild(nameSpan); row.appendChild(ownerSpan); row.appendChild(dateSpan); row.appendChild(prioSpan);
        taskCard.appendChild(row);

        // 업무 상세 설명
        if (t.content) {
          const contentRow = document.createElement("div");
          contentRow.style.cssText = `padding:12px 20px 12px 36px; font-size:12px; color:#666; line-height:1.7; background:#F8F8F8; border-bottom:1px solid #D0D0D0;`;
          contentRow.textContent = `내용: ${t.content}`;
          taskCard.appendChild(contentRow);
        }
      });

      wrapper.appendChild(taskCard);
      document.body.appendChild(wrapper);

      const canvas = await html2canvas(wrapper, {
        scale: 2, useCORS: true, backgroundColor: "#ffffff",
        windowWidth: W, scrollX: 0, scrollY: 0,
      });
      document.body.removeChild(wrapper);

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "p", unit: "mm", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const imgH = (canvas.height * pageW) / canvas.width;
      let y = 0;
      let remainingH = imgH;

      pdf.addImage(imgData, "PNG", 0, y, pageW, imgH);
      remainingH -= pageH;

      while (remainingH > 0) {
        y -= pageH;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, y, pageW, imgH);
        remainingH -= pageH;
      }

      const safeTitle = (meeting.title || "회의")
        .replace(/[\\/:*?"<>|]/g, "_")
        .trim();
      pdf.save(`${safeTitle || "회의"}_회의록.pdf`);
    } catch {
      alert("PDF 생성에 실패했습니다.");
    } finally {
      setDownloading(false);
    }
  };

  const handleEmailSend = async () => {
    if (emailSending) return;
    setEmailSending(true);
    try {
      await sendMeetingSummaryEmail(meetingId, recipients.map(recipient => recipient.user_id));
      setEmailSending(false);
      setEmailSent(true);
    } catch (error) {
      console.error("요약 이메일 발송 실패:", error);
      setEmailSending(false);
      const message =
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
        "요약 이메일 발송에 실패했습니다. 이메일 발송 설정 또는 수신자 정보를 확인해주세요.";
      alert(message);
    }
  };

  const removeRecipient = (userId: number) => {
    setRecipients(prev => prev.filter(recipient => recipient.user_id !== userId));
  };

  const addRecipient = (participant: NonNullable<Meeting["participants"]>[number]) => {
    setRecipients(prev => {
      if (prev.some(recipient => recipient.user_id === participant.user_id)) return prev;
      return [...prev, participant];
    });
    setEmailRecipientQuery("");
  };

  return (
    <div className="max-w-6xl mx-auto w-full py-10 px-6">
      <h2 className="text-[22px] font-medium mb-6" style={{ color: "#141414" }}>
        {meeting.title}
      </h2>

      {/* 탭 바 */}
      <div className="flex border-b mb-6" style={{ borderColor: "#E6E1E6" }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className="px-5 py-2.5 text-[14px] font-medium transition-colors"
            style={{
              color: tab === t.key ? "#6A1FEB" : "#969696",
              borderBottom: tab === t.key ? "2px solid #6A1FEB" : "2px solid transparent",
              marginBottom: "-1px",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 회의록 탭  */}
      {tab === "minutes" && (
        <div>
          <div className="flex justify-end mb-4">
            <button
              onClick={handlePdfDownload}
              disabled={downloading}
              className="px-5 py-2 text-[13px] text-white rounded-lg bg-[#6A1FEB] transition-colors duration-150 hover:bg-[#5635A8] active:bg-[#4B2F93] disabled:cursor-not-allowed disabled:bg-[#969696] disabled:opacity-60"
            >
              {downloading ? "생성 중..." : "PDF 다운로드"}
            </button>
          </div>

          {/* 회의록 카드 */}
          <div className="rounded-xl border mb-6" style={{ borderColor: "#E6E1E6" }}>
            <div className="px-6 py-4 border-b" style={{ borderColor: "#E6E1E6" }}>
              <span className="text-[15px] font-medium" style={{ color: "#141414" }}>회의록</span>
            </div>

            <table className="w-full text-[13px]" style={{ borderCollapse: "collapse" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid #E6E1E6" }}>
                  <td className="px-5 py-3 font-medium whitespace-nowrap" style={{ color: "#555", backgroundColor: "#FAFAFA", width: "110px", borderRight: "1px solid #E6E1E6" }}>
                    회의 주제
                  </td>
                  <td className="px-5 py-3" style={{ color: "#141414" }} colSpan={3}>
                    {meeting.title}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #E6E1E6" }}>
                  <td className="px-5 py-3 font-medium whitespace-nowrap" style={{ color: "#555", backgroundColor: "#FAFAFA", borderRight: "1px solid #E6E1E6" }}>
                    회의 일시
                  </td>
                  <td className="px-5 py-3" style={{ color: "#141414", borderRight: "1px solid #E6E1E6" }}>
                    {formatDate(meeting.meeting_at)}
                  </td>
                  <td className="px-5 py-3 font-medium whitespace-nowrap" style={{ color: "#555", backgroundColor: "#FAFAFA", width: "80px", borderRight: "1px solid #E6E1E6" }}>
                    작성자
                  </td>
                  <td className="px-5 py-3" style={{ color: "#141414" }}>
                    {writer}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid #E6E1E6" }}>
                  <td className="px-5 py-3 font-medium whitespace-nowrap" style={{ color: "#555", backgroundColor: "#FAFAFA", borderRight: "1px solid #E6E1E6" }}>
                    회의 장소
                  </td>
                  <td className="px-5 py-3" style={{ color: "#141414" }} colSpan={3}>
                    {meeting.location || "-"}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 font-medium whitespace-nowrap" style={{ color: "#555", backgroundColor: "#FAFAFA", borderRight: "1px solid #E6E1E6" }}>
                    참석자
                  </td>
                  <td className="px-5 py-3" style={{ color: "#141414" }} colSpan={3}>
                    {participantNames}
                  </td>
                </tr>
              </tbody>
            </table>

            {meeting.meeting_document && (
              <>
                <div className="px-5 py-3 text-center text-[13px] font-semibold" style={{ backgroundColor: "#F4F5F8", color: "#141414", borderTop: "1px solid #E6E1E6", borderBottom: "1px solid #E6E1E6" }}>
                  회의 내용
                </div>
                <div className="px-6 py-5">
                  <div className="rounded-lg px-5 py-4 text-[13px] whitespace-pre-line leading-relaxed" style={{ backgroundColor: "#F9F9FB", color: "#333" }}>
                    {meeting.meeting_document}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* 업무 카드 */}
          <div className="rounded-xl border" style={{ borderColor: "#E6E1E6" }}>
            <div className="px-5 py-3 text-center text-[13px] font-semibold rounded-t-xl" style={{ backgroundColor: "#F4F5F8", color: "#141414", borderBottom: "1px solid #E6E1E6" }}>
              업무
            </div>
            {/* 헤더 */}
            <div className="grid text-[12px] font-semibold px-5 py-2.5" style={{ gridTemplateColumns: "1fr 72px 120px 130px 100px", color: "#555", borderBottom: "1px solid #E6E1E6", backgroundColor: "#FAFAFA" }}>
              <span>업무명</span>
              <span aria-hidden="true" />
              <span className="text-center">담당자</span>
              <span className="text-center">기한</span>
              <span className="text-center">우선순위</span>
            </div>

            {tasks.map((task, idx) => (
              <div key={task.meeting_task_id} style={{ borderBottom: idx < tasks.length - 1 ? "1px solid #E6E1E6" : "none" }}>
                <div className="grid items-center px-5 py-3" style={{ gridTemplateColumns: "1fr 72px 120px 130px 100px" }}>
                  <span style={{ fontSize: "13px", color: "#141414" }}>{task.title}</span>
                  <button
                    onClick={() => toggleExpand(task.meeting_task_id)}
                    style={{ color: "#6A1FEB", fontSize: "12px", fontWeight: 600, whiteSpace: "nowrap", justifySelf: "center" }}
                  >
                    {expandedIds.has(task.meeting_task_id) ? "접기 ▲" : "펼치기 ▼"}
                  </button>
                  <span className="text-center text-[13px]" style={{ color: "#555" }}>{task.owner}</span>
                  <span className="text-center text-[13px]" style={{ color: "#555" }}>{task.due_date || "-"}</span>
                  <span className="text-center text-[13px]" style={{ color: "#555" }}>{PRIORITY_LABEL[task.priority] || task.priority}</span>
                </div>
                {expandedIds.has(task.meeting_task_id) && task.content && (
                  <div className="px-5 pb-3">
                    <div className="rounded-lg px-4 py-3 text-[13px] leading-relaxed" style={{ backgroundColor: "#F4F5F8", color: "#555" }}>
                      {task.content}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 녹음 원문 탭 */}
      {tab === "record" && (
        <div className="rounded-xl border" style={{ borderColor: "#E6E1E6" }}>
          <div className="px-6 py-4 border-b font-medium text-[15px]" style={{ borderColor: "#E6E1E6", color: "#141414" }}>
            녹음 원문
          </div>
          <div className="px-6 py-5 flex flex-col gap-4">
            {transcript.length === 0 ? (
              <p className="text-center text-[13px] py-10" style={{ color: "#969696" }}>녹음 원문이 없습니다.</p>
            ) : (
              transcript.map((item) => (
                <div key={item.utterance_id} className="flex gap-3">
                  <span className="text-[12px] font-medium whitespace-nowrap mt-0.5" style={{ color: "#969696", minWidth: "52px" }}>
                    {item.time}
                  </span>
                  <div className="flex-1">
                    <span className="text-[12px] font-semibold" style={{ color: "#6A1FEB" }}>
                      {item.meeting_user_name || item.speaker}
                    </span>
                    <div className="mt-1 rounded-lg px-4 py-3 text-[13px] leading-relaxed" style={{ backgroundColor: "#F9F9FB", color: "#333" }}>
                      {item.content}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* 회의 자료 탭 */}
      {tab === "material" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-[13px]" style={{ color: "#969696" }}></p>
            <button
              onClick={async () => {
                if (!hasMeetingMaterial) return;

                const wrapper = document.createElement("div");
                wrapper.style.cssText = `position:absolute;top:-9999px;left:-9999px;width:700px;background:#fff;padding:48px;font-family:'Malgun Gothic','Apple SD Gothic Neo',sans-serif;box-sizing:border-box;color:#111;`;
                const titleEl = document.createElement("div");
                titleEl.style.cssText = `text-align:center;font-size:17px;font-weight:700;margin-bottom:24px;`;
                titleEl.textContent = "회의 준비 자료";
                wrapper.appendChild(titleEl);
                const agendaEl = document.createElement("div");
                agendaEl.style.cssText = `margin-bottom:20px;font-size:13px;line-height:1.9;`;
                agendaEl.innerHTML = `<b>기초안건</b><br/>${agenda.length ? agenda.map((a,i) => `${i+1}. ${a.content}`).join("<br/>") : EMPTY_MATERIAL_TEXT}`;
                wrapper.appendChild(agendaEl);
                [
                  { label: "회의 목적", value: prep?.purpose },
                  { label: "프로젝트 현재 상태", value: prep?.project_status },
                  { label: "관련 규정 및 제약사항", value: prep?.rule },
                  { label: "회의 종료 후 기대 결과", value: prep?.effect },
                ].forEach(s => {
                  const sec = document.createElement("div");
                  sec.style.cssText = `margin-bottom:16px;font-size:13px;line-height:1.9;`;
                  sec.innerHTML = `<b>${s.label}</b><br/><span style="white-space:pre-wrap">${s.value || EMPTY_MATERIAL_TEXT}</span>`;
                  wrapper.appendChild(sec);
                });
                document.body.appendChild(wrapper);
                const canvas = await html2canvas(wrapper, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
                document.body.removeChild(wrapper);
                const imgData = canvas.toDataURL("image/png");
                const pageW = 210;
                const pageH = Math.ceil(canvas.height * pageW / canvas.width);
                const pdf = new jsPDF({ orientation: "p", unit: "mm", format: [pageW, pageH] });
                pdf.addImage(imgData, "PNG", 0, 0, pageW, pageH);
                pdf.save("회의_준비_자료.pdf");
              }}
              disabled={!hasMeetingMaterial}
              className={`px-5 py-2 text-[13px] text-white rounded-lg transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${
                hasMeetingMaterial
                  ? "bg-[#6A1FEB] hover:bg-[#5635A8] active:bg-[#4B2F93]"
                  : "bg-[#969696]"
              }`}
            >
              PDF 다운로드
            </button>
          </div>

          {/* 기초안건 */}
          <div className="mb-5">
            <p className="text-[14px] font-medium mb-2" style={{ color: "#141414" }}>기초 안건</p>
            <div className="border rounded-xl px-5 py-4 text-[13px] whitespace-pre-line leading-relaxed" style={{ borderColor: "#E6E1E6", color: "#333" }}>
              {agenda.length === 0 ? (
                <p style={{ color: "#969696" }}>{EMPTY_MATERIAL_TEXT}</p>
              ) : (
                agenda.map((a, i) => (
                  <p key={a.agenda_id ?? i} className="leading-relaxed">{i + 1}. {a.content}</p>
                ))
              )}
            </div>
          </div>

          {/* 준비자료 섹션들 */}
          <div className="space-y-5">
            {[
              { label: "회의 목적", value: prep?.purpose },
              { label: "프로젝트 현재 상태", value: prep?.project_status },
              { label: "관련 규정 및 제약사항", value: prep?.rule },
              { label: "회의 종료 후 기대 결과", value: prep?.effect },
            ].map(section => (
              <div key={section.label}>
                <p className="text-[14px] font-medium mb-2" style={{ color: "#141414" }}>{section.label}</p>
                <div className="border rounded-xl px-5 py-4 text-[13px] whitespace-pre-line leading-relaxed" style={{ borderColor: "#E6E1E6", color: "#333" }}>
                  {section.value ? (
                    section.value
                  ) : (
                    <span style={{ color: "#969696" }}>{EMPTY_MATERIAL_TEXT}</span>
                  )}
                </div>
              </div>
            ))}

            <div>
              <p className="text-[14px] font-medium mb-2" style={{ color: "#141414" }}>참고 자료</p>
              <div className="border rounded-xl px-5 py-3 space-y-1" style={{ borderColor: "#E6E1E6" }}>
                {prep?.sources?.length ? (
                  prep.sources.map((src, i) => (
                    <p key={i} className="text-[13px]">
                      <span style={{ color: "#141414" }}>- {src.title} </span>
                      <a href={src.file_url} target="_blank" rel="noreferrer" className="cursor-pointer hover:underline" style={{ color: "#6A1FEB" }}>더보기</a>
                    </p>
                  ))
                ) : (
                  <p className="text-[13px]" style={{ color: "#969696" }}>{EMPTY_MATERIAL_TEXT}</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 이메일 발송 탭 */}
      {tab === "email" && (
        <div>
          <p className="text-[13px] mb-4" style={{ color: "#969696" }}>요약 이메일입니다.</p>

          {emailSent && (
            <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg text-[13px] font-medium" style={{ backgroundColor: "#F2F0FF", color: "#6A1FEB" }}>
              메일이 발송되었습니다.
            </div>
          )}
          <>
              <div className="flex gap-5">
                {/* 왼쪽: 회의 정보 */}
                <div className="flex-1 flex flex-col gap-4">
                  {/* 회의 제목 */}
                  <div className="rounded-xl border p-5" style={{ borderColor: "#E6E1E6" }}>
                    <p className="text-[12px] mb-1" style={{ color: "#969696" }}>회의 제목(수정 불가)</p>
                    <p className="text-[14px] font-medium" style={{ color: "#141414" }}>{meeting.title}</p>
                  </div>

                  {/* 회의 정보 */}
                  <div className="rounded-xl border" style={{ borderColor: "#E6E1E6" }}>
                    <p className="px-5 pt-4 pb-2 text-[13px] font-medium" style={{ color: "#141414" }}>회의 정보</p>
                    <div className="px-5 pb-4 flex flex-col gap-2 text-[13px]">
                      <div className="flex gap-3">
                        <span style={{ color: "#969696", minWidth: "70px" }}>회의 일시</span>
                        <span style={{ color: "#141414" }}>{formatDate(meeting.meeting_at)}</span>
                      </div>
                      <div className="flex gap-3">
                        <span style={{ color: "#969696", minWidth: "70px" }}>회의 참석자</span>
                        <span style={{ color: "#141414" }}>{participantNames}</span>
                      </div>
                    </div>
                  </div>

                  {/* 부여된 태스크 */}
                  <div className="rounded-xl border" style={{ borderColor: "#E6E1E6" }}>
                    <p className="px-5 pt-4 pb-2 text-[13px] font-medium" style={{ color: "#141414" }}>부여된 태스크</p>
                    <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
                      <thead>
                        <tr style={{ backgroundColor: "#F4F5F8", borderTop: "1px solid #E6E1E6", borderBottom: "1px solid #E6E1E6" }}>
                          <th className="px-4 py-2.5 text-left font-medium" style={{ color: "#555" }}>태스크</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap" style={{ color: "#555", width: "80px" }}>담당자</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap" style={{ color: "#555", width: "100px" }}>기한</th>
                          <th className="px-4 py-2.5 text-left font-medium whitespace-nowrap" style={{ color: "#555", width: "70px" }}>우선순위</th>
                        </tr>
                      </thead>
                      <tbody>
                        {tasks.map((task, idx) => (
                          <tr key={task.meeting_task_id} style={{ borderBottom: idx < tasks.length - 1 ? "1px solid #E6E1E6" : "none" }}>
                            <td className="px-4 py-3" style={{ color: "#141414" }}>{task.title}</td>
                            <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#555" }}>{task.owner || "미배정"}</td>
                            <td className="px-4 py-3 whitespace-nowrap" style={{ color: "#555" }}>{task.due_date || "-"}</td>
                            <td className="px-4 py-3 whitespace-nowrap">
                              <span className="px-2 py-0.5 rounded-full text-[11px]" style={{ backgroundColor: "#F2F0FF", color: "#6A1FEB" }}>
                                {PRIORITY_LABEL[task.priority] || task.priority}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* 이메일 수신자 */}
                  <div className="rounded-xl border p-4" style={{ borderColor: "#E6E1E6" }}>
                    <p className="text-[13px] font-medium mb-3" style={{ color: "#141414" }}>이메일 수신자</p>
                    <div className="rounded-xl border bg-white p-3" style={{ borderColor: "#E6E1E6" }}>
                      <div className="flex flex-wrap items-center gap-2">
                        {recipients.map(r => (
                          <span
                            key={r.user_id}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[12px]"
                            style={{ backgroundColor: "#F4F5F8", color: "#141414", border: "1px solid #E6E1E6" }}
                          >
                            {r.name}
                            <button
                              type="button"
                              onClick={() => removeRecipient(r.user_id)}
                              aria-label={`${r.name} 수신자 제거`}
                              className="text-[14px] leading-none"
                              style={{ color: "#969696" }}
                            >
                              ×
                            </button>
                          </span>
                        ))}
                        <input
                          value={emailRecipientQuery}
                          onChange={e => setEmailRecipientQuery(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === "Backspace" && emailRecipientQuery.length === 0 && recipients.length > 0) {
                              e.preventDefault();
                              removeRecipient(recipients[recipients.length - 1].user_id);
                              return;
                            }
                            if (e.key === "Enter" && matchingRecipients[0]) {
                              e.preventDefault();
                              addRecipient(matchingRecipients[0]);
                            }
                          }}
                          placeholder={recipients.length === 0 ? "이름이나 이메일, 직무를 입력해주세요" : ""}
                          className="h-8 min-w-[180px] flex-1 border-0 bg-transparent text-[13px] text-[#141414] outline-none placeholder:text-[#969696]"
                        />
                      </div>
                    </div>
                    {normalizedRecipientQuery && (
                      <div className="mt-2 overflow-hidden rounded-xl border" style={{ borderColor: "#E6E1E6" }}>
                        {matchingRecipients.length > 0 ? (
                          matchingRecipients.map(participant => (
                            <button
                              key={participant.user_id}
                              type="button"
                              onClick={() => addRecipient(participant)}
                              className="block w-full border-b px-4 py-3 text-left last:border-b-0 hover:bg-gray-50"
                              style={{ borderColor: "#E6E1E6" }}
                            >
                              <p className="text-[13px] font-medium" style={{ color: "#141414" }}>
                                {participant.name}{participant.email ? ` (${participant.email})` : ""}
                              </p>
                              {participant.work && (
                                <p className="mt-0.5 text-[12px]" style={{ color: "#969696" }}>{participant.work}</p>
                              )}
                            </button>
                          ))
                        ) : (
                          <p className="px-4 py-3 text-[12px]" style={{ color: "#969696" }}>검색 결과가 없습니다.</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* 이메일 미리보기 */}
                <div className="w-[440px] flex-shrink-0">
                  <p className="text-[14px] font-medium mb-3" style={{ color: "#141414" }}>이메일 미리보기</p>
                  <div className="rounded-xl border px-6 py-5 text-[13px] leading-relaxed" style={{ borderColor: "#E6E1E6", color: "#333" }}>
                    <p className="mb-4">안녕하세요, OOO.</p>
                    <p className="mb-4">회의록이 확정되었습니다. 아래 태스크가 회원님께 부여되었으니 기한 내에 처리해 주세요.</p>
                    <p className="font-medium mb-1">[회의 정보]</p>
                    <p>• 회의 제목: {meeting.title}</p>
                    <p className="mb-4">• 회의 일시: {formatDate(meeting.meeting_at)}</p>
                    <p className="font-medium mb-1">[부여된 태스크]</p>
                    {tasks.map((task, i) => (
                      <p key={task.meeting_task_id}>
                        {i + 1}. {task.title} (담당자: {task.owner}, 기한: {task.due_date || "-"}, 우선순위: {PRIORITY_LABEL[task.priority] || task.priority})
                      </p>
                    ))}
                    <p className="mt-4">프로젝트에서 더 자세한 내용을 확인하실 수 있습니다.</p>
                    <p>감사합니다.</p>
                  </div>
                </div>
              </div>

              {/* 발송 버튼 */}
              <div className="flex justify-end mt-5">
                <button
                  onClick={() => setShowEmailConfirmModal(true)}
                  disabled={emailSending || recipients.length === 0}
                  className="px-8 py-3 text-[14px] text-white rounded-lg font-semibold disabled:opacity-50"
                  style={{ backgroundColor: "#6A1FEB" }}
                >
                  {emailSending ? "발송 중..." : "이메일 발송"}
                </button>
              </div>
          </>

          {/* 이메일 발송 확인 모달 */}
          {showEmailConfirmModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
              <div className="bg-white rounded-2xl w-80 overflow-hidden shadow-xl">
                <div className="px-8 py-10 text-center">
                  <p className="text-[15px] font-semibold text-[#141414] mb-2">이메일을 발송하시겠습니까?</p>
                  <p className="text-[12px] text-[#969696]">참석자들에게 회의 요약 이메일이 전송됩니다.</p>
                </div>
                <div className="border-t border-gray-200 flex">
                  <button
                    onClick={() => setShowEmailConfirmModal(false)}
                    className="flex-1 py-4 text-sm text-[#141414] hover:bg-gray-50 transition border-r border-gray-200"
                  >
                    취소
                  </button>
                  <button
                    onClick={() => { setShowEmailConfirmModal(false); handleEmailSend(); }}
                    className="flex-1 py-4 text-sm font-medium text-[#6A1FEB] hover:bg-gray-50 transition"
                  >
                    확인
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
