import { useEffect, useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { getMeetingList, deleteMeeting, type Meeting } from "../../services/meeting";
import { useAuth } from "../../context/AuthContext";
import Table from "../../components/ui/Table";
import type { TableColumn } from "../../components/ui/Table";
import Pagination from "../../components/ui/Pagination";
import Button from "../../components/ui/Button";
import { DateRangePicker, FilterSelect } from "../../components/ui/DatePickerBox";
import searchIcon from "../../assets/meeting/search.png";
import meetingArrow from "../../assets/meeting/arrow.png";
import meetingArrowHover from "../../assets/meeting/arrowHover.png";
import titleMeet from "../../assets/meeting/titleMeet.png";
import * as DESIGN from "../../constants/design";

const MEETING_STATUS_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "scheduled", label: "예정" },
  { value: "in_progress", label: "진행 중" },
  { value: "finished", label: "종료" },
] as const;

const MEETING_PERIOD_FILTER_OPTIONS = [
  { value: "all", label: "전체" },
  { value: "week", label: "최근 1주일" },
  { value: "month", label: "최근 1개월" },
  { value: "3months", label: "최근 3개월" },
] as const;

const MEETING_SORT_OPTIONS = ["최신순", "오래된순"] as const;

export default function MeetingListPage() {
  const navigate = useNavigate();
  const { projectId } = useAuth();

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);

  // 필터 관련 상태들
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [periodFilter, setPeriodFilter] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState<(typeof MEETING_SORT_OPTIONS)[number]>("최신순");

  // 선택된 행들의 ID 집합
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  // 페이지네이션 상태
  const [page, setPage] = useState(1);
  const PER_PAGE = 10;
  const [loadingProjectId, setLoadingProjectId] = useState(projectId);

  // 프로젝트가 바뀌면 렌더 중에 로딩 상태를 다시 켠다.
  if (loadingProjectId !== projectId) {
    setLoadingProjectId(projectId);
    setLoading(true);
  }

  useEffect(() => {
    getMeetingList(projectId ?? undefined)
      .then((data) => {
        setMeetings(data ?? []);
        setSelectedIds(new Set());
        setPage(1);
      })
      .catch((err) => {
        console.warn("회의 목록 API 호출 실패", err);
        setMeetings([]);
      })
      .finally(() => setLoading(false));
  }, [projectId]);

  // 클라이언트 사이드 필터링 로직
  const filteredMeetings = useMemo(() => {
    const filtered = meetings.filter((m) => {
      // 검색어 필터 
      const creatorName = m.creator_name || m.participants?.[0]?.name || "";
      const matchSearch =
        m.title.toLowerCase().includes(search.toLowerCase()) ||
        creatorName.toLowerCase().includes(search.toLowerCase());

      // 상태 필터
      const matchStatus = statusFilter === "all" || m.status === statusFilter;

      // 기간 필터
      let matchPeriod = true;
      const hasDateRange = Boolean(startDate || endDate);
      if (hasDateRange) {
        if (!m.meeting_at) return false;
        const meetingDate = new Date(m.meeting_at);
        const start = startDate ? new Date(startDate + "T00:00:00") : null;
        const end = endDate ? new Date(endDate + "T23:59:59") : null;
        if (start && meetingDate < start) matchPeriod = false;
        if (end && meetingDate > end) matchPeriod = false;
      } else if (periodFilter !== "all") {
        if (!m.meeting_at) return false;
        const meetingDate = new Date(m.meeting_at);
        const now = new Date();

        if (periodFilter === "week") {
          const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          matchPeriod = meetingDate >= oneWeekAgo && meetingDate <= now;
        } else if (periodFilter === "month") {
          const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          matchPeriod = meetingDate >= oneMonthAgo && meetingDate <= now;
        } else if (periodFilter === "3months") {
          const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          matchPeriod = meetingDate >= threeMonthsAgo && meetingDate <= now;
        }
      }

      return matchSearch && matchStatus && matchPeriod;
    });

    filtered.sort((a, b) => {
      const aTime = a.meeting_at ? new Date(a.meeting_at).getTime() : Number.NaN;
      const bTime = b.meeting_at ? new Date(b.meeting_at).getTime() : Number.NaN;
      if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
      if (Number.isNaN(aTime)) return 1;
      if (Number.isNaN(bTime)) return -1;
      return sortOrder === "오래된순" ? aTime - bTime : bTime - aTime;
    });

    return filtered;
  }, [meetings, search, statusFilter, periodFilter, startDate, endDate, sortOrder]);

  // 페이지네이션 처리
  const totalPages = Math.ceil(filteredMeetings.length / PER_PAGE);
  const pagedMeetings = useMemo(() => {
    const startIdx = (page - 1) * PER_PAGE;
    return filteredMeetings.slice(startIdx, startIdx + PER_PAGE);
  }, [filteredMeetings, page]);

  // 전체 선택 / 해제 토글
  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allIds = pagedMeetings.map((m) => m.meeting_id);
      setSelectedIds(new Set(allIds));
    } else {
      setSelectedIds(new Set());
    }
  };

  // 개별 선택 토글
  const handleSelectRow = (meetingId: number, checked: boolean) => {
    const next = new Set(selectedIds);
    if (checked) {
      next.add(meetingId);
    } else {
      next.delete(meetingId);
    }
    setSelectedIds(next);
  };

  // 선택된 회의록들 실제 삭제 처리
  const handleDeleteSelected = async () => {
    if (selectedIds.size === 0) return;
    if (window.confirm(`선택한 ${selectedIds.size}개의 회의를 삭제하시겠습니까?`)) {
      const results = await Promise.allSettled(
        Array.from(selectedIds).map(async (meetingId) => {
          await deleteMeeting(meetingId);
          return meetingId;
        }),
      );

      const deletedIds = new Set(
        results
          .filter((result): result is PromiseFulfilledResult<number> => result.status === "fulfilled")
          .map((result) => result.value),
      );
      const failed = results.filter(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );

      if (deletedIds.size > 0) {
        setMeetings((prev) => prev.filter((m) => !deletedIds.has(m.meeting_id)));
        setSelectedIds(new Set());
        setPage(1);
      }

      if (failed.length > 0) {
        const firstError = failed[0].reason as { response?: { data?: { error?: string } } };
        const message =
          firstError.response?.data?.error ||
          `회의 ${failed.length}건 삭제에 실패했습니다.`;
        alert(message);
        return;
      }

      alert("삭제되었습니다.");
    }
  };

  // 이메일 발송 목(mock) 처리
  const handleSendEmail = (e: React.MouseEvent, meetingId:number, status : string) => {
    e.stopPropagation();
    if(status == "scheduled")
    {
      navigate(`/meetings/${meetingId}/invite-email`)     // 예정 -> 초대 이메일 페이지
    }
    else if(status == "finished")
    {
      navigate(`/meetings/${meetingId}/email`)           // 종료 -> 요약 이메일 페이지
    }
  };

  // 테이블 컬럼 스키마 정의 (mockup 시안 일치)
  const columns: TableColumn<Meeting>[] = [
    {
      key: "select",
      header: (
        <input
          type="checkbox"
          checked={pagedMeetings.length > 0 && pagedMeetings.every((m) => selectedIds.has(m.meeting_id))}
          onChange={(e) => handleSelectAll(e.target.checked)}
          className="w-4 h-4 cursor-pointer accent-[#6A1FEB]"
        />
      ),
      width: "60px",
      align: "center",
      render: (row) => (
        <input
          type="checkbox"
          checked={selectedIds.has(row.meeting_id)}
          onChange={(e) => handleSelectRow(row.meeting_id, e.target.checked)}
          onClick={(e) => e.stopPropagation()} // 행 클릭 이벤트 전파 방지
          className="w-4 h-4 cursor-pointer accent-[#6A1FEB]"
        />
      ),
    },
    {
      key: "title",
      header: "회의명",
      align: "left",
      render: (row) => (
        <button
          onClick={() => {
            if (row.status !== "scheduled" && row.status !== "in_progress") {
              navigate(`/meetings/${row.meeting_id}/archive`);
            } else {
              navigate(`/meetings/${row.meeting_id}`);
            }
          }}
          className="flex items-center text-start gap-1 font-medium text-[#141414] hover:text-[#6A1FEB] transition-colors group"
        >
          {row.title}
          <img
            src={meetingArrow}
            alt=""
            className="w-4 h-4 ml-1 block group-hover:hidden"
          />
          <img
            src={meetingArrowHover}
            alt=""
            className="w-4 h-4 ml-1 hidden group-hover:block"
          />
        </button>
      ),
    },
    {
      key: "location",
      header: "회의 장소",
      width: "220px",
      align: "left",
      render: (row) => <span className={DESIGN.COLORS.gray}>{row.location || "-"}</span>,
    },
    {
      key: "status",
      header: "상태",
      width: "130px",
      align: "center",
      render: (row) => {
        if (row.status === "scheduled") {
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/meetings/${row.meeting_id}`, { state: { status: "scheduled" } });
              }}
              className="px-4 py-1 text-[15px] font-medium rounded-[5px] inline-block w-[92px] text-center bg-[#2196F3] text-white hover:opacity-80 transition cursor-pointer whitespace-nowrap"
            >
              예정
            </button>
          );
        }
        if (row.status === "in_progress") {
          return (
            <button
              onClick={(e) => {
                e.stopPropagation();
                navigate(`/meetings/${row.meeting_id}`, { state: { status: "in_progress" } });
              }}
              className="px-4 py-1 text-[15px] font-medium rounded-[5px] inline-block w-[92px] text-center bg-[#6A1FEB] text-white hover:opacity-80 transition cursor-pointer whitespace-nowrap"
            >
              진행 중
            </button>
          );
        }
        return (
          <span className="px-4 py-1 text-[15px] font-medium rounded-[5px] inline-block w-[92px] text-center bg-gray-100 text-gray-500 whitespace-nowrap">
            종료
          </span>
        );
      },
    },
    {
      key: "creator",
      header: "생성자",
      width: "100px",
      align: "center",
      render: (row) => <span>{row.creator_name || row.participants?.[0]?.name || "알수없음"}</span>,
    },
    {
      key: "date",
      header: "날짜",
      width: "180px",
      align: "center",
      render: (row) => (
        <span>
          {row.meeting_at ? row.meeting_at.replace("T", " ").slice(0, 16) : "-"}
        </span>
      ),
    },
    {
      key: "participants",
      header: "참여자",
      width: "200px",
      align: "left",
      render: (row) => {
        const list = row.participants || [];
        if (list.length === 0) return <span>-</span>;
        const shownNames = list.slice(0, 3).map((p) => p.name).join(", ");
        const extraCount = list.length - 3;

        return (
          <div className="leading-relaxed text-[#141414]">
            <span className="break-keep">{shownNames}</span>
            {extraCount > 0 && (
              <span className={`inline-block whitespace-nowrap ml-1.5 px-2 py-0.5 border border-gray-300 ${DESIGN.RADIUS_SIZES.xl} ${DESIGN.FONT_SIZES.md} text-gray-500 font-medium bg-[#F4F5F8] align-middle`}>
                +{extraCount}명
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: "email",
      header: "이메일 발송",
      width: "170px",
      align: "center",
      render: (row) => (
        <Button
          onClick={(e) => handleSendEmail(e, row.meeting_id, row.status)}
          disabled={row.status === "in_progress"}
          >
          이메일 발송
        </Button>
      ),
    },
  ];

  return (
    <div className="w-full flex flex-col pt-[21px] pb-[21px]">
      {/* 타이틀 영역 */}
      <div
        className="w-full h-[200px] flex flex-col justify-center px-[64px] rounded-[15px] overflow-hidden mb-[45px]"
        style={{
          backgroundImage: `url(${titleMeet})`,
          backgroundSize: "cover",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
        }}
      >
        <div className="flex flex-col gap-[14px]">
          <h1 className="text-[32px] font-medium text-[#141414] leading-tight">회의 목록</h1>
          <div className="flex flex-col gap-[0px]">
            <p className="text-[17px] text-[#969696] font-medium">
              회의를 등록하고 관리해 보세요.
            </p>
            <p className="text-[17px] text-[#969696] font-normal">
              회의 준비부터 회의록까지 한곳에서 관리하세요.
            </p>
          </div>
        </div>
      </div>

      {/* 검색 및 상세 필터링 영역 */}
      <div className="flex flex-col gap-4 mb-6">
        {/* 검색 인풋 */}
        <div className="relative w-full max-w-sm">
          <input
            type="text"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            placeholder="회의 명이나 생성자를 입력해주세요"
            className={`w-full ${DESIGN.BACKGROUND_COLORS.white} ${DESIGN.BORDER_COLORS.gray} ${DESIGN.RADIUS_SIZES.md} ${DESIGN.FONT_SIZES.md} pl-4 pr-12 py-2.5 outline-none focus:border-[#6A1FEB] focus:ring-1 focus:ring-[#6A1FEB]/10 transition`}
          />

          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center justify-center"
            onClick={() => {
              setPage(1);
              // 검색 함수 있으면 여기 호출
              // handleSearch();
            }}
          >
            <img
              src={searchIcon}
              alt="검색"
              className="w-5 h-5"
            />
          </button>
        </div>

        {/* 하단 세부 필터 (상태, 기간, 삭제 버튼) */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* 상태 필터 */}
            <div className="flex items-center gap-2">
              <span className={`${DESIGN.FONT_SIZES.md} text-[#141414] shrink-0`}>상태</span>
              <FilterSelect
                ariaLabel="상태 필터"
                value={statusFilter}
                onChange={(value) => {
                  setStatusFilter(value);
                  setPage(1);
                }}
                options={MEETING_STATUS_FILTER_OPTIONS}
              />
            </div>

            {/* 기간 필터 */}
            <div className="flex items-center gap-2">
              <span className={`${DESIGN.FONT_SIZES.md} text-[#141414] shrink-0`}>기간</span>
              <FilterSelect
                ariaLabel="회의 기간 필터"
                value={periodFilter}
                onChange={(value) => {
                  setPeriodFilter(value);
                  setPage(1);
                }}
                options={MEETING_PERIOD_FILTER_OPTIONS}
              />
            </div>

            {/* 날짜 필터 */}
            <DateRangePicker
              startAriaLabel="회의 시작일 선택"
              endAriaLabel="회의 종료일 선택"
              startDate={startDate}
              endDate={endDate}
              onStartDateChange={(value) => {
                setStartDate(value);
                setPage(1);
              }}
              onEndDateChange={(value) => {
                setEndDate(value);
                setPage(1);
              }}
            />

            {/* ?뺣젹 */}
            <div className="flex items-center gap-2">
              <span className={`${DESIGN.FONT_SIZES.md} text-[#141414] shrink-0`}>정렬</span>
              <FilterSelect
                ariaLabel="정렬"
                value={sortOrder}
                onChange={(value) => {
                  setSortOrder(value as (typeof MEETING_SORT_OPTIONS)[number]);
                  setPage(1);
                }}
                options={MEETING_SORT_OPTIONS}
              />
            </div>
          </div>

          {/* 회의 추가 및 삭제 버튼 영역 */}
          <div className="flex gap-2">
            <Button
              onClick={() => navigate("/meetings/create")}
              className={`px-6 bg-[#6A1FEB] hover:bg-[#50309c] text-white ${DESIGN.FONT_SIZES.md}`}
            >
              회의 추가 +
            </Button>
            <Button
              onClick={handleDeleteSelected}
              disabled={selectedIds.size === 0}
              className={`px-6 ${DESIGN.FONT_SIZES.md}`}
            >
              삭제
            </Button>
          </div>
        </div>
      </div>

      {/*메인 테이블 영역 */}
      <Table
        data={pagedMeetings}
        columns={columns}
        isLoading={loading}
        emptyMessage="조건에 맞는 회의가 없습니다."
      />

      {/* 페이지네이션 영역 */}
      {!loading && (
        <Pagination
          currentPage={page}
          totalPages={totalPages}
          onPageChange={setPage}
          className="mt-8"
        />
      )}
    </div>
  );
}
