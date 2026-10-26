import { useState, useEffect } from "react";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import Header from "./Header";
import * as DESIGN from "../../constants/design";
import GlobalLoginModal from "../ui/GlobalLoginModal";
import { useAuth } from "../../context/AuthContext";
import { useAuthStore } from "../../constants/auth";
import FloatingChatbot from "../ui/FloatingChatbot";
import loginBg from "../../assets/login/background.png";

export default function Layout() {
  const { user } = useAuth();
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const { openLoginModal, closeLoginModal } = useAuthStore();

  useEffect(() => {
    if (!user && location.pathname !== "/login") {
      openLoginModal();
    }
    if (location.pathname === "/login") {
      closeLoginModal();
    }
  }, [user, location.pathname, openLoginModal, closeLoginModal]);

  const isChangePasswordPage = location.pathname === "/change-password";
  const isLoginPage = location.pathname === "/login";
  const requiresInitialPasswordChange = user?.account_status === 0;

  if (requiresInitialPasswordChange && !isChangePasswordPage && !isLoginPage) {
    return <Navigate to="/change-password" replace />;
  }

  const noLayoutPaths = ["/login", "/projects", "/admin/users", "/projects/create"];

  // 챗봇 숨길 페이지 판단
  const meetingProgressPaths = [
    "/upload", "/agenda", "/prep-material", "/complete",
    "/speaker-mapping", "/minutes", "/jira", "/email",
    "/jira-register", "/invite-email",
  ];

  const isMeetingPage =
    /^\/meetings\/\d+$/.test(location.pathname) ||
    meetingProgressPaths.some(path => location.pathname.endsWith(path));

  const noChatbotPaths = ["/login", "/change-password", "/projects", "/projects/create", "/admin/users"];

  const showChatbot =
    !!user &&
    !noChatbotPaths.includes(location.pathname) &&
    !isMeetingPage;
  const isNoLayout =
    noLayoutPaths.includes(location.pathname) ||
    (isChangePasswordPage && (requiresInitialPasswordChange || !user));

  if (isNoLayout) {
      const showHeader = location.pathname === "/projects" || location.pathname === "/admin/users";
      const isChangePassword = location.pathname === "/change-password";
      const isAdminUsers = location.pathname === "/admin/users";
      return (
        <div
          className={`w-full min-h-screen ${isAdminUsers ? DESIGN.BACKGROUND_COLORS.background : DESIGN.BACKGROUND_COLORS.ivory} flex flex-col bg-no-repeat`}
          style={
            isChangePassword
              ? {
                  backgroundImage: `url(${loginBg})`,
                  backgroundSize: "100% auto",
                  backgroundPosition: "center 11.5vh",
                }
              : undefined
          }
        >
          {showHeader && <Header />}
          <div className="flex-1">
            <Outlet />
          </div>
          <GlobalLoginModal />
          {showChatbot && <FloatingChatbot />}
        </div>
      );
    }

    return (
      <div className={`flex h-screen w-screen overflow-hidden ${DESIGN.BACKGROUND_COLORS.white}`}>
        <Sidebar isCollapsed={isCollapsed} toggleCollapse={() => setIsCollapsed(v => !v)} />
        <div className={`${isCollapsed ? "ml-[54px]" : "ml-[256px]"} flex flex-1 flex-col h-full min-w-0 transition-all duration-300`}>
          <Header />
          <main className={`flex-1 h-full overflow-y-auto ${DESIGN.BACKGROUND_COLORS.white} p-6 text-gray-950`}>
            <div className={`mx-auto w-full ${location.pathname === "/dashboard" ? "" : "max-w-[1504px]"}`}>
              <Outlet />
            </div>
          </main>
        </div>
        <GlobalLoginModal />
        {showChatbot && <FloatingChatbot />}
      </div>
  );
}
