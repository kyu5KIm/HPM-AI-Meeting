import { useCallback, useEffect, useMemo, useState } from "react";
import MemberInviteModal from "../../components/member/MemberInviteModal";
import MemberManagementPanel from "../../components/member/MemberManagementPanel";
import { useAuth } from "../../context/AuthContext";
import {
  addProjectMembers,
  getProjectDetail,
  getUserList,
  type ProjectDetail,
  type UserListItem,
} from "../../services/meeting";
import type {
  MemberInviteCandidate,
  MemberRecord,
} from "../../types/memberManagement";

const MEMBERS_PER_PAGE = 10;

const toMemberRecord = (project: ProjectDetail, member: ProjectDetail["members"][number]): MemberRecord => ({
  id: member.user_id,
  name: member.name,
  email: member.email,
  department: member.dept_name,
  position: member.rank_name,
  job: member.work,
  authority: member.user_id === project.project_owner ? "creator" : "member",
});

const toInviteCandidate = (user: UserListItem): MemberInviteCandidate => ({
  id: user.users_id,
  name: user.name,
  email: user.email,
  department: user.dept_name || "",
  role: user.rank_name || user.work || "",
});

export default function MemberManagementPage() {
  const { projectId, user } = useAuth();
  const userId = user?.users_id;
  const [members, setMembers] = useState<MemberRecord[]>([]);
  const [candidates, setCandidates] = useState<MemberInviteCandidate[]>([]);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [canInvite, setCanInvite] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [loadingCandidates, setLoadingCandidates] = useState(true);
  const [addingMembers, setAddingMembers] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const applyProject = useCallback((project: ProjectDetail) => {
    setCanInvite(project.project_owner === userId);
    setMembers(project.members.map((member) => toMemberRecord(project, member)));
  }, [userId]);

  const clearMembers = useCallback(() => {
    setMembers([]);
    setCanInvite(false);
  }, []);

  const loadProjectMembers = useCallback(async () => {
    if (!projectId) {
      clearMembers();
      return;
    }

    setLoadingMembers(true);
    try {
      applyProject(await getProjectDetail(projectId));
    } catch {
      clearMembers();
    } finally {
      setLoadingMembers(false);
    }
  }, [applyProject, clearMembers, projectId]);

  // 프로젝트나 사용자가 바뀌면 렌더 중에 목록 상태를 맞추고, 요청은 아래 effect에서 보낸다.
  const membersKey = `${projectId ?? ""}:${userId ?? ""}`;
  const [loadedMembersKey, setLoadedMembersKey] = useState<string | null>(null);
  const [pageProjectId, setPageProjectId] = useState(projectId);
  if (loadedMembersKey !== membersKey) {
    setLoadedMembersKey(membersKey);
    if (!projectId) clearMembers();
    else setLoadingMembers(true);
  }
  if (pageProjectId !== projectId) {
    setPageProjectId(projectId);
    setCurrentPage(1);
  }

  useEffect(() => {
    if (!projectId) return;
    getProjectDetail(projectId)
      .then(applyProject)
      .catch(clearMembers)
      .finally(() => setLoadingMembers(false));
  }, [applyProject, clearMembers, projectId]);

  useEffect(() => {
    getUserList()
      .then((users) => setCandidates(users.map(toInviteCandidate)))
      .catch(() => setCandidates([]))
      .finally(() => setLoadingCandidates(false));
  }, []);

  const inviteCandidates = useMemo(() => {
    const memberIds = new Set(members.map((member) => member.id));
    return candidates.filter((candidate) => !memberIds.has(candidate.id));
  }, [candidates, members]);

  const totalPages = Math.ceil(members.length / MEMBERS_PER_PAGE);
  const pagedMembers = useMemo(() => {
    const startIndex = (currentPage - 1) * MEMBERS_PER_PAGE;
    return members.slice(startIndex, startIndex + MEMBERS_PER_PAGE);
  }, [currentPage, members]);

  // 목록이 줄어 현재 페이지가 범위를 벗어나면 렌더 중에 마지막 페이지로 맞춘다.
  const lastPage = Math.max(1, totalPages);
  if (currentPage > lastPage) {
    setCurrentPage(lastPage);
  }

  const addMembers = async (selectedCandidates: MemberInviteCandidate[]) => {
    if (!projectId || selectedCandidates.length === 0) return;

    setAddingMembers(true);
    try {
      await addProjectMembers(
        projectId,
        selectedCandidates.map((candidate) => candidate.id),
      );
      await loadProjectMembers();
      setInviteModalOpen(false);
    } finally {
      setAddingMembers(false);
    }
  };

  return (
    <div className="-m-6 min-h-screen overflow-x-hidden bg-[#fffdfd] pt-[45px] pb-[45px] font-pretendard">
      <section className="min-h-[1016px] w-full min-w-0 px-[32px] pb-0 pt-0">
        <MemberManagementPanel
          members={pagedMembers}
          canInvite={canInvite}
          currentPage={currentPage}
          totalPages={totalPages}
          onInviteClick={() => {
            if (projectId && canInvite && !loadingMembers) setInviteModalOpen(true);
          }}
          onPageChange={setCurrentPage}
        />
      </section>
      {inviteModalOpen ? (
        <MemberInviteModal
          candidates={inviteCandidates}
          loading={loadingCandidates}
          submitting={addingMembers}
          onAddMembers={addMembers}
          onClose={() => setInviteModalOpen(false)}
        />
      ) : null}
    </div>
  );
}
