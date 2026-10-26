import { useState, useEffect } from "react";
import logo from "../../assets/login/logo.png";
import Dropdown from "../../components/ui/Dropdown";
import Checkbox from "../../components/ui/Checkbox";
import Pagination from "../../components/ui/Pagination";
import {
  fetchAdminUsers, createAdminUser, deleteAdminUser,
  updateAdminUser, resetAdminUserPassword, getUserProjects,
} from "../../services/users";

interface AdminUser {
  users_id: number;
  emp_no: string;
  name: string;
  email: string;
  dept: string;
  rank: string;
  work: string;
  status: number;
}

interface UserProject {
  id: number;
  project_name: string;
  created_at: string;
  created_by: string;
  participants: string;
}

interface RegisterForm {
  emp_no: string;
  name: string;
  email: string;
  dept: string;
  rank: string;
  work: string;
  status: "재직" | "휴직" | "퇴사";
}

interface RegisterErrors {
  emp_no: string;
  name: string;
  email: string;
  dept: string;
  rank: string;
  work: string;
}

const DEPT_OPTIONS = ["개발팀", "인프라팀", "보안팀", "QA팀", "데이터팀"];
const RANK_OPTIONS = ["대표이사", "이사", "부장", "차장", "과장", "대리", "주임", "사원"];
const STATUS_LABELS: Record<number, string> = { 0: "재직", 1: "휴직", 2: "퇴사" };
const STATUS_VALUES: Record<string, number> = { "재직": 0, "휴직": 1, "퇴사": 2 };


const EMP_NO_PATTERN = /^\d{4}-[A-Z]+-\d+$/;
const NAME_PATTERN = /^[가-힣a-zA-Z]{1,30}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const INIT_REGISTER: RegisterForm = {
  emp_no: "", name: "", email: "", dept: "", rank: "", work: "", status: "재직",
};
const INIT_ERRORS: RegisterErrors = {
  emp_no: "", name: "", email: "", dept: "", rank: "", work: "",
};
const USERS_PER_PAGE = 10;

export default function UserManagementPage() {
  // ── 사용자 목록 (CRUD 반영) ──────────────────────────────────────
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── 선택 상태 ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [selectedUser, setSelectedUser] = useState<AdminUser | null>(null);
  const [userProjects, setUserProjects] = useState<UserProject[]>([]);

  // ── 필터 ────────────────────────────────────────────────────────
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState("전체");
  const [rankFilter, setRankFilter] = useState("전체");
  const [statusFilter, setStatusFilter] = useState("전체");
  const [currentPage, setCurrentPage] = useState(1);

  // ── 우측 편집 폼 ─────────────────────────────────────────────────
  const [editForm, setEditForm] = useState({
    emp_no: "", name: "", email: "",
    dept: "", rank: "", work: "",
    status: "재직" as "재직" | "휴직" | "퇴사",
  });

  // ── 모달 표시 여부 ────────────────────────────────────────────────
  const [showRegisterModal, setShowRegisterModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal]   = useState(false);
  const [showSaveModal, setShowSaveModal]       = useState(false);
  const [showResetPwModal, setShowResetPwModal] = useState(false);

  // ── 등록 폼 ─────────────────────────────────────────────────────
  const [registerForm, setRegisterForm] = useState<RegisterForm>(INIT_REGISTER);
  const [registerErrors, setRegisterErrors] = useState<RegisterErrors>(INIT_ERRORS);

  useEffect(() => {
  setIsLoading(true);
  fetchAdminUsers()
    .then((data: any[]) => {
      setUsers(data.map((u) => ({
        users_id: u.users_id,
        emp_no: u.emp_no,
        name: u.name,
        email: u.email,
        dept: u.dept_name,
        rank: u.rank_name,
        work: u.work,
        status: u.status,
      })));
    })
    .catch(console.error)
    .finally(() => setIsLoading(false));
}, []);

  // ── 필터 적용 목록 ────────────────────────────────────────────────
  const filteredUsers = users.filter((u) => {
    const matchSearch = !search ||
      u.name.includes(search) ||
      u.emp_no.includes(search) ||
      u.email.includes(search);
    const matchDept   = deptFilter   === "전체" || u.dept   === deptFilter;
    const matchRank   = rankFilter   === "전체" || u.rank   === rankFilter;
    const matchStatus = statusFilter === "전체" || u.status === STATUS_VALUES[statusFilter];
    return matchSearch && matchDept && matchRank && matchStatus;
  });

  const totalPages = Math.ceil(filteredUsers.length / USERS_PER_PAGE);
  const pagedUsers = filteredUsers.slice(
    (currentPage - 1) * USERS_PER_PAGE,
    currentPage * USERS_PER_PAGE,
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [deptFilter, rankFilter, search, statusFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, totalPages)));
  }, [totalPages]);

  // ── 체크박스 ─────────────────────────────────────────────────────
  const handleSelectAll = (checked: boolean) => {
    const pageIds = pagedUsers.map((u) => u.users_id);

    if (checked) {
      setSelectedIds((prev) => Array.from(new Set([...prev, ...pageIds])));
      return;
    }

    setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
  };
  const handleSelectOne = (id: number, checked: boolean) => {
    setSelectedIds((prev) => checked ? [...prev, id] : prev.filter((v) => v !== id));
  };

  // ── 상세보기 선택 ─────────────────────────────────────────────────
  const handleSelectUser = (u: AdminUser) => {
    setSelectedUser(u);
    setEditForm({
      emp_no: u.emp_no, name: u.name, email: u.email,
      dept: u.dept, rank: u.rank, work: u.work,
      status: STATUS_LABELS[u.status] as "재직" | "휴직" | "퇴사",
    });
    getUserProjects(u.users_id).then(setUserProjects).catch(() => setUserProjects([]));
  };

  // ── 삭제 ────────────────────────────────────────────────────────
  const handleDelete = async () => {
  try {
    await Promise.all(selectedIds.map((id) => deleteAdminUser(id)));
    setUsers((prev) => prev.filter((u) => !selectedIds.includes(u.users_id)));
    if (selectedUser && selectedIds.includes(selectedUser.users_id)) setSelectedUser(null);
    setSelectedIds([]);
  } catch (e: any) {
    const msg = e?.response?.data?.error ?? "삭제에 실패했습니다.";
    alert(msg);
  } finally {
    setShowDeleteModal(false);
  }
};

  // ── 저장 ────────────────────────────────────────────────────────
  const handleSave = async () => {
  if (!selectedUser) return;
  try {
    await updateAdminUser(selectedUser.users_id, {
      name: editForm.name,
      email: editForm.email,
      emp_no: editForm.emp_no,
      work: editForm.work,
      dept_name: editForm.dept,
      rank_name: editForm.rank,
      status: STATUS_VALUES[editForm.status],
    });
    setUsers((prev) =>
      prev.map((u) =>
        u.users_id === selectedUser.users_id
          ? { ...u, ...editForm, status: STATUS_VALUES[editForm.status] }
          : u
      )
    );
  } catch {
    alert("저장에 실패했습니다.");
  } finally {
    setShowSaveModal(false);
  }
};

  // ── 등록 유효성 검사 ──────────────────────────────────────────────
  const validateRegister = (): boolean => {
    const errors: RegisterErrors = { ...INIT_ERRORS };
    let valid = true;

    if (!registerForm.emp_no) {
      errors.emp_no = "필수 항목을 입력해주세요."; valid = false;
    } else if (!EMP_NO_PATTERN.test(registerForm.emp_no)) {
      errors.emp_no = "사원번호 형식에 맞지 않습니다."; valid = false;
    }

    if (!registerForm.name) {
      errors.name = "필수 항목을 입력해주세요."; valid = false;
    } else if (!NAME_PATTERN.test(registerForm.name)) {
      errors.name = "한글, 영어만 포함하여 최대 30자 이내로 입력해 주세요."; valid = false;
    }

    if (!registerForm.email) {
      errors.email = "필수 항목을 입력해주세요."; valid = false;
    } else if (!EMAIL_PATTERN.test(registerForm.email) || registerForm.email.length > 50) {
      errors.email = "이메일 형식에 맞게 50자 이내로 입력해 주세요."; valid = false;
    }

    if (!registerForm.dept) { errors.dept = "필수 항목을 입력해주세요."; valid = false; }
    if (!registerForm.rank) { errors.rank = "필수 항목을 입력해주세요."; valid = false; }
    if (!registerForm.work) { errors.work = "필수 항목을 입력해주세요."; valid = false; }

    setRegisterErrors(errors);
    return valid;
  };

  const handleRegisterSubmit = async () => {
  if (!validateRegister()) return;
  try {
    const created = await createAdminUser({
      emp_no: registerForm.emp_no,
      name: registerForm.name,
      email: registerForm.email,
      dept_name: registerForm.dept,
      rank_name: registerForm.rank,
      work: registerForm.work,
    });
    setUsers((prev) => [{
      users_id: created.users_id,
      emp_no: created.emp_no,
      name: created.name,
      email: created.email,
      dept: created.dept_name,
      rank: created.rank_name,
      work: created.work,
      status: created.status,
    }, ...prev]);
    setCurrentPage(1);
    setRegisterForm(INIT_REGISTER);
    setRegisterErrors(INIT_ERRORS);
    setShowRegisterModal(false);
  } catch (e: any) {
    alert(e?.response?.data?.error ?? "등록에 실패했습니다.");
  }
};

  const closeRegisterModal = () => {
    setShowRegisterModal(false);
    setRegisterForm(INIT_REGISTER);
    setRegisterErrors(INIT_ERRORS);
  };

  // 공통 모달 레이아웃 
  const ConfirmModal = ({
    message, onConfirm, onCancel,
  }: { message: React.ReactNode; onConfirm: () => void; onCancel: () => void }) => (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
      <div className="bg-white rounded-xl p-10 w-[560px] shrink-0">
        <p className="text-[16px] text-[#623FB5] font-medium text-center leading-relaxed mb-10">{message}</p>
        <div className="flex gap-3">
          <button onClick={onCancel}
            className="flex-1 py-3 border border-[#E5E5E5] rounded-md text-[15px] text-[#0A0A0A] hover:bg-[#F6F5FA] transition-colors">
            취소
          </button>
          <button onClick={onConfirm}
            className="flex-1 py-3 bg-[#623FB5] text-white rounded-md text-[15px] hover:opacity-90 transition-opacity">
            확인
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F6F5FA] flex flex-col">


      <div className="flex flex-1 p-4 w-full mx-auto w-full">
        <div className="flex-1 bg-[#FDFDFD] rounded-2xl flex gap-[14px] p-6 overflow-hidden">

        {/* 왼쪽: 사용자 목록 */}
        <div className="flex-1 flex flex-col">
          <h1 className="text-[24px] font-semibold text-[#0A0A0A] mb-1">사용자 관리</h1>
          <p className="text-[15px] text-[#969696] mb-6">사용자 등록 및 목록 조회할 수 있습니다.</p>

          {/* 검색 */}
          <div className="flex items-center border border-[#E5E5E5] rounded-md px-4 mb-4 bg-white">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="이름, 사원번호, 이메일 검색"
              className="flex-1 py-3 text-[15px] outline-none"
            />
            <svg className="w-5 h-5 text-[#969696]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
            </svg>
          </div>

          {/* 필터 + 버튼 */}
          <div className="flex items-center gap-3 mb-5">
            <span className="text-[15px] text-[#0A0A0A]">부서</span>
            <Dropdown options={["전체", ...DEPT_OPTIONS]} value={deptFilter} onChange={setDeptFilter} dropdownClassName="w-32" />
            <span className="text-[15px] text-[#0A0A0A]">직급</span>
            <Dropdown options={["전체", ...RANK_OPTIONS]} value={rankFilter} onChange={setRankFilter} dropdownClassName="w-32" />
            <span className="text-[15px] text-[#0A0A0A]">상태</span>
            <Dropdown options={["전체", "재직", "휴직", "퇴사"]} value={statusFilter} onChange={setStatusFilter} dropdownClassName="w-32" />
            <div className="flex gap-2 ml-auto">
              <button
                onClick={() => setShowRegisterModal(true)}
                className="px-5 py-3 bg-[#623FB5] text-white text-[15px] rounded-md hover:opacity-90 transition-opacity"
              >
                등록
              </button>
              <button
                onClick={() => selectedIds.length > 0 && setShowDeleteModal(true)}
                className={`px-5 py-3 text-[15px] rounded-md text-white transition-all ${
                  selectedIds.length > 0
                    ? "bg-[#623FB5] hover:opacity-90 cursor-pointer"
                    : "bg-[#969696] cursor-not-allowed"
                }`}
              >
                삭제
              </button>
            </div>
          </div>
          {/* 로딩 */}
          {isLoading && (
            <p className="text-center py-4 text-[#969696]">불러오는 중...</p>
          )}

          {/* 테이블 */}
          <div className="flex-1 overflow-auto">
            <table className="w-full text-[15px]">
              <thead>
                <tr className="bg-[#F4F5F8] border border-[#969696]">
                  <th className="p-3 w-10">
                    <Checkbox
                      checked={pagedUsers.length > 0 && pagedUsers.every((u) => selectedIds.includes(u.users_id))}
                      onChange={(e) => handleSelectAll(e.target.checked)}
                    />
                  </th>
                  {["사원번호", "이름", "이메일", "부서", "직급", "직무", "상태", "관리"].map((col) => (
                    <th key={col} className="p-3 text-left font-medium text-[#0A0A0A]">{col}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-20">
                      <div className="flex flex-col items-center gap-6">
                        <svg width="100" height="100" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
                          <circle cx="50" cy="50" r="44" stroke="#ADADAD" strokeWidth="6" />
                          <rect x="46" y="24" width="8" height="38" rx="4" fill="#ADADAD" />
                          <rect x="46" y="70" width="8" height="8" rx="4" fill="#ADADAD" />
                        </svg>
                        <p className="text-[17px] text-[#ADADAD]">존재하지 않는 사용자입니다.</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  pagedUsers.map((u) => (
                    <tr key={u.users_id} className="border-b border-[#E5E5E5] hover:bg-[#F6F5FA] transition-colors">
                      <td className="p-3">
                        <Checkbox
                          checked={selectedIds.includes(u.users_id)}
                          onChange={(e) => handleSelectOne(u.users_id, e.target.checked)}
                        />
                      </td>
                      <td className="p-3">{u.emp_no}</td>
                      <td className="p-3">{u.name}</td>
                      <td className="p-3">{u.email}</td>
                      <td className="p-3">{u.dept}</td>
                      <td className="p-3">{u.rank}</td>
                      <td className="p-3">{u.work}</td>
                      <td className="p-3">{STATUS_LABELS[u.status] ?? "재직"}</td>
                      <td className="p-3">
                        <button
                          onClick={() => handleSelectUser(u)}
                          className="px-3 py-1 bg-[#F4F5F8] text-[#0A0A0A] text-[13px] rounded-md border border-[#969696] hover:opacity-80 transition-opacity"
                        >
                          상세보기
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 페이지네이션 */}
          <Pagination
            currentPage={currentPage}
            totalPages={totalPages}
            onPageChange={setCurrentPage}
            className="mt-[35px]"
          />
        </div>

        {/* 오른쪽: 상세 패널 */}
        <div className="w-[560px] bg-white rounded-xl flex flex-col overflow-y-auto border border-[#141414]">
          {selectedUser === null ? (
            // 기본 상태: 사용자 미선택
            <div className="flex flex-col items-center justify-center flex-1 gap-4 text-center">
              <div className="w-20 h-20 rounded-full bg-[#F6F5FA] flex items-center justify-center">
                <svg className="w-10 h-10 text-[#C4C4C4]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                </svg>
              </div>
              <div>
                <p className="text-[17px] font-medium text-[#0A0A0A] mb-2">사용자를 선택하세요</p>
                <p className="text-[13px] text-[#969696] leading-relaxed">
                  목록에서 상세보기 버튼을 클릭하면<br />여기에서 정보를 수정할 수 있습니다.
                </p>
              </div>
            </div>
          ) : (
            // 사용자 상세 폼
            <div className="flex flex-col pt-[26px] px-[14px] pb-[16px]">
              {/* 헤더: 이름 + 버튼 */}
              <div className="flex justify-between items-start">
                <div>
                  <h2 className="text-[24px] font-semibold text-[#0A0A0A]">{selectedUser.name}</h2>
                  <p className="text-[13px] text-[#969696] mt-[24px]">
                    {selectedUser.emp_no} · {selectedUser.dept} · {selectedUser.rank}
                  </p>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowSaveModal(true)}
                    className="px-4 py-2 bg-[#623FB5] text-white text-[13px] rounded-md hover:opacity-90 transition-opacity"
                  >
                    저장
                  </button>
                  <button
                    onClick={() => setShowResetPwModal(true)}
                    className="flex items-center gap-1 px-3 py-2 bg-[#623FB5] text-white text-[13px] rounded-md hover:opacity-90 transition-opacity"
                  >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    비밀번호 초기화
                  </button>
                </div>
              </div>

              {/* 기본 정보 */}
              <div className="h-px bg-[#E0E0E0] mt-[14px] mx-[-14px]" />
              <p className="text-[13px] text-[#969696] mt-[26px] mb-[14px]">기본 정보</p>
              <div className="flex flex-col gap-[7px]">
                <label className="text-[13px] text-[#0A0A0A]">사원번호</label>
                <input value={editForm.emp_no} onChange={(e) => setEditForm({ ...editForm, emp_no: e.target.value })}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
              </div>
              <div className="flex gap-[33px] mt-[32px]">
                <div className="flex flex-col gap-[7px] flex-1">
                  <label className="text-[13px] text-[#0A0A0A]">이름</label>
                  <input value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                    className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                </div>
                <div className="flex flex-col gap-[7px] flex-1">
                  <label className="text-[13px] text-[#0A0A0A]">이메일</label>
                  <input value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })}
                    className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                </div>
              </div>

              {/* 소속 정보 */}
              <div className="h-px bg-[#E0E0E0] mt-[14px] mx-[-14px]" />
              <p className="text-[13px] text-[#969696] mt-[26px] mb-[14px]">소속 정보</p>
              <div className="flex gap-[33px]">
                <div className="flex flex-col gap-[7px] flex-1">
                  <label className="text-[13px] text-[#0A0A0A]">부서</label>
                  <Dropdown options={DEPT_OPTIONS} value={editForm.dept} onChange={(v) => setEditForm({ ...editForm, dept: v })} />
                </div>
                <div className="flex flex-col gap-[7px] flex-1">
                  <label className="text-[13px] text-[#0A0A0A]">직급</label>
                  <Dropdown options={RANK_OPTIONS} value={editForm.rank} onChange={(v) => setEditForm({ ...editForm, rank: v })} />
                </div>
              </div>
              <div className="flex gap-[33px] mt-[32px]">
                <div className="flex flex-col gap-[7px] flex-1">
                  <label className="text-[13px] text-[#0A0A0A]">직무</label>
                  <input value={editForm.work} onChange={(e) => setEditForm({ ...editForm, work: e.target.value })}
                    className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                </div>
                <div className="flex flex-col gap-[7px] flex-1">
                  <label className="text-[13px] text-[#0A0A0A]">재직 상태</label>
                  <Dropdown options={["재직", "휴직", "퇴사"]} value={editForm.status} onChange={(v) => setEditForm({ ...editForm, status: v as "재직" | "휴직" | "퇴사" })} />
                </div>
              </div>

              {/* 프로젝트 목록 */}
              <div className="h-px bg-[#E0E0E0] mt-[14px] mx-[-14px]" />
              <div className="border border-[#969696] rounded-xl overflow-hidden mt-[26px]">
                <div className="px-4 py-3">
                  <p className="text-[13px] text-[#969696]">프로젝트 목록</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] whitespace-nowrap">
                    <thead className="bg-[#F4F5F8] border-y border-[#969696]">
                      <tr>
                        {["", "프로젝트명", "생성시기", "생성자", "참여자"].map((col) => (
                          <th key={col} className="px-3 py-2 text-left font-medium text-[#0A0A0A]">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {userProjects.map((project) => (
                        <tr key={project.id} className="border-t border-[#E5E5E5]">
                          <td className="px-3 py-2 text-[#969696]">{project.id}</td>
                          <td className="px-3 py-2">{project.project_name}</td>
                          <td className="px-3 py-2">{project.created_at}</td>
                          <td className="px-3 py-2">{project.created_by}</td>
                          <td className="px-3 py-2">{project.participants}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── 사용자 등록 모달 ── */}
      {showRegisterModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center">
          <div className="bg-white rounded-xl p-8 w-[480px] max-h-[90vh] overflow-y-auto">
            <div className="flex items-center gap-2 mb-6">
              <img src={logo} alt="logo" className="w-7 h-7 object-contain" />
              <span className="text-[18px] font-semibold text-[#0A0A0A]">회의피하지마</span>
            </div>

            <div className="flex flex-col gap-4">
              {/* 사원번호 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">사원번호 <span className="text-red-500">*</span></label>
                <input value={registerForm.emp_no}
                  onChange={(e) => setRegisterForm({ ...registerForm, emp_no: e.target.value })}
                  placeholder="예: 2026-HR-3" maxLength={20}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-blue-500">{registerErrors.emp_no}</span>
                  <span className="text-[12px] text-[#969696]">{registerForm.emp_no.length}/20</span>
                </div>
              </div>

              {/* 이름 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">이름 <span className="text-red-500">*</span></label>
                <input value={registerForm.name}
                  onChange={(e) => setRegisterForm({ ...registerForm, name: e.target.value })}
                  placeholder="이름" maxLength={30}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-blue-500">{registerErrors.name}</span>
                  <span className="text-[12px] text-[#969696]">{registerForm.name.length}/30</span>
                </div>
              </div>

              {/* 이메일 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">이메일 <span className="text-red-500">*</span></label>
                <input value={registerForm.email}
                  onChange={(e) => setRegisterForm({ ...registerForm, email: e.target.value })}
                  placeholder="예: hpm123@company.com" maxLength={50}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-blue-500">{registerErrors.email}</span>
                  <span className="text-[12px] text-[#969696]">{registerForm.email.length}/50</span>
                </div>
              </div>

              {/* 비밀번호 (고정, 수정 불가) */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">비밀번호</label>
                <input value="abc123" disabled
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] bg-[#F4F5F8] text-[#969696] cursor-not-allowed" />
              </div>

              {/* 부서 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">부서 <span className="text-red-500">*</span></label>
                <input value={registerForm.dept}
                  onChange={(e) => setRegisterForm({ ...registerForm, dept: e.target.value })}
                  placeholder="예: 개발팀" maxLength={50}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-blue-500">{registerErrors.dept}</span>
                  <span className="text-[12px] text-[#969696]">{registerForm.dept.length}/50</span>
                </div>
              </div>

              {/* 직급 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">직급 <span className="text-red-500">*</span></label>
                <input value={registerForm.rank}
                  onChange={(e) => setRegisterForm({ ...registerForm, rank: e.target.value })}
                  placeholder="예: 대리" maxLength={5}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-blue-500">{registerErrors.rank}</span>
                  <span className="text-[12px] text-[#969696]">{registerForm.rank.length}/5</span>
                </div>
              </div>

              {/* 직무 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">직무 <span className="text-red-500">*</span></label>
                <input value={registerForm.work}
                  onChange={(e) => setRegisterForm({ ...registerForm, work: e.target.value })}
                  placeholder="예: 백엔드 개발" maxLength={30}
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] outline-none focus:border-[#623FB5] transition-colors" />
                <div className="flex justify-between items-center">
                  <span className="text-[12px] text-blue-500">{registerErrors.work}</span>
                  <span className="text-[12px] text-[#969696]">{registerForm.work.length}/30</span>
                </div>
              </div>

              {/* 재직 상태 */}
              <div className="flex flex-col gap-1">
                <label className="text-[14px] font-medium text-[#0A0A0A]">재직 상태</label>
                <input value="재직" disabled
                  className="w-full px-4 py-3 border border-[#E5E5E5] rounded-md text-[15px] bg-[#F4F5F8] text-[#969696] cursor-not-allowed" />
              </div>
            </div>

            <div className="flex gap-3 mt-6">
              <button onClick={closeRegisterModal}
                className="flex-1 py-3 border border-[#E5E5E5] rounded-md text-[15px] text-[#0A0A0A] hover:bg-[#F6F5FA] transition-colors">
                취소
              </button>
              <button onClick={handleRegisterSubmit}
                className="flex-1 py-3 rounded-md text-[15px] text-white bg-[#623FB5] hover:opacity-90 transition-opacity">
                사용자 등록
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 삭제 확인 모달 ── */}
      {showDeleteModal && (
        <ConfirmModal
          message={<>해당 사용자를 삭제하시겠습니까?<br />확인 버튼을 누를 경우<br />해당 사용자의 정보가 모두 삭제됩니다.</>}
          onConfirm={handleDelete}
          onCancel={() => setShowDeleteModal(false)}
        />
      )}

      {/* ── 저장 확인 모달 ── */}
      {showSaveModal && (
        <ConfirmModal
          message={<>수정하신 내용으로 변경됩니다.<br />수정하시겠습니까?</>}
          onConfirm={handleSave}
          onCancel={() => setShowSaveModal(false)}
        />
      )}

      {/* ── 비밀번호 초기화 모달 ── */}
      {showResetPwModal && (
        <ConfirmModal
          message={<>비밀번호를 abc123으로 초기화하시겠습니까?<br />확인 클릭 시 해당 사용자의<br />비밀번호가 abc123으로 변경됩니다.</>}
          onConfirm={async () => {
            if (selectedUser) {
              try {
                await resetAdminUserPassword(selectedUser.users_id);
              } catch {
                alert("비밀번호 초기화에 실패했습니다.");
              }
            }
            setShowResetPwModal(false);
          }}
          onCancel={() => setShowResetPwModal(false)}
        />
      )}
    </div>
  );
}
