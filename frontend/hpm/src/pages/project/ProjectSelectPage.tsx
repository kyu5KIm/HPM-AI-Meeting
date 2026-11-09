import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import api, { deleteProject } from "../../services/meeting";
import ProjectCard from "../../components/project/ProjectCard";
import ProjectAdd from "../../components/project/ProjectAdd";
import * as DESIGN from "../../constants/design";
import warningIcon from "../../assets/meeting/warning.png";
import title from "../../assets/project/projectTitle.png";

interface Project {
  project_id: number;
  project_owner: number;
  project_name: string;
  startDate: string;
  members: string[];
}

export default function ProjectSelectPage() {
  const navigate = useNavigate();
  const { user, projectId, selectProject, clearProject } = useAuth();
  const currentUserId = user?.users_id ?? user?.user_id;
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<Project | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [projectsUser, setProjectsUser] = useState(user);

  // 다른 사용자로 바뀌면 렌더 중에 로딩 상태를 다시 켠다.
  if (projectsUser !== user) {
    setProjectsUser(user);
    if (user) setLoading(true);
  }

  useEffect(() => {
    if (!user) return;

    api.get("/projects/", {
      params: {
        user_id: user.users_id,
      },
    })
      .then((res) => {
        console.log("프로젝트 API 응답:", res.data);
        setProjects(
          res.data.map((project: Partial<Project>) => ({
            project_id: project.project_id ?? 0,
            project_owner: project.project_owner ?? 0,
            project_name: project.project_name ?? "",
            startDate: project.startDate ?? "",
            members: project.members ?? [],
          })),
        );
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [user]);
  const handleSelect = (p: Project) => {
    selectProject(p.project_id, p.project_name);
    navigate("/dashboard");
  };

  const handleCreate = () => {
    navigate("/projects/create");
  };

  const handleCancelDelete = () => {
    if (deleting) return;
    setDeleteTarget(null);
    setDeleteError("");
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget || deleting) return;

    setDeleting(true);
    setDeleteError("");
    try {
      await deleteProject(deleteTarget.project_id);
      setProjects((current) =>
        current.filter((project) => project.project_id !== deleteTarget.project_id),
      );
      if (projectId === deleteTarget.project_id) {
        clearProject();
      }
      setDeleteTarget(null);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ??
        "프로젝트 삭제에 실패했습니다.";
      setDeleteError(message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className={`min-h-screen ${DESIGN.BACKGROUND_COLORS.white} flex flex-col w-full`}>
      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
          <div className="w-[384px] overflow-hidden rounded-[10px] bg-white shadow-[0_16px_40px_rgba(20,20,20,0.18)]">
            <div className="px-[32px] pb-[24px] pt-[26px] text-center">
              <img src={warningIcon} alt="" className="mx-auto mb-[18px] h-[38px] w-[38px]" />
              <p className="text-[16px] font-medium leading-[1.6] text-[#6A1FEB]">
                프로젝트를 정말로 삭제하시겠습니까?<br />
                삭제시 데이터 복구 불가합니다.
              </p>
              {deleteError ? (
                <p className="mt-[10px] text-[12px] text-[#FF2B2B]">{deleteError}</p>
              ) : null}
            </div>
            <div className="flex border-t border-[#E6E1E6]">
              <button
                type="button"
                onClick={handleCancelDelete}
                disabled={deleting}
                className="h-[54px] flex-1 text-[16px] font-medium text-[#141414] transition hover:bg-[#F4F5F8] disabled:cursor-not-allowed disabled:text-[#969696]"
              >
                취소
              </button>
              <button
                type="button"
                onClick={handleConfirmDelete}
                disabled={deleting}
                className="h-[54px] flex-1 border-l border-[#E6E1E6] text-[16px] font-medium text-[#141414] transition hover:bg-[#F4F5F8] disabled:cursor-not-allowed disabled:text-[#969696]"
              >
                {deleting ? "삭제 중..." : "삭제"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex-1 px-10 pb-0 pt-[32px] max-w-[1584px] mx-auto w-full">
        <div
          className="w-full max-w-[1584px] h-[200px] flex flex-col justify-center px-[64px] rounded-[15px] overflow-hidden"
          style={{
            backgroundImage: `url(${title})`,
            backgroundSize: "cover",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
          }}
        >
          <div className="flex flex-col gap-[14px]">
              <h1 className="text-[32px] font-medium text-[#141414] leading-tight">프로젝트</h1>
            <div className="flex flex-col gap-[2px]">
              <p className="text-[17px] font-medium text-[#141414]">
                안녕하세요 <span className="text-[#6A1FEB]">{user?.name || "사용자"}</span>님!
              </p>
              <p className="text-[17px] text-[#969696]">
                프로젝트를 선택하거나 새로 생성해주세요.
              </p>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="text-sm text-gray-400 mt-[32px]">불러오는 중...</div>
        ) : (
          <div className={`grid grid-cols-[repeat(auto-fit,352px)] ${DESIGN.GAP_SIZES["4xl"]} justify-start mt-[32px]`}>
          {projects.map(p => (
            <ProjectCard 
              key={p.project_id}
              project={p} 
              canDelete={p.project_owner === currentUserId}
              onDelete={setDeleteTarget}
              onClick={() => handleSelect(p)} 
            />
          ))}
            <ProjectAdd onClick={handleCreate} />
          </div>
        )}
      </div>
    </div>
  );
}
