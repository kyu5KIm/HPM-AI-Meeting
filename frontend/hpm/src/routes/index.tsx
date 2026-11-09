import { createBrowserRouter, Navigate } from "react-router-dom";
import Layout from "../components/layout/Layout";
import LoginPage from "../pages/auth/LoginPage";
import ChangePasswordPage from "../pages/auth/ChangePasswordPage";
import ProjectSelectPage from "../pages/project/ProjectSelectPage";
import ProjectCreatePage from "../pages/project/ProjectCreatePage";
import KanbanBoardPage from "../pages/project/KanbanBoardPage";
import MeetingListPage from "../pages/meeting/MeetingListPage";
import MeetingCreatePage from "../pages/meeting/MeetingCreatePage";
import MeetingUploadPage from "../pages/meeting/MeetingUploadPage";
import AgendaCreatePage from "../pages/meeting/AgendaCreatePage";
import PrepMaterialPage from "../pages/meeting/PrepMaterialPage";
import MeetingCompletePage from "../pages/meeting/MeetingCompletePage";
import MeetingInviteEmailPage from "../pages/meeting/MeetingInviteEmailPage";
import MeetingDetailPage from "../pages/meeting/MeetingDetailPage";
import MeetingMinutesPage from "../pages/meeting/MeetingMinutesPage";
import MeetingArchivePage from "../pages/meeting/MeetingArchivePage";
import SpeakerMappingPage from "../pages/meeting/SpeakerMappingPage";
import JiraTaskPage from "../pages/meeting/JiraTaskPage";
import MeetingEmailPage from "../pages/meeting/MeetingEmailPage";
import MeetingJiraRegisterPage from "../pages/meeting/MeetingJiraRegisterPage";
import DocumentManagementPage from "../pages/document/DocumentManagementPage";
import DocumentUploadPage from "../pages/document/DocumentUploadPage";
import MemberManagementPage from "../pages/member/MemberManagementPage";
import UserManagementPage from "../pages/admins/UserManagementPage";
import NotFoundPage from "../pages/error/NotFoundPage";
import { DocumentRoutes, RequireAdmin } from "./RouteGuards";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/login", element: <LoginPage /> },
      { path: "/change-password", element: <ChangePasswordPage /> },
      { path: "/projects", element: <ProjectSelectPage /> },
      { path: "/projects/create", element: <ProjectCreatePage /> },
      { path: "/", element: <Navigate to="/login" replace /> },
      { path: "/dashboard", element: <KanbanBoardPage /> },
      { path: "/meetings", element: <MeetingListPage /> },
      { path: "/meetings/create", element: <MeetingCreatePage /> },
      { path: "/meetings/:id/upload", element: <MeetingUploadPage /> },
      { path: "/meetings/:id/agenda", element: <AgendaCreatePage /> },
      { path: "/meetings/:id/prep-material", element: <PrepMaterialPage /> },
      { path: "/meetings/:id/complete", element: <MeetingCompletePage /> },
      { path: "/meetings/:id/invite-email", element: <MeetingInviteEmailPage /> },
      { path: "/meetings/:id", element: <MeetingDetailPage /> },
      { path: "/meetings/:id/speaker-mapping", element: <SpeakerMappingPage /> },
      { path: "/meetings/:id/minutes", element: <MeetingMinutesPage /> },
      { path: "/meetings/:id/archive", element: <MeetingArchivePage /> },
      { path: "/meetings/:id/jira", element: <JiraTaskPage /> },
      { path: "/meetings/:id/email", element: <MeetingEmailPage /> },
      { path: "/meetings/:id/jira-register", element: <MeetingJiraRegisterPage /> },
      {
        path: "/documents",
        element: <DocumentRoutes />,
        children: [
          { index: true, element: <DocumentManagementPage /> },
          { path: "upload", element: <DocumentUploadPage /> },
        ],
      },
      { path: "/members", element: <MemberManagementPage /> },
      {
        path: "/admin/users",
        element: (
          <RequireAdmin>
            <UserManagementPage />
          </RequireAdmin>
        ),
      },
    ],
  },
  { path: "*", element: <NotFoundPage /> },
]);

export default router;
