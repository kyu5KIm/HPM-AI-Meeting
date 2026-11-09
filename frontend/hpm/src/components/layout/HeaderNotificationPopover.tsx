import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import {
  HEADER_NOTIFICATION_TABS,
  type NotificationTab,
} from "../../constants/header";
import {
  deleteNotification,
  getProjectDetail,
  markNotificationRead,
  type Notification,
} from "../../services/meeting";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

interface HeaderNotificationPopoverProps {
  loading: boolean;
  notifications: Notification[];
  setNotifications: Dispatch<SetStateAction<Notification[]>>;
  onClose?: () => void;
}

const TYPE_META: Record<Notification["notification_type"], { category: Exclude<NotificationTab, "전체">; kind: string }> = {
  document_uploaded: { category: "프로젝트", kind: "문서 적재" },
  project_member_added: { category: "프로젝트", kind: "프로젝트 추가" },
  meeting_invited: { category: "회의", kind: "회의 초대" },
  meeting_started: { category: "회의", kind: "회의 시작" },
  minutes_approved: { category: "회의", kind: "회의록 확정" },
  task_assigned: { category: "업무", kind: "업무 배정" },
};

const getRelativeTime = (createdAt: string) => {
  const created = new Date(createdAt).getTime();
  if (Number.isNaN(created)) return "";

  const diffMinutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
  if (diffMinutes < 1) return "방금 전";
  if (diffMinutes < 60) return `${diffMinutes}분 전`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}시간 전`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}일 전`;
};

const getNotificationPath = (notification: Notification) => {
  switch (notification.notification_type) {
    case "meeting_invited":
    case "meeting_started":
      return notification.target_id ? `/meetings/${notification.target_id}` : null;
    case "minutes_approved":
      return notification.target_id ? `/meetings/${notification.target_id}/archive` : null;
    case "task_assigned":
      return "/dashboard";
    case "document_uploaded":
      return "/documents";
    case "project_member_added":
    default:
      return null;
  }
};

export default function HeaderNotificationPopover({
  loading,
  notifications,
  setNotifications,
  onClose,
}: HeaderNotificationPopoverProps) {
  const navigate = useNavigate();
  const { projectId, selectProject } = useAuth();
  const [activeTab, setActiveTab] = useState<NotificationTab>("전체");
  const [deleteMode, setDeleteMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());

  const visibleNotifications = useMemo(() => {
    return activeTab === "전체"
      ? notifications
      : notifications.filter((notification) => TYPE_META[notification.notification_type]?.category === activeTab);
  }, [activeTab, notifications]);
  const visibleNotificationIds = useMemo(
    () => visibleNotifications.map((notification) => notification.notification_id),
    [visibleNotifications],
  );

  const hasUnreadInTab = (tab: NotificationTab) => {
    return notifications.some((notification) => {
      if (notification.is_read) return false;
      if (tab === "전체") return true;
      return TYPE_META[notification.notification_type]?.category === tab;
    });
  };

  const handleTabChange = (tab: NotificationTab) => {
    setActiveTab(tab);
    setSelectedIds(new Set());
  };

  const toggleSelected = (id: number) => {
    if (!deleteMode) return;

    setSelectedIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (deleteMode) {
      toggleSelected(notification.notification_id);
      return;
    }

    if (!notification.is_read) {
      try {
        const updated = await markNotificationRead(notification.notification_id);
        setNotifications((current) =>
          current.map((item) =>
            item.notification_id === notification.notification_id ? updated : item,
          ),
        );
      } catch {
        // 읽음 처리에 실패해도 알림 이동은 계속 진행한다.
      }
    }

    if (notification.notification_type === "project_member_added") {
      if (!notification.target_id) return;

      try {
        const project = await getProjectDetail(notification.target_id);
        if (projectId !== project.project_id) {
          selectProject(project.project_id, project.project_name);
        }
        navigate("/dashboard");
        onClose?.();
      } catch (error) {
        console.error("프로젝트 알림 이동 실패:", error);
      }
      return;
    }

    const path = getNotificationPath(notification);
    if (path) {
      navigate(path);
      onClose?.();
    }
  };

  const handleDeleteClick = async () => {
    if (!deleteMode) {
      setDeleteMode(true);
      setSelectedIds(new Set());
      return;
    }

    if (selectedIds.size === 0) {
      setDeleteMode(false);
      return;
    }

    await Promise.all(Array.from(selectedIds).map((id) => deleteNotification(id)));
    setNotifications((current) =>
      current.filter((notification) => !selectedIds.has(notification.notification_id)),
    );
    setSelectedIds(new Set());
    setDeleteMode(false);
  };

  const handleSelectAllClick = () => {
    if (visibleNotificationIds.length === 0) return;

    setDeleteMode(true);
    setSelectedIds(new Set(visibleNotificationIds));
  };

  return (
    <section
      aria-label="알림"
      className="absolute right-0 top-[50px] z-50 h-[431px] w-[352px] overflow-hidden rounded-[12px] border border-[#E6E1E6] bg-[#FFFDFD] shadow-[1px_1px_14px_4px_rgba(230,228,228,0.25)]"
      data-name={deleteMode ? "notification-delete" : "notification"}
    >
      <h2 className="absolute left-[26px] top-[18px] m-0 text-[24px] font-medium leading-[1.2] text-[#141414]">
        알림
      </h2>
      <button
        type="button"
        onClick={handleSelectAllClick}
        disabled={loading || visibleNotificationIds.length === 0}
        className="absolute left-[200px] top-[15px] flex h-[24px] w-[68px] items-center justify-center rounded-[5px] border border-[#6A1FEB] bg-[#FFFDFD] text-[12px] font-normal leading-[1.2] text-[#6A1FEB] transition-all duration-150 ease-out hover:bg-[#F0ECFA] active:scale-[0.96] disabled:cursor-not-allowed disabled:border-[#C9C9C9] disabled:text-[#969696] disabled:hover:bg-[#FFFDFD]"
      >
        전체 선택
      </button>
      <button
        type="button"
        onClick={handleDeleteClick}
        className="absolute left-[276px] top-[15px] flex h-[24px] w-[61px] items-center justify-center rounded-[5px] border-0 bg-[#6A1FEB] text-[12px] font-normal leading-[1.2] text-[#FFFDFD] transition-all duration-150 ease-out hover:opacity-90 active:scale-[0.96]"
      >
        삭제
      </button>
      <div className="absolute left-0 top-[55px] h-px w-[352px] bg-[#E6E1E6]" />

      <div className="absolute left-[13px] top-[69px] flex gap-[14px]">
        {HEADER_NOTIFICATION_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => handleTabChange(tab)}
            className={cn(
              "relative flex h-[22px] w-[61px] items-center justify-center rounded-[5px] text-[12px] font-normal leading-[1.2] transition-all duration-150 ease-out active:scale-[0.96]",
              activeTab === tab
                ? "border border-[#6A1FEB] bg-[#DCD0FE] text-[#6A1FEB] hover:bg-[#C4B6E5]"
                : "border border-[#969696] bg-[#F4F5F8] text-[#969696] hover:border-[#6A1FEB] hover:bg-[#ECECF2] hover:text-[#6A1FEB]",
            )}
          >
            {tab}
            {hasUnreadInTab(tab) ? (
              <span className="absolute -right-[4px] -top-[4px] size-[8px] rounded-full border border-[#FFFDFD] bg-[#F04438]" />
            ) : null}
          </button>
        ))}
      </div>

      <div className="absolute left-[14px] top-[107px] flex max-h-[310px] w-[324px] flex-col gap-[10px] overflow-x-hidden overflow-y-auto pr-1">
        {loading ? (
          <div className="flex h-[70px] w-full items-center justify-center rounded-[7px] border border-[#969696] bg-[#F4F5F8] text-[12px] text-[#969696]">
            알림을 불러오는 중입니다.
          </div>
        ) : visibleNotifications.length > 0 ? (
          visibleNotifications.map((notification) => {
            const selected = selectedIds.has(notification.notification_id);
            const meta = TYPE_META[notification.notification_type];

            return (
              <button
                key={notification.notification_id}
                type="button"
                onClick={() => handleNotificationClick(notification)}
                className={cn(
                  "relative h-[70px] w-full shrink-0 rounded-[7px] border border-[#969696] px-[15px] py-[13px] text-left transition-all duration-150 ease-out hover:border-[#6A1FEB] hover:bg-[#ECECF2] active:scale-[0.99]",
                  notification.is_read ? "bg-[#F4F5F8]" : "bg-[#F0ECFA]",
                )}
              >
                <div className="flex min-w-0 items-center gap-[8px] text-[12px] font-normal leading-[1.2]">
                  <span className="shrink-0 text-[#6A1FEB]">
                    {meta?.kind || "알림"}
                  </span>
                  <span className="size-[2px] shrink-0 rounded-full bg-[#969696]" />
                  <span className="min-w-0 truncate text-[#969696]">
                    {getRelativeTime(notification.created_at)}
                  </span>
                </div>
                <span className="mt-[14px] block w-[230px] truncate text-[10px] font-normal leading-[1.2] text-[#141414]">
                  {notification.content}
                </span>
                {deleteMode ? (
                  <span
                    aria-hidden="true"
                    className={cn(
                      "absolute left-[265px] top-[25px] flex size-[20px] items-center justify-center rounded-full border",
                      selected
                        ? "border-[#6A1FEB] bg-[#6A1FEB]"
                        : "border-[#969696] bg-[#FFFDFD]",
                    )}
                  >
                    {selected ? <span className="size-[8px] rounded-full bg-[#FFFDFD]" /> : null}
                  </span>
                ) : null}
              </button>
            );
          })
        ) : (
          <div className="flex h-[70px] w-full items-center justify-center rounded-[7px] border border-[#969696] bg-[#F4F5F8] text-[12px] text-[#969696]">
            표시할 알림이 없습니다.
          </div>
        )}
      </div>
    </section>
  );
}
