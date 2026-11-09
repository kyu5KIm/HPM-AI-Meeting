import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import logo from "../../assets/sidebar/logo.png";
import dashboard from "../../assets/sidebar/dashboard.png";
import document from "../../assets/sidebar/document.png";
import member from "../../assets/sidebar/member.png";
import closeIcon from "../../assets/sidebar/close.png";
import hamburgerIcon from "../../assets/sidebar/hamburger.png";
import * as DESIGN from "../../constants/design";
import ProjectDropdown from "./ProjectDropdown";
import MeetingDropdown from "./MeetingDropdown";
import { useRecording } from "../../context/RecordingContext";
import { getMeetingDetail } from "../../services/meeting";

interface SidebarProps {
  isCollapsed: boolean;
  toggleCollapse: () => void;
}

export default function Sidebar({ isCollapsed, toggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const {
    meetingId: recMeetingId,
    startTime,
    isPaused,
    pausedElapsed,
    startRecording,
    stopRecording,
    pauseRecording,
  } = useRecording();
  const isRecording = recMeetingId !== null && (startTime !== null || pausedElapsed !== null);

  const [tickElapsed, setTickElapsed] = useState(() =>
    startTime !== null ? Math.floor((Date.now() - startTime) / 1000) : 0
  );

  // 녹음 중이 아니거나 일시정지 상태면 시간이 고정되므로 렌더 중에 바로 맞춘다.
  const frozenElapsed = !isRecording
    ? 0
    : isPaused && pausedElapsed !== null
      ? pausedElapsed
      : null;
  if (frozenElapsed !== null && tickElapsed !== frozenElapsed) {
    setTickElapsed(frozenElapsed);
  }
  const elapsed = frozenElapsed ?? tickElapsed;

  useEffect(() => {
    if (frozenElapsed !== null || startTime === null) return;
    const update = () => setTickElapsed(Math.floor((Date.now() - startTime) / 1000));
    const timeoutId = setTimeout(update, 0);
    const intervalId = setInterval(update, 1000);
    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [frozenElapsed, startTime]);

  useEffect(() => {
    if (recMeetingId === null) return;

    const syncMeetingTimer = async () => {
      try {
        const data = await getMeetingDetail(recMeetingId);
        if (!data || data.status !== "in_progress") {
          stopRecording();
          return;
        }

        const serverElapsed = data.elapsed_seconds ?? 0;
        if (data.is_paused) {
          pauseRecording(serverElapsed);
          return;
        }

        if (isPaused) {
          startRecording(recMeetingId, serverElapsed);
          return;
        }

        if (startTime !== null) {
          const localElapsed = Math.floor((Date.now() - startTime) / 1000);
          if (Math.abs(serverElapsed - localElapsed) > 3) {
            startRecording(recMeetingId, serverElapsed);
          }
        }
      } catch (error) {
        console.error("회의 타이머 동기화 실패:", error);
      }
    };

    void syncMeetingTimer();
    const id = setInterval(syncMeetingTimer, 3000);
    return () => clearInterval(id);
  }, [recMeetingId, isPaused, startTime, startRecording, stopRecording, pauseRecording]);

  const fmt = (s: number) =>
    `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const isActive = (path: string) => location.pathname.startsWith(path);
  const isOnMeetingPage = recMeetingId !== null && location.pathname === `/meetings/${recMeetingId}`;
  const [timerHovered, setTimerHovered] = useState(false);
  const [timerHoverPathname, setTimerHoverPathname] = useState(location.pathname);

  // 페이지를 옮기면 타이머 hover 상태를 해제한다.
  if (timerHoverPathname !== location.pathname) {
    setTimerHoverPathname(location.pathname);
    setTimerHovered(false);
  }

  return (
    <aside
      className={`fixed left-0 top-0 h-screen ${
        isCollapsed ? "w-[54px]" : "w-[256px]"
      } ${DESIGN.BACKGROUND_COLORS.black} flex flex-col z-50 ${DESIGN.COLORS.white} transition-all duration-300`}
    >
      {/* 로고 및 상단 헤더 영역 */}
      {isCollapsed ? (
        <div className="flex justify-center items-center mt-[20px] mb-8">
          <button
            onClick={toggleCollapse}
            className="p-1 hover:bg-white/10 rounded transition"
          >
            <img src={hamburgerIcon} alt="열기" className="w-5" />
          </button>
        </div>
      ) : (
        <div className="relative flex flex-col items-center justify-center mt-[20px] mb-8">
          <img
            src={logo}
            alt="logo"
            className="cursor-pointer w-[75px]"
            onClick={() => navigate("/dashboard")}
          />
          <p onClick={() => navigate("/dashboard")} className={`${DESIGN.FONT_SIZES.lg} mt-1`}>회의피하지마</p>
          <button
            onClick={toggleCollapse}
            className="absolute top-1 right-3 p-1 hover:bg-white/10 rounded transition"
          >
            <img src={closeIcon} alt="닫기" className="w-5" />
          </button>
        </div>
      )}

      {/* 네비게이션 */}
      {!isCollapsed && (
        <nav
          className={`flex-1 flex flex-col py-3 px-[10px] overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${DESIGN.GAP_SIZES.lg} transition-all duration-300`}
        >
          <ProjectDropdown isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} />

          {/* 대시보드 */}
          <button
            onClick={() => navigate("/dashboard")}
            className={`flex items-center ${DESIGN.GAP_SIZES.sm} ${DESIGN.PADDING_SIZES.sm} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.lg} w-full text-left transition ${DESIGN.COLORS.white} ${
              isActive("/dashboard")
                ? `${DESIGN.BACKGROUND_COLORS.purple}`
                : `bg-transparent ${DESIGN.BACKGROUND_COLORS.purpleHoverState}`
            }`}
          >
            <span>
              <img src={dashboard} alt="" className="h-[18px] w-[18px] object-contain" />
            </span>
            <span>대시보드</span>
          </button>

          <MeetingDropdown isCollapsed={isCollapsed} toggleCollapse={toggleCollapse} />

          {/* 문서 관리 */}
          <button
            onClick={() => navigate("/documents")}
            className={`flex items-center ${DESIGN.GAP_SIZES.sm} ${DESIGN.PADDING_SIZES.sm} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.lg} w-full text-left transition ${DESIGN.COLORS.white} ${
              isActive("/documents")
                ? `${DESIGN.BACKGROUND_COLORS.purple}`
                : `bg-transparent ${DESIGN.BACKGROUND_COLORS.purpleHoverState}`
            }`}
          >
            <span>
              <img src={document} alt="" />
            </span>
            <span>문서 관리</span>
          </button>

          {/* 구성원 관리 */}
          <button
            onClick={() => navigate("/members")}
            className={`flex items-center ${DESIGN.GAP_SIZES.sm} ${DESIGN.PADDING_SIZES.sm} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.lg} w-full text-left transition ${DESIGN.COLORS.white} ${
              isActive("/members")
                ? `${DESIGN.BACKGROUND_COLORS.purple}`
                : `bg-transparent ${DESIGN.BACKGROUND_COLORS.purpleHoverState}`
            }`}
          >
            <span>
              <img src={member} alt="" />
            </span>
            <span>구성원 관리</span>
          </button>
        </nav>
      )}

      {/* 녹음 중 타이머 */}
      {isRecording && !isCollapsed && !isOnMeetingPage && (
        <button
          onClick={() => navigate(`/meetings/${recMeetingId}`)}
          onMouseEnter={() => setTimerHovered(true)}
          onMouseLeave={() => setTimerHovered(false)}
          className="w-full flex justify-center bg-transparent border-none cursor-pointer"
          style={{ padding: "0 16px 20px" }}
        >
          <span
            className="font-bold tabular-nums transition-colors duration-200"
            style={{ color: timerHovered ? "#6A1FEB" : "#ffffff", fontSize: "28px", letterSpacing: "0.04em" }}
          >
            {fmt(elapsed)}
          </span>
        </button>
      )}
    </aside>
  );
}
