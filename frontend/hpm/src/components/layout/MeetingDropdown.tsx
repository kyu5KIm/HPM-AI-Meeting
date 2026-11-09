import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/meeting";
import * as DESIGN from "../../constants/design";
import meeting from "../../assets/sidebar/meeting.png";
import arrow from "../../assets/sidebar/arrow.png";
import plus from "../../assets/sidebar/plus.png";

interface RecentMeeting {
  meeting_id: number;
  title: string;
  status: string;
}

interface MeetingDropdownProps {
  isCollapsed: boolean;
  toggleCollapse: () => void;
}

export default function MeetingDropdown({ isCollapsed, toggleCollapse }: MeetingDropdownProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const { projectId } = useAuth();
  
  const [meetingOpen, setMeetingOpen] = useState(true);
  const [recentMeetings, setRecentMeetings] = useState<RecentMeeting[]>([]);
  const [isHovered, setIsHovered] = useState(false);
  const [recentMeetingsProjectId, setRecentMeetingsProjectId] = useState(projectId);

  // 프로젝트 선택이 풀리면 렌더 중에 최근 회의 목록을 비운다.
  if (recentMeetingsProjectId !== projectId) {
    setRecentMeetingsProjectId(projectId);
    if (!projectId) setRecentMeetings([]);
  }

  useEffect(() => {
    if (!projectId) return;
    api.get(`/meetings/?project_id=${projectId}`).then(res => {
      const data = Array.isArray(res.data) ? res.data : [];
      setRecentMeetings(data.slice(0, 4));
    }).catch(() => {});
  }, [projectId]);

  const isActive = (path: string) => location.pathname.startsWith(path);
  const isMeetingSelected = (meetingId: number) =>
    location.pathname === `/meetings/${meetingId}` ||
    location.pathname === `/meetings/${meetingId}/minutes` ||
    location.pathname === `/meetings/${meetingId}/archive`;

  const showArrow = meetingOpen || isHovered;

  // Collapsed View
  if (isCollapsed) {
    const active = isActive("/meeting") || isActive("/meetings");
    return (
      <button
        onClick={toggleCollapse}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        title="회의 목록"
        className={`w-10 h-10 mx-auto flex justify-center items-center rounded-lg transition ${DESIGN.COLORS.white} ${
          active ? DESIGN.BACKGROUND_COLORS.purple : `bg-transparent ${DESIGN.BACKGROUND_COLORS.purpleHoverState}`
        }`}
      >
        <span>
          {isHovered ? (
            <img src={arrow} alt="" className="rotate-90" />
          ) : (
            <img src={meeting} alt="" />
          )}
        </span>
      </button>
    );
  }

  // Expanded View
  return (
    <>
      <button
        onClick={() => setMeetingOpen(v => !v)}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        className={`flex items-center justify-between w-full ${DESIGN.PADDING_SIZES.sm} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.lg} transition ${DESIGN.COLORS.white} ${
          isActive("/meeting") || isActive("/meetings")
            ? DESIGN.BACKGROUND_COLORS.purple
            : `bg-transparent ${DESIGN.BACKGROUND_COLORS.purpleHoverState}`
        }`}
      >
        <div className={`flex items-center ${DESIGN.GAP_SIZES.sm}`}>
          <span>
            {showArrow ? (
              <img
                src={arrow}
                alt=""
                className={`w-4 h-4 transition-transform duration-200 ${
                  meetingOpen ? "rotate-180" : "rotate-90"
                }`}
              />
            ) : (
              <img src={meeting} alt="" className="w-4 h-4" />
            )}
          </span>
          <span onClick={(e) => { e.stopPropagation(); navigate("/meetings"); }} className="cursor-pointer">회의 목록</span>
        </div>
        <div className="flex items-center gap-1">
          <span
            onClick={e => {
              e.stopPropagation();
              navigate("/meetings/create");
            }}
            title="회의 추가"
            className="flex items-center justify-center transition"
          >
            <img src={plus} alt="추가" className="w-3" />
          </span>
        </div>
      </button>

      {meetingOpen && (
        <div className="flex flex-col">
          <p className={`${DESIGN.FONT_SIZES.md} text-gray-500 px-3 py-1 mb-[2px]`}>최신순</p>
          {recentMeetings.map(m => (
            <button
              key={m.meeting_id}
              onClick={() => {
                if (m.status !== "scheduled" && m.status !== "in_progress") {
                  navigate(`/meetings/${m.meeting_id}/archive`);
                } else {
                  navigate(`/meetings/${m.meeting_id}`);
                }
              }}
              className={`flex items-center justify-between text-left px-3 py-1.5 ${DESIGN.RADIUS_SIZES.md} ${
                DESIGN.FONT_SIZES.md
              } transition group ${DESIGN.COLORS.white} ${
                isMeetingSelected(m.meeting_id)
                  ? `${DESIGN.BACKGROUND_COLORS.purpleHover}`
                  : "bg-transparent opacity-80 hover:opacity-100 hover:bg-white/5"
              }`}
            >
              <span className="truncate max-w-[110px]">{m.title}</span>
            </button>
          ))}
          <button
            onClick={() => navigate("/meetings")}
            className={`text-left px-3 py-[10px] ${DESIGN.FONT_SIZES.md} transition hover:underline ${DESIGN.COLORS.purpleLight}`}
          >
            전체보기 &rsaquo;
          </button>
        </div>
      )}
    </>
  );
}
