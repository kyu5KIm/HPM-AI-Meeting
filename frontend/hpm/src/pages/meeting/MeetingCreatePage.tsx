import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { createMeeting, getProjectDetail } from "../../services/meeting";
import { useAuth } from "../../context/AuthContext";
import * as DESIGN from "../../constants/design";
import Button from "../../components/ui/Button";

interface UserOption {
  users_id: number;
  name: string;
  email: string;
  rank_name?: string;
  dept_name?: string;
}

export default function MeetingCreatePage() {
  const navigate = useNavigate();
  const { projectId, user } = useAuth();
  
  const [users, setUsers] = useState<UserOption[]>([]);
  const [title, setTitle] = useState("");
  const [location, setLocation] = useState("");
  const [meetingDate, setMeetingDate] = useState("");
  const [meetingTime, setMeetingTime] = useState("");
  const [participants, setParticipants] = useState<number[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showJiraModal, setShowJiraModal] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!projectId) {
      setUsers([]);
      return;
    }

    getProjectDetail(projectId)
      .then(project => {
        setUsers(
          (project.members || []).map(member => ({
            users_id: member.user_id,
            name: member.name,
            email: member.email,
            rank_name: member.rank_name,
            dept_name: member.dept_name,
          })),
        );
      })
      .catch(console.error);
  }, [projectId]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const toggleParticipant = (id: number) => {
    setParticipants(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const handleCreateMeeting = async (e: React.FormEvent) => {
  e.preventDefault();

  if (!canSubmit || submitting) return;

  setSubmitting(true);

  try {
    const combinedDateTime = `${meetingDate}T${meetingTime}:00`;

    const meeting = await createMeeting({
      project_id: projectId ?? 1,
      title,
      location,
      meeting_at: combinedDateTime,
      participants,
    });

    navigate(`/meetings/${meeting.meeting_id}`, { replace: true });
  } catch (e) {
    console.error(e);

      const msg =
        (e as { response?: { data?: { error?: string } } })
          .response?.data?.error ?? "회의 생성에 실패했습니다.";

      setErrorMessage(msg);
      setShowErrorModal(true);
    } finally {
      setSubmitting(false);
    }
  };

  const filteredUsers = users.filter(
    u =>
      u.users_id !== Number(user?.users_id) &&
      u.users_id !== Number(user?.user_id) &&
      (
        u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        u.email.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  // 날짜 제약 추가
  const todayDate = new Date().toISOString().split("T")[0];
  // 시간 제약 추가
  const currentTime = new Date().toTimeString().slice(0, 5);
  const minTime = meetingDate === todayDate ? currentTime : "00:00";

  // 과거 날짜/시간 검증
  const isPastDateTime = () => {
    if (!meetingDate || !meetingTime) return false;
    const selected = new Date(`${meetingDate}T${meetingTime}`);
    return selected < new Date();
  };

  // 활성화 제약 추가
  const canSubmit = title.trim().length >= 1 && meetingDate && meetingTime && participants.length >= 1 && !isPastDateTime();

  const handleJiraLink = () => {
    const currentUserId = user?.users_id ?? user?.user_id;
    if (currentUserId) {
      window.open(`${import.meta.env.VITE_API_BASE_URL}/jira/start/`, "_blank");
    }
    setShowJiraModal(false);
  };



  return (
<div className="max-w-4xl mx-auto w-full min-h-[calc(100vh-120px)] flex flex-col justify-center items-center">

      {showErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl w-80 overflow-hidden shadow-xl">
            <div className="px-8 py-10 text-center">
              <p className="text-[#6A1FEB] text-[14px] leading-relaxed">{errorMessage}</p>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => setShowErrorModal(false)}
                className="w-full py-4 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Jira 연동 유도 */}
      {showJiraModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl w-[420px] shadow-xl overflow-hidden">
            <div className="px-10 py-10 text-center">
              <p className={`${DESIGN.COLORS.purple} ${DESIGN.FONT_SIZES.md} leading-relaxed`}>
                JIRA 연동이 되어있지 않아<br />
                회의는 정상적으로 생성되지만,<br />
                <br />
                업무 분배는 불가합니다.<br />
                연동하시려면 아래 링크를 클릭해주세요.
              </p>
              <button
                onClick={handleJiraLink}
                className="mt-5 text-[#6A1FEB] font-bold text-[15px] hover:underline"
              >
                JIRA 연동하기
              </button>
            </div>
            <div className="border-t border-gray-200">
              <button
                onClick={() => { setShowJiraModal(false); }}
                className={`w-full py-4 text-center ${DESIGN.FONT_SIZES.md} font-bold ${DESIGN.COLORS.black} hover:bg-gray-50 transition`}
              >
                확인
              </button>
            </div>
          </div>
        </div>
      )}
  <div className="mb-6 justify-center w-full ">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className={`${DESIGN.FONT_SIZES.h3} ${DESIGN.COLORS.black} font-bold`}>회의 기본 정보 입력</h1>
          <span className={`${DESIGN.FONT_SIZES.sm} text-red-500 font-medium`}>* 회의 생성 후 회의 정보는 수정 불가합니다.</span>
        </div>
        <p className={`${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray} mt-1`}>
          회의 정보를 입력하고 생성할 수 있습니다.
        </p>
      </div>

      <form onSubmit={handleCreateMeeting} className="space-y-6 w-full">
        {/* 카드 영역 */}
        <div className={`${DESIGN.BACKGROUND_COLORS.background} ${DESIGN.RADIUS_SIZES.xl} p-8`}>
          {/* 회의 주제 */}
          <div>
            <label className={`block ${DESIGN.FONT_SIZES.md} font-medium ${DESIGN.COLORS.black} mb-2`}>
              회의 주제
            </label>
            <div className="relative">
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={30}
                placeholder="회의 주제를 입력해주세요"
                className={`w-full ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.md} px-4 py-3 outline-none focus:border-[#6A1FEB] focus:ring-1 focus:ring-[#6A1FEB]/10 transition`}
                required
              />
              <p className={`text-right mt-1.5 ${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray}`}>{title.length}/30</p>
            </div>
          </div>

          {/* 회의 장소 */}
          <div>
            <label className={`block ${DESIGN.FONT_SIZES.md} font-medium ${DESIGN.COLORS.black} mb-2`}>
              회의 장소
            </label>
            <div className="relative">
              <input
                type="text"
                value={location}
                onChange={e => setLocation(e.target.value)}
                maxLength={50}
                placeholder="회의 장소를 입력해주세요"
                className={`w-full ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.md} px-4 py-3 outline-none focus:border-[#6A1FEB] focus:ring-1 focus:ring-[#6A1FEB]/10 transition`}
              />
              <p className={`text-right mt-1.5 ${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray}`}>{location.length}/50</p>
            </div>
          </div>

          {/* 회의 날짜/시작 시간 */}
          <div className="grid grid-cols-2 gap-6">
            <div>
              <label className={`block ${DESIGN.FONT_SIZES.md} font-medium ${DESIGN.COLORS.black} mb-2`}>
                회의 날짜
              </label>
              <input
                type="date"
                value={meetingDate}
                min={todayDate}
                onChange={(e) => setMeetingDate(e.target.value)}
                className={`w-full ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.md} px-4 py-3 outline-none focus:border-[#6A1FEB] transition`}
                required
              />
            </div>

            <div>
              <label className={`block ${DESIGN.FONT_SIZES.md} font-medium ${DESIGN.COLORS.black} mb-2`}>
                회의 시작 시간
              </label>
              <input
                type="time"
                value={meetingTime}
                min={minTime} // 시간 제약 추가
                onChange={e => setMeetingTime(e.target.value)}
                className={`w-full ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.md} px-4 py-3 outline-none focus:border-[#6A1FEB] transition`}
                required
              />
            </div>
          </div>

          {/* 참여자 선택 */}
          <div ref={dropdownRef} className="relative">
            <label className={`block ${DESIGN.FONT_SIZES.md} font-medium ${DESIGN.COLORS.black} mb-2 mt-[26px]`}>
              참여자 선택
            </label>
            <div
              onClick={() => setShowDropdown(v => !v)}
              className={`w-full ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.RADIUS_SIZES.md} p-2.5 min-h-[48px] flex flex-wrap gap-2 items-center cursor-pointer`}
            >
              {participants  
              .filter(id => id !== user?.users_id)
              .map(id => {
                const u = users.find(user => user.users_id === id);
                if (!u) return null;
                return (
                  <span
                    key={id}
                    className={`flex items-center gap-1.5 px-3 py-1.5 ${DESIGN.RADIUS_SIZES.md} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.black} font-medium transition`}
                  >
                    <span>{u.name}{u.rank_name ? ` ${u.rank_name}` : ""}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleParticipant(id);
                      }}
                      className={`${DESIGN.COLORS.gray} hover:text-black ml-1`}
                    >
                      ✕
                    </button>
                  </span>
                );
              })}
              {participants.length === 0 && (
                <span className={`${DESIGN.COLORS.gray} ${DESIGN.FONT_SIZES.sm} pl-2`}>참여자를 선택해주세요. (최소 1명)</span>
              )}
            </div>

            {/* 참여자 선택 드롭다운 */}
            {showDropdown && (
              <div className={`absolute left-0 right-0 mt-1 ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.lightGray} rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto p-2`} onClick={e => e.stopPropagation()}>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="이름 또는 이메일 검색..."
                  className={`w-full ${DESIGN.BACKGROUND_COLORS.white} border border-gray-200 rounded-md px-3 py-2 mb-2 ${DESIGN.FONT_SIZES.sm} outline-none focus:border-[#6A1FEB]`}
                />
                <div className="space-y-0.5">
                  {filteredUsers.length > 0 ? (
                    filteredUsers.map(u => {
                      const isSelected = participants.includes(u.users_id);
                      return (
                        <button
                          key={u.users_id}
                          type="button"
                          onClick={() => toggleParticipant(u.users_id)}
                          className={`w-full text-left px-3 py-2 rounded transition ${
                            isSelected
                              ? `${DESIGN.BACKGROUND_COLORS.purpleHover} font-semibold`
                              : `${DESIGN.BACKGROUND_COLORS.grayLightHover} ${DESIGN.COLORS.black}`
                          }`}
                        >
                          <div className={`${DESIGN.FONT_SIZES.sm}`}>
                            {u.name}{u.rank_name ? ` ${u.rank_name}` : ""}({u.email})
                          </div>
                          {u.dept_name && (
                            <div className={`text-[11px] ${DESIGN.COLORS.gray} mt-0.5`}>
                              {u.dept_name}
                            </div>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <p className={`text-center py-2 ${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray}`}>검색 결과가 없습니다.</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* 최하단 생성 버튼 */}
        <div className="flex justify-end">
          <Button
            type="submit"
            disabled={!canSubmit || submitting}
            size="lg"
            className="!w-auto px-10"
          >
            생성
          </Button>
        </div>
      </form>
    </div>
  );
}
