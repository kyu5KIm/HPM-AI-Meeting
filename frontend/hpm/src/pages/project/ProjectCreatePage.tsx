import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";
import api from "../../services/meeting";
import jiraLogo from "../../assets/jira.png"; 

const STEPS = ["Jira 계정 연동", "프로젝트 선택", "구성원 추가", "프로젝트 생성"];

function StepBar({ current }: { current: number }) {
  return (
    <div className="flex items-start w-full mb-10">
      {STEPS.map((label, i) => (
        <div key={i} className="flex flex-col items-center flex-1">
          <div className="flex items-center w-full">
            <div className={`flex-1 h-0.5 mr-[32px] ${i === 0 ? "invisible" : "bg-gray-200"}`} />
            <div className={`w-4 h-4 rounded-full flex-shrink-0 z-10 transition-all
              ${i === current ? "bg-[#6A1FEB] ring-2 ring-[#6A1FEB] ring-offset-2" : "bg-gray-300"}`}
            />
            <div className={`flex-1 h-0.5 ml-[32px] ${i === STEPS.length - 1 ? "invisible" : "bg-gray-200"}`} />
          </div>
          <span className={`text-xs mt-2 text-center font-medium ${i === current ? "text-[#6A1FEB]" : "text-gray-400"}`}>
            {label}
          </span>
        </div>
      ))}
    </div>
  );
}

interface UserOption { users_id: number; name: string; email?: string; rank_name?: string; dept_name?: string; }
interface JiraProject { key: string; name: string; }

export default function ProjectCreatePage() {
  const navigate = useNavigate();
  const { user, selectProject } = useAuth();
  const currentUserId = user?.users_id ?? user?.user_id;
  const [step, setStep] = useState(0);

  const [jiraConnected, setJiraConnected] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [jiraProjects, setJiraProjects] = useState<JiraProject[]>([]);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [checkingJiraStatus, setCheckingJiraStatus] = useState(true);
  const [selectedJiraProject, setSelectedJiraProject] = useState<string | null>(null);

  const [allUsers, setAllUsers] = useState<UserOption[]>([]);
  const [members, setMembers] = useState<(UserOption & { isJira: boolean })[]>([]);
  const [searchName, setSearchName] = useState("");
  const [creating, setCreating] = useState(false);

  const [createdProjectId, setCreatedProjectId] = useState<number | null>(null);
  const [createdProjectName, setCreatedProjectName] = useState("");
  const [jiraErrorModal, setJiraErrorModal] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("jira") === "success") {
      setJiraConnected(true);
      setStep(1);
      setCheckingJiraStatus(false);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    } else if (params.get("jira") === "error") {
      setJiraErrorModal(true);
      setCheckingJiraStatus(false);
      window.history.replaceState({}, "", window.location.pathname);
      return;
    }

    if (!currentUserId) {
      setCheckingJiraStatus(false);
      return;
    }

    let active = true;
    setCheckingJiraStatus(true);
    api.get("/jira/status/")
      .then((res) => {
        if (!active) return;
        if (res.data.connected) {
          setJiraConnected(true);
          setStep(1);
        } else {
          setJiraConnected(false);
          setStep(0);
        }
      })
      .catch(() => {
        if (!active) return;
        setJiraConnected(false);
        setStep(0);
      })
      .finally(() => {
        if (active) setCheckingJiraStatus(false);
      });

    return () => {
      active = false;
    };
  }, [currentUserId]);

  useEffect(() => {
    api.get("/users/").then(res => {
      console.log("allUsers 로드됨:", res.data.length, "명", res.data[0]);
      const users = res.data as UserOption[];
      setAllUsers(users);

      if (currentUserId) {
        const owner =
          users.find((u) => u.users_id === currentUserId) ||
          { users_id: currentUserId, name: user?.name || "-", email: user?.email };

        setMembers((current) =>
          current.some((member) => member.users_id === owner.users_id)
            ? current
            : [{ ...owner, isJira: false }, ...current],
        );
      }
    }).catch((e) => console.error("/api/users/ 실패:", e));
  }, [currentUserId, user]);

  useEffect(() => {
    if (!jiraConnected || !currentUserId) return;
    setJiraLoading(true);
    setJiraProjects([]);
    setSelectedJiraProject(null);
    api.get(`/jira/projects/?user_id=${currentUserId}`)
      .then(res => {
        const projects = res.data as JiraProject[];
        setJiraProjects(projects);
        setSelectedJiraProject((selected) =>
          selected && projects.some((project) => project.key === selected)
            ? selected
            : null,
        );
      })
      .catch(() => setJiraErrorModal(true))
      .finally(() => setJiraLoading(false));
  }, [currentUserId, jiraConnected]);

  const handleJiraConnect = () => {
    if (!currentUserId) {
      navigate("/login");
      return;
    }
    window.location.href = `${import.meta.env.VITE_API_BASE_URL}/jira/start/`;
  };

  const filteredResults = searchName.trim().length > 0
    ? allUsers.filter(u =>
        u.name.includes(searchName) ||
        (u.email || "").includes(searchName) ||
        (u.dept_name || "").includes(searchName)
      )
    : [];

  const handleToggleMember = (u: UserOption) => {
    const isOwner = u.users_id === currentUserId;
    if (members.find(m => m.users_id === u.users_id)) {
      if (!isOwner) {
        setMembers(prev => prev.filter(m => m.users_id !== u.users_id));
      }
    } else {
      setMembers(prev => [...prev, { ...u, isJira: false }]);
    }
    setSearchName("");
  };

  const handleRemoveMember = (id: number) => {
    if (id === currentUserId) return;
    setMembers(prev => prev.filter(m => m.users_id !== id));
  };

  const handleCreate = async () => {
    setCreating(true);
    try {
      const projectName = jiraProjects.find(p => p.key === selectedJiraProject)?.name ?? "새 프로젝트";
      const res = await api.post("/projects/", {
        project_name: projectName || "새 프로젝트",
        description: "",
        owner_id: currentUserId,
        member_ids: members.map(m => m.users_id),
        jira_project_key: selectedJiraProject,
      });
      setCreatedProjectId(res.data.project_id);
      setCreatedProjectName(res.data.project_name);
      // selectProject는 버튼 클릭 시 호출됨
      setStep(3);
    } catch (e) {
      console.error("프로젝트 생성 실패:", e);
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error ?? "프로젝트 생성에 실패했습니다.";
      setErrorMessage(msg);
      setShowErrorModal(true);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F6F5FA] flex flex-col p-4">

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

      {jiraErrorModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl w-80 overflow-hidden shadow-xl">
            <div className="px-8 py-10 text-center">
              <p className="text-[#6A1FEB] font-medium leading-relaxed">
                Jira 계정 연동에 실패했습니다.<br />다시 시도 해주세요
              </p>
            </div>
            <div className="border-t border-gray-200 flex">
              <button
                onClick={() => { setJiraErrorModal(false); handleJiraConnect(); }}
                className="flex-1 py-4 text-sm text-gray-700 hover:bg-gray-50 transition border-r border-gray-200"
              >
                재시도
              </button>
              <button
                onClick={() => setJiraErrorModal(false)}
                className="flex-1 py-4 text-sm text-gray-700 hover:bg-gray-50 transition"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="flex-1 bg-[#FFFDFD] rounded-2xl flex flex-col overflow-hidden">
        <header className="h-16 border-b border-[#E5E5E5] flex-shrink-0" />
        <div className="flex flex-col items-center py-10 px-6 flex-1 overflow-auto">
          <div className="w-full max-w-[680px]">
            <StepBar current={step} />

            {checkingJiraStatus ? (
              <div className="text-sm text-gray-400 text-center py-10">Jira 연동 상태 확인 중...</div>
            ) : null}

            {!checkingJiraStatus && step === 0 && (
              <div>
                <h2 className="text-2xl font-medium text-gray-900 text-center mb-8">
                  jira 계정 연동
                </h2>

                <div className="bg-[#ECECF2] rounded-2xl p-10 flex flex-col items-center text-center mb-6">
                  <img src={jiraLogo} alt="Jira" className="h-16 object-contain mb-10" />
                  <h3 className="text-2xl font-medium text-gray-900">팀의 개발 흐름을 한눈에</h3>
                  <p className="text-sm text-gray-400 mt-7 mb-10">
                    Jira 연동으로 프로젝트 업무 진행 상황을 한 곳에서 바로 확인하세요
                  </p>
                  <button
                    onClick={() => jiraConnected ? setStep(1) : handleJiraConnect()}
                    className="px-8 py-3 bg-[#6A1FEB] text-white rounded-lg hover:opacity-90"
                  >
                    연동하기
                  </button>
                </div>

                {/* 뒤로가기 */}
                {!jiraConnected && (
                  <div className="flex justify-center">
                    <button
                      onClick={() => navigate("/projects")}
                      className="text-sm text-gray-400 hover:underline"
                    >
                      뒤로가기
                    </button>
                  </div>
                )}
              </div>
            )}

            {!checkingJiraStatus && step === 1 && (
              <div>
                <h2 className="text-2xl font-medium text-gray-900 text-center mb-2">프로젝트 선택</h2>
                <p className="text-sm text-gray-500 text-center mb-6 leading-relaxed">
                  연결할 Jira 프로젝트를 선택하세요.
                </p>

                {jiraLoading ? (
                  <div className="text-sm text-gray-400 text-center py-10">Jira 프로젝트 불러오는 중...</div>
                ) : jiraProjects.length === 0 ? (
                  <div className="bg-[#ECECF2] rounded-2xl p-10 mb-6 text-center">
                    <h3 className="text-lg font-semibold text-gray-900">
                      연동 가능한 Jira 프로젝트가 없습니다.
                    </h3>
                    <p className="mt-4 text-sm leading-relaxed text-gray-500">
                      이미 서비스 프로젝트와 연결된 Jira 프로젝트는 목록에 표시되지 않습니다.<br />
                      다른 Jira 계정이나 워크스페이스로 다시 연동할 수 있습니다.
                    </p>
                    <div className="mt-8 flex justify-center gap-3">
                      <button
                        onClick={() => navigate("/projects")}
                        className="px-5 py-2.5 rounded-lg bg-[#EDE9FF] text-sm text-[#6A1FEB] hover:bg-[#ddd6ff]"
                      >
                        프로젝트 목록으로 돌아가기
                      </button>
                      <button
                        onClick={handleJiraConnect}
                        className="px-5 py-2.5 rounded-lg bg-[#6A1FEB] text-sm text-white hover:bg-[#512fa0]"
                      >
                        Jira 다시 연동
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="bg-[#ECECF2] rounded-2xl p-4 mb-6 max-h-[300px] overflow-y-auto">
                    {jiraProjects.map(p => {
                      const isSelected = selectedJiraProject === p.key;
                      return (
                        <div
                          key={p.key}
                          onClick={() => setSelectedJiraProject(p.key)}
                          className="flex items-center justify-between px-5 py-4 mb-2 last:mb-0 rounded-xl cursor-pointer bg-white border border-[#141414] transition hover:bg-gray-50"
                        >
                          <span className="text-sm font-medium text-gray-700">{p.name}</span>
                          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                            <circle cx="10" cy="10" r="9" fill={isSelected ? "#6A1FEB" : "none"} stroke={isSelected ? "#6A1FEB" : "#D1D5DB"} strokeWidth="1.5" />
                            <path d="M6 10.5l2.5 2.5 5.5-5.5" stroke={isSelected ? "#ffffff" : "#D1D5DB"} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </div>
                      );
                    })}
                  </div>
                )}

                {jiraProjects.length > 0 && (
                <div className="flex justify-end">
                  <button
                    onClick={() => { if (selectedJiraProject) setStep(2); }}
                    disabled={!selectedJiraProject}
                    className={`px-5 py-2.5 text-white rounded-lg text-sm transition ${
                      selectedJiraProject
                        ? "bg-[#6A1FEB] hover:bg-[#512fa0] cursor-pointer"
                        : "bg-[#969696] cursor-not-allowed"
                    }`}
                  >
                    다음
                  </button>
                </div>
                )}
              </div>
            )}

            {!checkingJiraStatus && step === 2 && (
              <div>
                <h2 className="text-2xl font-medium text-gray-900 text-center mb-[7px]">구성원 추가하기</h2>
                <p className="text-sm text-gray-400 text-center mb-6">
                  이름이나 이메일, 부서를 입력하여 프로젝트 구성원을 추가하세요
                </p>

                <div className="bg-[#ECECF2] rounded-2xl p-4 mb-6 min-h-[240px]">
                  <div className="bg-white border border-gray-200 rounded-xl p-3">
                    {members.length > 0 && (
                      <div className="flex flex-wrap gap-2 mb-2">
                        {members.map(m => (
                          <span
                            key={m.users_id}
                            className="inline-flex items-center gap-1 bg-[#ECECF2] rounded-lg px-3 py-1 text-sm text-gray-700"
                          >
                            {m.name}{m.rank_name ? ` ${m.rank_name}` : ""}
                            {m.users_id !== currentUserId ? (
                            <button
                              onClick={() => handleRemoveMember(m.users_id)}
                              className="text-gray-400 hover:text-gray-600 ml-1 leading-none"
                            >×</button>
                            ) : null}
                          </span>
                        ))}
                      </div>
                    )}
                    <input
                      value={searchName}
                      onChange={e => setSearchName(e.target.value)}
                      placeholder={members.length === 0 ? "이름이나 이메일, 부서를 입력해주세요" : ""}
                      className="w-full outline-none text-sm text-gray-700 placeholder-gray-400"
                    />
                  </div>

                  {filteredResults.length > 0 && (
                    <div className="mt-2 rounded-xl overflow-hidden border border-gray-100">
                      {filteredResults.map(u => {
                        const isSelected = !!members.find(m => m.users_id === u.users_id);
                        return (
                          <div
                            key={u.users_id}
                            onClick={() => handleToggleMember(u)}
                            className={`px-4 py-3 cursor-pointer border-b border-gray-100 last:border-0 transition
                              ${isSelected ? "bg-[#ECECF2]" : "bg-white hover:bg-gray-50"}`}
                          >
                            <p className="text-sm font-medium text-gray-800">
                              {u.name}{u.rank_name ? ` ${u.rank_name}` : ""}({u.email})
                            </p>
                            {u.dept_name && (
                              <p className="text-xs text-gray-400 mt-0.5">{u.dept_name}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="px-6 py-2.5 bg-[#EDE9FF] text-[#6A1FEB] rounded-lg text-sm hover:bg-[#ddd6ff]"
                  >
                    이전
                  </button>
                  <button
                    onClick={handleCreate}
                    disabled={creating || members.length === 0}
                    className={`px-6 py-2.5 text-white rounded-lg text-sm transition
                      ${members.length > 0 && !creating
                        ? "bg-[#6A1FEB] hover:bg-[#512fa0] cursor-pointer"
                        : "bg-[#969696] cursor-not-allowed"}`}
                  >
                    {creating ? "생성 중..." : "프로젝트 생성"}
                  </button>
                </div>
              </div>
            )}

            {!checkingJiraStatus && step === 3 && (
              <div className="flex flex-col items-center text-center py-8">
                <h2 className="text-3xl font-medium text-gray-900 mb-3">프로젝트 생성 완료</h2>
                <p className="text-sm text-gray-400 mb-12">자유롭게 프로젝트를 관리해 보세요!</p>

                {/*활성화된 체크*/}
                <div className="w-24 h-24 rounded-full bg-[#C4B5FD] flex items-center justify-center mb-12">
                  <svg width="40" height="32" viewBox="0 0 40 32" fill="none">
                    <path d="M3 16L14 27L37 3" stroke="#6A1FEB" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>

                <button
                  onClick={() => {
                    if (createdProjectId) selectProject(createdProjectId, createdProjectName);
                    navigate("/projects");
                  }}
                  className="px-8 py-3 bg-[#6A1FEB] text-white rounded-lg hover:bg-[#512fa0]"
                >
                  프로젝트로 이동
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
