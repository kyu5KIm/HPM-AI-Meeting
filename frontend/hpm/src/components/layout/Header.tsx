import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useNavigate } from "react-router-dom";
import * as DESIGN from "../../constants/design";
import bell from "../../assets/header/bell.png";
import toggle from "../../assets/header/toggle.png";
import { useAuth } from "../../context/AuthContext";
import type { HeaderPopover } from "../../constants/header";
import {
  getJiraStatus,
  getNotifications,
  getUserProfile,
  type Notification,
  type UserProfile,
} from "../../services/meeting";
import HeaderNotificationPopover from "./HeaderNotificationPopover";
import HeaderProfilePopover from "./HeaderProfilePopover";

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const isAdmin = user?.role === "ADMIN";
  const [openPopover, setOpenPopover] = useState<HeaderPopover>(null);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [notificationsLoading, setNotificationsLoading] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [jiraConnected, setJiraConnected] = useState<boolean | null>(null);
  const [jiraStatusLoading, setJiraStatusLoading] = useState(false);
  const notificationTriggerRef = useRef<HTMLDivElement | null>(null);
  const notificationPopoverRef = useRef<HTMLDivElement | null>(null);
  const profileTriggerRef = useRef<HTMLDivElement | null>(null);
  const profilePopoverRef = useRef<HTMLDivElement | null>(null);

  const addNotification = useCallback((notification: Notification) => {
    setNotifications((current) => {
      if (current.some((item) => item.notification_id === notification.notification_id)) {
        return current;
      }

      return [notification, ...current];
    });
  }, []);

  const loadNotifications = useCallback(async () => {
    if (!user || isAdmin) {
      setNotifications([]);
      setNotificationsLoading(false);
      return;
    }

    setNotificationsLoading(true);
    try {
      const data = await getNotifications();
      setNotifications(data);
    } catch {
      setNotifications([]);
    } finally {
      setNotificationsLoading(false);
    }
  }, [isAdmin, user]);

  useEffect(() => {
    void loadNotifications();
  }, [loadNotifications]);

  useEffect(() => {
    setJiraConnected(null);
    setJiraStatusLoading(false);
  }, [user?.users_id]);

  useEffect(() => {
    if (!user || isAdmin) return;

    const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "";
    const source = new EventSource(`${apiBaseUrl}/notifications/stream/`, {
      withCredentials: true,
    });
    const handleNotification = (event: Event) => {
      try {
        const message = event as MessageEvent<string>;
        addNotification(JSON.parse(message.data) as Notification);
      } catch {
        // Ignore malformed SSE messages and keep the stream alive.
      }
    };

    source.addEventListener("notification", handleNotification);

    return () => {
      source.removeEventListener("notification", handleNotification);
      source.close();
    };
  }, [addNotification, isAdmin, user]);

  const loadProfile = useCallback(async () => {
    if (!user?.users_id) {
      setProfile(null);
      setProfileLoading(false);
      return;
    }

    setProfileLoading(true);
    try {
      const data = await getUserProfile(user.users_id);
      setProfile(data);
    } catch {
      setProfile(null);
    } finally {
      setProfileLoading(false);
    }
  }, [user]);

  const loadJiraStatus = useCallback(async () => {
    if (!user || isAdmin) {
      setJiraConnected(null);
      setJiraStatusLoading(false);
      return null;
    }

    setJiraStatusLoading(true);
    try {
      const status = await getJiraStatus();
      setJiraConnected(status.connected);
      return status.connected;
    } catch {
      setJiraConnected(false);
      return false;
    } finally {
      setJiraStatusLoading(false);
    }
  }, [isAdmin, user]);

  const unreadNotificationCount = useMemo(
    () => notifications.filter((notification) => !notification.is_read).length,
    [notifications],
  );
  const unreadNotificationLabel =
    unreadNotificationCount > 99 ? "99+" : String(unreadNotificationCount);

  const togglePopover = (popover: Exclude<HeaderPopover, null>) => {
    setOpenPopover((current) => {
      const next = current === popover ? null : popover;
      if (popover === "notifications" && next === "notifications") {
        void loadNotifications();
      }
      if (popover === "profile" && next === "profile") {
        if (!isAdmin) {
          void loadProfile();
          void loadJiraStatus();
        }
      }
      return next;
    });
  };

  useEffect(() => {
    if (!openPopover) return;

    const handleDocumentMouseDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;

      const triggerRef = openPopover === "notifications" ? notificationTriggerRef : profileTriggerRef;
      const popoverRef = openPopover === "notifications" ? notificationPopoverRef : profilePopoverRef;

      if (triggerRef.current?.contains(target) || popoverRef.current?.contains(target)) {
        return;
      }

      setOpenPopover(null);
    };

    document.addEventListener("mousedown", handleDocumentMouseDown);
    return () => document.removeEventListener("mousedown", handleDocumentMouseDown);
  }, [openPopover]);

  const handleTriggerKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    popover: Exclude<HeaderPopover, null>,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePopover(popover);
  };

  const handleJiraConnect = async () => {
    if (!user?.users_id || jiraStatusLoading) return;

    const connected = jiraConnected ?? (await loadJiraStatus());
    if (connected) return;

    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${import.meta.env.VITE_API_BASE_URL}/jira/start/?next=${next}`;
  };

  const handleJiraReconnect = () => {
    if (!user?.users_id || jiraStatusLoading) return;
    const next = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `${import.meta.env.VITE_API_BASE_URL}/jira/start/?next=${next}`;
  };

  const handleChangePassword = () => {
    setOpenPopover(null);
    navigate("/change-password");
  };

  const handleLogout = async () => {
    await logout();
    setOpenPopover(null);
    navigate("/login");
  };

  return (
    <header
      className={`w-full h-16 border-b border-[#E6E1E6] ${DESIGN.BACKGROUND_COLORS.white}`}
    >
      <div className={`flex h-16 w-full items-center justify-end px-6 ${isAdmin ? "" : " mx-auto"}`}>
        <div className={`flex ${DESIGN.GAP_SIZES["xl"]}`}>
          {!isAdmin ? (
            <div
              ref={notificationTriggerRef}
              className={`relative flex ${DESIGN.BORDER_COLORS.lightGray} w-[40px] h-[40px] items-center justify-center border-rad rounded-full`}
            >
              <button
                type="button"
                aria-label="알림"
                onClick={() => togglePopover("notifications")}
                className="relative flex size-full items-center justify-center"
              >
                <img src={bell} alt="" />
                {unreadNotificationCount > 0 ? (
                  <span className="absolute -right-[4px] -top-[5px] flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#F04438] px-[4px] text-[10px] font-semibold leading-none text-[#FFFDFD]">
                    {unreadNotificationLabel}
                  </span>
                ) : null}
              </button>
              {openPopover === "notifications" ? (
                <div ref={notificationPopoverRef}>
                  <HeaderNotificationPopover
                    loading={notificationsLoading}
                    notifications={notifications}
                    setNotifications={setNotifications}
                    onClose={() => setOpenPopover(null)}
                  />
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="relative">
            <div
              ref={profileTriggerRef}
              role="button"
              tabIndex={0}
              aria-label="프로필 메뉴"
              onClick={() => togglePopover("profile")}
              onKeyDown={(event) => handleTriggerKeyDown(event, "profile")}
              className={`flex h-[40px] cursor-pointer items-center justify-center ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.GAP_SIZES["xl"]} rounded-full ${DESIGN.PADDING_X_SIZES.sm}`}
            >
              <p>{user?.name ? `${user.name}님` : ""}</p>
              <img src={toggle} alt="" />
            </div>
            {openPopover === "profile" ? (
              <div ref={profilePopoverRef}>
                <HeaderProfilePopover
                  email={profile?.email || user?.email}
                  name={profile?.name || user?.name}
                  empNo={profile?.emp_no}
                  deptName={profile?.dept_name}
                  rankName={profile?.rank_name}
                  work={profile?.work}
                  loading={profileLoading}
                  jiraConnected={jiraConnected === true}
                  onJiraReconnect={handleJiraReconnect}
                  jiraStatusLoading={jiraStatusLoading}
                  showProfileInfo={!isAdmin}
                  showJiraConnect={!isAdmin}
                  onJiraConnect={handleJiraConnect}
                  onChangePassword={handleChangePassword}
                  onLogout={handleLogout}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </header>
  );
}
