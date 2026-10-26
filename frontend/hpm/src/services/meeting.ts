import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL,
  withCredentials: true,
  xsrfCookieName: "csrftoken",
  xsrfHeaderName: "X-CSRFToken",
  withXSRFToken: true,
});

api.interceptors.request.use((config) => {
  try {
    const user = JSON.parse(localStorage.getItem("hpm_user") || "null");
    if (user?.access) {
      config.headers.Authorization = `Bearer ${user.access}`;
    }
  } catch {}
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      try {
        const user = JSON.parse(localStorage.getItem("hpm_user") || "null");
        if (!user?.refresh) return Promise.reject(error);
        const res = await axios.post(
          `${import.meta.env.VITE_API_BASE_URL}/users/token/refresh/`,
          { refresh: user.refresh }
        );
        const newAccess = res.data.access;
        user.access = newAccess;
        localStorage.setItem("hpm_user", JSON.stringify(user));
        original.headers.Authorization = `Bearer ${newAccess}`;
        return api(original);
      } catch {
        localStorage.removeItem("hpm_user");
        window.location.href = "/login";
      }
    }
    return Promise.reject(error);
  }
);

// ── 타입 ──────────────────────────────────────────────────────────
export interface AgendaItem {
  agenda_id?: number;
  content: string;
  reason: string;
  is_confirmed?: boolean;
}

export interface Task {
  meeting_task_id: number;
  meeting_id?: number;
  meeting_users?: number | null;
  title: string;
  content?: string;
  owner: string;
  due_date: string | null;
  priority: string;
  status?: number;
}

export interface Meeting {
  meeting_id: number;
  title: string;
  location: string;
  meeting_at: string;
  status: "scheduled" | "in_progress" | "finished";
  minutes_status: "draft" | "reviewing" | "approved" | "rejected" | null;
  meeting_document: string | null;
  is_meeting: boolean;
  is_meeting_approve?: boolean;
  project: number;
  participants?: { meeting_users_id?: number | null; user_id: number; name: string; email?: string; work?: string }[];
  agenda?: AgendaItem[];
  tasks?: Task[];
  creator?: number;
  is_paused?: boolean;
  elapsed_seconds?: number;
  creator_name?: string;
}

export interface MeetingCreatePayload {
  project_id: number;
  title: string;
  location: string;
  meeting_at: string;
  participants: number[];
}

export interface TaskCreatePayload {
  title: string;
  content?: string;
  due_date?: string | null;
  priority?: string;
  meeting_users_id?: number | null;
  user_id?: number | null;
}

export interface Notification {
  notification_id: number;
  user: number;
  notification_type:
    | "project_member_added"
    | "meeting_invited"
    | "meeting_started"
    | "minutes_approved"
    | "task_assigned"
    | "document_uploaded";
  content: string;
  target_id: number | null;
  is_read: boolean;
  created_at: string;
}

export interface UserProfile {
  users_id: number;
  email: string;
  name: string;
  emp_no: string;
  work: string;
  dept_name: string;
  rank_name: string;
}

export interface UserListItem {
  users_id: number;
  name: string;
  email: string;
  work?: string;
  dept?: number;
  rank?: number;
  dept_name?: string;
  rank_name?: string;
  role?: string;
}

export interface ProjectMember {
  user_id: number;
  name: string;
  email: string;
  work: string;
  dept_name: string;
  rank_name: string;
}

export interface ProjectDetail {
  project_id: number;
  project_owner: number;
  project_name: string;
  members: ProjectMember[];
}

// ── 회의 ──────────────────────────────────────────────────────────
export const getMeetingList = async (project_id?: number): Promise<Meeting[]> => {
  const params = project_id ? { project_id } : {};
  const res = await api.get("/meetings/", { params });
  return res.data;
};

export const getMeetingDetail = async (meetingId: number): Promise<Meeting> => {
  const res = await api.get(`/meetings/${meetingId}/`);
  return res.data;
};

export const updateMeeting = async (meetingId: number, data: Partial<Meeting>): Promise<Meeting> => {
  const res = await api.patch(`/meetings/${meetingId}/`, data);
  return res.data;
};

export const createMeeting = async (payload: MeetingCreatePayload): Promise<Meeting> => {
  const res = await api.post("/meetings/", payload);
  return res.data;
};

export const startMeeting = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/start/`);
};

export const resetMeetingRecording = async (meetingId: number): Promise<Meeting> => {
  const res = await api.post(`/meetings/${meetingId}/reset-recording/`);
  return res.data;
};

export const endMeeting = async (meetingId: number, audio?: File): Promise<{ minutes_data: { content: string; todo_list: Task[] } }> => {
  const formData = new FormData();
  if (audio) formData.append("audio", audio);
  const res = await api.post(`/meetings/${meetingId}/end/`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 600000,
  });
  return res.data;
};

export const generateMinutes = async (meetingId: number): Promise<{ content: string; todo_list: Task[] }> => {
  const res = await api.post(`/meetings/${meetingId}/minutes/`);
  return res.data;
};

export const completeMeetingRawTranscriptOnly = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/raw-transcript-only/`);
};

export const completeMeetingMappedTranscriptOnly = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/mapped-transcript-only/`);
};

export const pauseMeeting = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/pause/`);
};

export const resumeMeeting = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/resume/`);
};

export const deleteMeeting = async (meetingId: number): Promise<void> => {
  await api.delete(`/meetings/${meetingId}/`);
};

// ── 기초 안건 ──────────────────────────────────────────────────────
export const getAgendaList = async (meetingId: number): Promise<AgendaItem[]> => {
  const res = await api.get(`/meetings/${meetingId}/agenda/`);
  return res.data;
};

export const saveAgendaList = async (meetingId: number, agenda: { title: string; reason: string }[]): Promise<AgendaItem[]> => {
  const res = await api.post(`/meetings/${meetingId}/agenda/`, { agenda });
  return res.data;
};

export const confirmAgenda = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/agenda/confirm/`);
};

// ── 회의록 승인 플로우 ─────────────────────────────────────────────
export const requestMinutesApproval = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/minutes/request/`);
};

export const approveMinutes = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/minutes/approve/`);
};

export const rejectMinutes = async (meetingId: number): Promise<void> => {
  await api.post(`/meetings/${meetingId}/minutes/reject/`);
};

// ── 녹음 원문 ────────────────────────────────────────────────────────
export interface TranscriptItem {
  utterance_id: number;
  meeting_users?: number | null;
  meeting_user_name?: string;
  user_id?: number | null;
  speaker: string;
  time: string;
  content: string;
}

export const getTranscript = async (meetingId: number): Promise<TranscriptItem[]> => {
  const res = await api.get(`/meetings/${meetingId}/speaker-mapping/`);
  return res.data;
};

export const saveSpeakerMappings = async (
  meetingId: number,
  mappings: { utterance_id: number; meeting_users_id: number | null }[],
): Promise<TranscriptItem[]> => {
  const res = await api.post(`/meetings/${meetingId}/speaker-mapping/`, { mappings });
  return res.data;
};

// ── 태스크 ────────────────────────────────────────────────────────
export const getTaskList = async (meetingId: number): Promise<Task[]> => {
  const res = await api.get(`/meetings/${meetingId}/tasks/`);
  return res.data;
};

export const updateTask = async (
  meetingId: number,
  taskId: number,
  data: Partial<Task> & { meeting_users_id?: number | null; user_id?: number | null },
): Promise<Task> => {
  const res = await api.patch(`/meetings/${meetingId}/tasks/${taskId}/`, data);
  return res.data;
};

export const createTask = async (meetingId: number, data: TaskCreatePayload): Promise<Task> => {
  const res = await api.post(`/meetings/${meetingId}/tasks/`, data);
  return res.data;
};

export const deleteTask = async (meetingId: number, taskId: number): Promise<void> => {
  await api.delete(`/meetings/${meetingId}/tasks/${taskId}/`);
};

// ── Jira 등록 ─────────────────────────────────────────────────────
export const registerJiraTasks = async (
  meetingId: number,
  taskIds: number[],
  userId?: number,
): Promise<{ registered: { task_id: number; jira_key: string }[]; failed: unknown[] }> => {
  const res = await api.post(`/meetings/${meetingId}/jira/`, { task_ids: taskIds, user_id: userId });
  return res.data;
};

export const sendMeetingSummaryEmail = async (
  meetingId: number,
  recipientUserIds?: number[],
): Promise<{ sent: { user_id: number; email: string; name: string }[] }> => {
  const res = await api.post(
    `/meetings/${meetingId}/email/`,
    recipientUserIds ? { recipient_user_ids: recipientUserIds } : {},
  );
  return res.data;
};

// ── 챗봇 ─────────────────────────────────────────────────────────
export const sendChatMessage = async (meetingId: number, query: string): Promise<{ answer: string; sources?: string[] }> => {
  const res = await api.post(`/chat/${meetingId}/`, { question: query });
  return res.data;
};

// ── 유저 ─────────────────────────────────────────────────────────
export const getUserList = async (): Promise<UserListItem[]> => {
  const res = await api.get("/users/");
  return res.data;
};

export const getUserProfile = async (userId: number): Promise<UserProfile> => {
  const res = await api.get(`/users/${userId}/`);
  return res.data;
};

export default api;

// ── Jira 연동 상태 ────────────────────────────────────────────────────
export const getJiraStatus = async (): Promise<{ connected: boolean }> => {
  const res = await api.get("/jira/status/");
  return res.data;
};

// ── 알림 ─────────────────────────────────────────────────────────
export const getNotifications = async (): Promise<Notification[]> => {
  const res = await api.get("/notifications/");
  return res.data;
};

export const markNotificationRead = async (notifId: number): Promise<Notification> => {
  const res = await api.patch(`/notifications/${notifId}/read/`);
  return res.data;
};

export const deleteNotification = async (notifId: number): Promise<void> => {
  await api.delete(`/notifications/${notifId}/`);
};

// ── 프로젝트 ─────────────────────────────────────────────────────
export const getProjects = async () => {
  const res = await api.get("/projects/");
  return res.data;
};

export const getProjectDetail = async (projectId: number): Promise<ProjectDetail> => {
  const res = await api.get(`/projects/${projectId}/`);
  return res.data;
};

export interface JiraBoardIssue {
  issue_key: string;
  title: string;
  description: string;
  assignee: string;
  priority: string;
  due_date: string;
  created: string;
  status: string;
  parent_key?: string;
  parent_title?: string;
  issue_type?: string;
  issue_type_icon_url?: string;
  issue_type_hierarchy_level?: number | null;
}

export interface JiraParentOption {
  issue_key: string;
  title: string;
}

export interface JiraBoardColumn {
  id: string;
  label: string;
  status_ids: string[];
  status_names: string[];
}

export interface ProjectJiraBoard {
  columns: JiraBoardColumn[];
  issues: Record<string, JiraBoardIssue[]>;
  parent_options?: JiraParentOption[];
  can_manage?: boolean;
  read_only?: boolean;
}

export const getProjectJiraBoard = async (projectId: number): Promise<ProjectJiraBoard> => {
  const res = await api.get(`/projects/${projectId}/jira-board/`);
  return res.data;
};

export const createProjectJiraIssue = async (
  projectId: number,
  data: {
    title: string;
    description?: string;
    due_date?: string;
    priority?: string;
    column_id?: string;
    target_status_names?: string[];
    assignee_user_id?: number;
    parent_key?: string;
  },
): Promise<{ success: boolean; issue_key: string; column_id: string }> => {
  const res = await api.post(`/projects/${projectId}/jira-board/`, data);
  return res.data;
};

export const updateProjectJiraIssue = async (
  projectId: number,
  issueKey: string,
  data: {
    title?: string;
    description?: string;
    due_date?: string | null;
    priority?: string;
    assignee_user_id?: number;
    parent_key?: string | null;
  },
): Promise<{ success: boolean; issue_key: string }> => {
  const res = await api.patch(`/projects/${projectId}/jira-board/issue/${issueKey}/`, data);
  return res.data;
};

export const updateProjectJiraIssueStatus = async (
  projectId: number,
  issueKey: string,
  columnId: string,
  targetStatusNames?: string[],
): Promise<{ success: boolean; column_id: string }> => {
  const res = await api.patch(
    `/projects/${projectId}/jira-board/issue/${issueKey}/status/`,
    { column_id: columnId, target_status_names: targetStatusNames ?? [] },
  );
  return res.data;
};

export const rankProjectJiraIssue = async (
  projectId: number,
  issueKey: string,
  position: { beforeIssueKey?: string; afterIssueKey?: string },
): Promise<void> => {
  await api.patch(`/projects/${projectId}/jira-board/issue/${issueKey}/rank/`, {
    before_issue_key: position.beforeIssueKey,
    after_issue_key: position.afterIssueKey,
  });
};

export const addProjectMembers = async (projectId: number, memberIds: number[]): Promise<void> => {
  await api.patch(`/projects/${projectId}/`, { add_member_ids: memberIds });
};

export const deleteProject = async (projectId: number): Promise<void> => {
  await api.delete(`/projects/${projectId}/`);
};

export const createProject = async (data: { name: string; description: string }) => {
  const res = await api.post("/projects/", data);
  return res.data;
};

// ── OCR서버 -> 텍스트 추출 -> ocr텍스트 + 회의 제목 -> 안건 생성 ─────────────────────────────────────────────────────
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const generateAgendaWithOcr = async (
  meetingId: number,
  file: File | null
): Promise<{ ocr_text: string; agenda: AgendaItem[] }> => {
  const formData = new FormData();
  if (file) formData.append("file", file);

  const res = await api.post(`/meetings/${meetingId}/agenda/generate/`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });

  if (res.data.status === "completed") {
    return res.data;
  }

  if (res.data.status === "processing" && res.data.job_id) {
    const jobId = res.data.job_id;

    while (true) {
      await delay(3000);

      try {
        const statusRes = await api.get(`/meetings/${meetingId}/agenda/status/`, {
          params: { job_id: jobId },
          timeout: 120000,
        });

        if (statusRes.data.status === "completed") {
          return statusRes.data;
        }

        throw new Error(statusRes.data.error || "안건 생성 중 알 수 없는 응답 상태입니다.");
      } catch (error: any) {
        console.error("상태 확인 중 에러 발생:", error);
        const errMsg = error.response?.data?.error;
        if (errMsg) {
          throw new Error(errMsg);
        }
      }
    }
  }

  throw new Error("알 수 없는 서버 응답입니다.");
};
// ── 회의 준비 자료 ─────────────────────────────────────────────────────
export interface MeetingPreparation {
  preration_id?: number;
  meeting: number;
  purpose: string | null;
  project_status: string | null;
  rule: string | null;
  effect: string | null;
  sources?: {
    document_id: number;
    title: string;
    file_url: string;
  }[];
}

export const getPrepMaterial = async (meetingId: number): Promise<MeetingPreparation> => {
  const res = await api.get(`/meetings/${meetingId}/prep/`);
  return res.data;
};

export const savePrepMaterial = async (
  meetingId: number,
  data: Partial<MeetingPreparation>
): Promise<MeetingPreparation> => {
  const res = await api.post(`/meetings/${meetingId}/prep/`, data);
  return res.data;
};

export const generatePrepMaterial = async (
  meetingId: number,
  file: File | null = null
): Promise<MeetingPreparation> => {
  const formData = new FormData();
  if (file) formData.append("file", file);

  const res = await api.post(`/meetings/${meetingId}/prep/generate/`, formData, {
    headers: { "Content-Type": "multipart/form-data" },
    timeout: 30000,
  });

  if (res.data.status === "completed") {
    return res.data.prep;
  }

  if (res.data.status === "processing" && res.data.job_id) {
    const jobId = res.data.job_id;
    let attempts = 0;
    const maxAttempts = 60;

    while (attempts < maxAttempts) {
      await delay(3000);

      try {
        const statusRes = await api.get(`/meetings/${meetingId}/prep/status/`, {
          params: { job_id: jobId },
          timeout: 120000,
        });

        if (statusRes.data.status === "completed") {
          return statusRes.data.prep;
        }

        if (statusRes.data.status === "processing") {
          attempts++;
          console.log(`[${attempts}/${maxAttempts}] 준비 자료 생성 대기 중...`);
          continue;
        }

        throw new Error(statusRes.data.error || "준비 자료 생성 중 알 수 없는 응답 상태입니다.");
      } catch (error: any) {
        console.error("준비 자료 상태 확인 중 에러 발생:", error);
        const errMsg = error.response?.data?.error;
        if (errMsg) {
          throw new Error(errMsg);
        }
        attempts++;
      }
    }

    throw new Error("작업 시간이 초과되었습니다.");
  }

  throw new Error("알 수 없는 서버 응답입니다.");
};


export const getUserProjects = async (userId: number) => {
  const res = await api.get(`/projects/user/${userId}/`);
  return res.data;
};

export const sendProjectChatMessage = async (
  projectId: number,
  query: string
): Promise<{ answer: string; sources?: string[] }> => {
  const res = await api.post(`/chat/project/${projectId}/`, { question: query });
  return res.data;
};
