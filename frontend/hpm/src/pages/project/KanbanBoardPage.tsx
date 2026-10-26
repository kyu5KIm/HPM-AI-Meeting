import { useEffect, useMemo, useState } from "react";
import title from "../../assets/kanban/title.png";
import KanbanColumn from "../../components/project/KanbanColumn";
import KanbanTaskModal from "../../components/project/KanbanTaskModal";
import {
  emptyKanbanForm,
  KANBAN_COLUMNS,
  KANBAN_PRIORITIES,
  toKanbanFormValues,
} from "../../constants/kanban";
import { useAuth } from "../../context/AuthContext";
import {
  createProjectJiraIssue,
  getProjectDetail,
  getProjectJiraBoard,
  updateProjectJiraIssue,
  updateProjectJiraIssueStatus,
  rankProjectJiraIssue,
  type JiraParentOption,
  type ProjectMember,
  type ProjectJiraBoard,
  type JiraBoardColumn,
} from "../../services/meeting";
import type {
  KanbanColumnId,
  KanbanColumnConfig,
  KanbanModalState,
  KanbanPriority,
  KanbanTask,
} from "../../types/kanban";

// ─── [BUG FIX] 사용되지 않던 상수 3개 제거 ──────────────────────────────
// COLUMN_LEFT_START, COLUMN_STEP, BOARD_MIN_WIDTH → 파일 내 어디서도 참조되지 않음
// ─────────────────────────────────────────────────────────────────────────

const mapJiraPriority = (priority: string): KanbanPriority => {
  const normalized = priority.toLowerCase();
  if (normalized.includes("highest")) return KANBAN_PRIORITIES[4];
  if (normalized.includes("high")) return KANBAN_PRIORITIES[3];
  if (normalized.includes("lowest")) return KANBAN_PRIORITIES[0];
  if (normalized.includes("low")) return KANBAN_PRIORITIES[1];

  return KANBAN_PRIORITIES[2];
};

const mapKanbanPriorityToJira = (priority: KanbanPriority | "") => {
  const index = KANBAN_PRIORITIES.indexOf(priority as KanbanPriority);
  return ["Lowest", "Low", "Medium", "High", "Highest"][index] || "Medium";
};

const isEpicTask = (task: KanbanTask) => {
  const issueType = (task.issueType || "").toLowerCase();
  return (
    issueType === "epic" ||
    issueType.includes("에픽") ||
    task.issueTypeHierarchyLevel === 1
  );
};

const toKanbanColumns = (columns: JiraBoardColumn[]): KanbanColumnConfig[] => {
  if (columns.length === 0) return KANBAN_COLUMNS;

  // ─── [BUG FIX] COLUMN_LEFT_START / COLUMN_STEP 상수 대신 인라인 값 사용 ──
  return columns.map((column, index) => ({
    id: column.id,
    label: column.label,
    left: 68 + index * 372,
    height: 742,
    statusNames: column.status_names,
  }));
};

const jiraBoardToTasks = (board: ProjectJiraBoard, columns: KanbanColumnConfig[]): KanbanTask[] => {
  let nextId = 1;

  return columns.flatMap((column) =>
    (board.issues[column.id] ?? []).map((issue) => ({
      id: nextId++,
      columnId: column.id,
      title: issue.title,
      description: issue.description,
      category: issue.parent_title || "Epic 없음",
      dueDate: issue.due_date || "",
      startDate: issue.created ? issue.created.slice(0, 10) : "",
      assignee: issue.assignee || "-",
      priority: mapJiraPriority(issue.priority),
      code: issue.issue_key,
      owner: issue.assignee || "-",
      parentKey: issue.parent_key || "",
      issueType: issue.issue_type || "",
      issueTypeIconUrl: issue.issue_type_icon_url || "",
      issueTypeHierarchyLevel: issue.issue_type_hierarchy_level ?? null,
    })),
  );
};

const getApiErrorMessage = (error: unknown) => {
  const data = (error as { response?: { data?: { error?: string; detail?: string } } }).response?.data;
  return data?.error || data?.detail || "Jira 칸반을 불러오지 못했습니다.";
};


export default function KanbanBoardPage() {
  const { projectId, projectName, user } = useAuth();
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [boardColumns, setBoardColumns] = useState<KanbanColumnConfig[]>(KANBAN_COLUMNS);
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [modal, setModal] = useState<KanbanModalState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [draggingTask, setDraggingTask] = useState<KanbanTask | null>(null);
  const [canManageJira, setCanManageJira] = useState(false);
  const [jiraParentOptions, setJiraParentOptions] = useState<JiraParentOption[]>([]);

  useEffect(() => {
    if (!user || !projectId) {
      setTasks([]);
      setBoardColumns(KANBAN_COLUMNS);
      setJiraParentOptions([]);
      setCanManageJira(false);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    getProjectJiraBoard(projectId)
      .then((board) => {
        console.log("[KANBAN] board.columns:", board.columns);
        console.log("[KANBAN] board.issues keys:", Object.keys(board.issues || {}));
        const nextColumns = toKanbanColumns(board.columns || []);
        console.log("[KANBAN] nextColumns:", nextColumns.map(c => c.id));
        const nextTasks = jiraBoardToTasks(board, nextColumns);
        console.log("[KANBAN] tasks 수:", nextTasks.length);
        setBoardColumns(nextColumns);
        setTasks(nextTasks);
        setJiraParentOptions(board.parent_options || []);
        setCanManageJira(Boolean(board.can_manage));
      })
      .catch((error) => {
        console.error("Jira 칸반 조회 실패:", error);
        setBoardColumns(KANBAN_COLUMNS);
        setTasks([]);
        setJiraParentOptions([]);
        setCanManageJira(false);
        setError(getApiErrorMessage(error));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [projectId, user]);

  useEffect(() => {
    if (!projectId) {
      setMembers([]);
      return;
    }

    getProjectDetail(projectId)
      .then((project) => setMembers(project.members || []))
      .catch((error) => {
        console.error("프로젝트 구성원 조회 실패:", error);
        setMembers([]);
      });
  }, [projectId]);

  const tasksByColumn = useMemo(() => {
    const result = boardColumns.reduce<Record<KanbanColumnId, KanbanTask[]>>(
      (acc, column) => {
        acc[column.id] = tasks.filter((task) => task.columnId === column.id);
        return acc;
      },
      {},
    );
    console.log("[KANBAN] tasksByColumn:", Object.entries(result).map(([k,v]) => `${k}:${v.length}개`));
    return result;
  }, [boardColumns, tasks]);

  const assigneeOptions = useMemo(
    () =>
      members.map((member) => ({
        value: String(member.user_id),
        label: member.name,
      })),
    [members],
  );

  const parentOptions = useMemo(
    () => {
      const options = new Map<string, string>();

      jiraParentOptions.forEach((option) => {
        if (!option.issue_key) return;
        options.set(option.issue_key, option.title || option.issue_key);
      });

      tasks.filter(isEpicTask).forEach((task) => {
        if (!task.code) return;
        options.set(task.code, task.title || task.code);
      });

      return Array.from(options, ([value, label]) => ({ value, label }));
    },
    [jiraParentOptions, tasks],
  );

  const modalParentOptions = useMemo(
    () => {
      if (!modal || modal.mode !== "edit" || !modal.taskId) return parentOptions;

      const editingTask = tasks.find((task) => task.id === modal.taskId);
      return parentOptions.filter((option) => option.value !== editingTask?.code);
    },
    [modal, parentOptions, tasks],
  );

  const openAddModal = (columnId: KanbanColumnId) => {
    if (!canManageJira) return;

    const defaultAssignee = assigneeOptions[0];
    setModal({
      mode: "add",
      columnId,
      values: {
        ...emptyKanbanForm(),
        assigneeId: defaultAssignee?.value || "",
        assignee: defaultAssignee?.label || "",
      },
    });
  };

  const openEditModal = (task: KanbanTask) => {
    if (!canManageJira) return;

    const matchedAssignee = assigneeOptions.find((option) => option.label === task.assignee);
    setModal({
      mode: "edit",
      columnId: task.columnId,
      taskId: task.id,
      values: {
        ...toKanbanFormValues(task),
        assigneeId: matchedAssignee?.value || "",
      },
    });
  };

  const closeModal = () => setModal(null);

  // ─── [BUG FIX] 핵심 구조 버그 수정 ──────────────────────────────────────
  // 원본: closeModal() 선언 직후 함수 body 없이 코드가 떠있었음
  //   const task = draggingTask;        ← 이 줄이 함수 밖에 존재
  //   setDraggingTask(null);            ← 컴포넌트 본문에서 직접 실행됨 (런타임 오류)
  //   if (!task || ...) return;
  //   await updateProjectJiraIssueStatus(...)  ← async/await가 함수 밖에서 쓰임
  //   };                                ← 매달린 닫는 중괄호
  // 원인: handleDropTask 함수 선언부(`const handleDropTask = async (targetColumnId) => {`)가
  //       누락되어 함수 body가 전역 스코프에 노출된 상태였음
  // ─────────────────────────────────────────────────────────────────────────
  // 드래그한 카드를 targetColumn의 beforeTask 앞(없으면 맨 끝)에 놓고,
  // 컬럼이 바뀌면 상태 변경, 위치가 바뀌면 순서(Rank) 변경을 Jira에 반영한다.
  const reorderAndPersist = async (
    task: KanbanTask,
    targetColumnId: KanbanColumnId,
    beforeTask: KanbanTask | null,
  ) => {
    if (!projectId) return;

    const fromColumnId = task.columnId;
    const snapshot = tasks; // 실패 시 롤백용

    // 1) 낙관적 UI 업데이트 (옮길 카드를 빼고 원하는 위치에 다시 삽입)
    const without = tasks.filter((t) => t.id !== task.id);
    const movingUpdated = { ...task, columnId: targetColumnId };
    let next: KanbanTask[];
    if (!beforeTask) {
      next = [...without, movingUpdated]; // 컬럼 맨 끝
    } else {
      const idx = without.findIndex((t) => t.id === beforeTask.id);
      next = [...without];
      next.splice(idx, 0, movingUpdated); // beforeTask 앞
    }
    setTasks(next);

    try {
      // 2) 컬럼(상태)이 바뀌었으면 상태 전환
      if (fromColumnId !== targetColumnId) {
        const targetStatusNames =
          boardColumns.find((c) => c.id === targetColumnId)?.statusNames || [];
        await updateProjectJiraIssueStatus(projectId, task.code, targetColumnId, targetStatusNames);
      }

      // 3) 순서(Rank) 반영 — 같은 컬럼 안 이웃 기준
      const columnTasks = next.filter((t) => t.columnId === targetColumnId);
      const idx = columnTasks.findIndex((t) => t.id === task.id);
      const belowNeighbor = columnTasks[idx + 1]; // 내 아래 카드
      const aboveNeighbor = columnTasks[idx - 1]; // 내 위 카드

      if (belowNeighbor) {
        await rankProjectJiraIssue(projectId, task.code, { beforeIssueKey: belowNeighbor.code });
      } else if (aboveNeighbor) {
        await rankProjectJiraIssue(projectId, task.code, { afterIssueKey: aboveNeighbor.code });
      }
    } catch (error) {
      console.error("카드 이동 실패:", error);
      setTasks(snapshot); // 롤백
      alert("카드 이동에 실패했습니다.");
    }
  };

  const handleDropOnCard = (targetTask: KanbanTask) => {
    const task = draggingTask;
    setDraggingTask(null);
    if (!task || task.id === targetTask.id) return;
    reorderAndPersist(task, targetTask.columnId, targetTask);
  };

  const handleDropOnColumn = (columnId: KanbanColumnId) => {
    const task = draggingTask;
    setDraggingTask(null);
    if (!task) return;
    reorderAndPersist(task, columnId, null);
  };

  // ─── [BUG FIX] handleCardDragStart / handleCardDragEnd 선언 추가 ─────────
  // 원본에서 이 두 함수는 TS6133(선언됐으나 사용 안 됨) 오류를 내고 있었는데,
  // 실제로는 KanbanColumn에 onCardDragStart / onCardDragEnd prop으로 전달돼야 함.
  // KanbanColumn Props 타입에 이미 optional로 정의되어 있으므로 연결만 추가.
  // ─────────────────────────────────────────────────────────────────────────
  const handleCardDragStart = (task: KanbanTask) => {
    setDraggingTask(task);
  };

  const handleCardDragEnd = () => {
    setDraggingTask(null);
  };

  const submitTask = async () => {
    if (!canManageJira) return;
    if (!modal || !modal.values.title.trim() || !modal.values.priority || saving) return;

    if (!projectId) {
      alert("프로젝트를 먼저 선택해 주세요.");
      return;
    }

    if (modal.mode === "edit" && modal.taskId) {
      const currentTask = tasks.find((task) => task.id === modal.taskId);
      if (!currentTask) return;

      setSaving(true);
      try {
        const updatePayload: Parameters<typeof updateProjectJiraIssue>[2] = {
          title: modal.values.title.trim(),
          description: modal.values.description,
          due_date: modal.values.dueDate || null,
          priority: mapKanbanPriorityToJira(modal.values.priority),
          parent_key: modal.values.parentKey || null,
        };
        if (modal.values.assigneeId) {
          updatePayload.assignee_user_id = Number(modal.values.assigneeId);
        }

        await updateProjectJiraIssue(projectId, currentTask.code, updatePayload);

        const board = await getProjectJiraBoard(projectId);
        const nextColumns = toKanbanColumns(board.columns || []);
        setBoardColumns(nextColumns);
        setTasks(jiraBoardToTasks(board, nextColumns));
        setJiraParentOptions(board.parent_options || []);
        setCanManageJira(Boolean(board.can_manage));
        closeModal();
      } catch (error) {
        console.error("Jira 업무 수정 실패:", error);
        alert("Jira 업무 수정에 실패했습니다.");
      } finally {
        setSaving(false);
      }
      return;
    }

    setSaving(true);
    try {
      const result = await createProjectJiraIssue(projectId, {
        title: modal.values.title.trim(),
        description: modal.values.description,
        due_date: modal.values.dueDate || undefined,
        priority: mapKanbanPriorityToJira(modal.values.priority),
        column_id: modal.columnId,
        assignee_user_id: modal.values.assigneeId ? Number(modal.values.assigneeId) : undefined,
        parent_key: modal.values.parentKey || undefined,
        target_status_names: boardColumns.find((column) => column.id === modal.columnId)?.statusNames || [],
      });
      const optimisticTask: KanbanTask = {
        id: Math.max(0, ...tasks.map((task) => task.id)) + 1,
        columnId: modal.columnId,
        title: modal.values.title.trim(),
        description: modal.values.description,
        category: modal.values.category || "상위 업무 없음",
        dueDate: modal.values.dueDate,
        startDate: modal.values.startDate,
        assignee: modal.values.assignee,
        priority: modal.values.priority as KanbanPriority,
        code: result.issue_key,
        owner: modal.values.assignee || "-",
        parentKey: modal.values.parentKey,
        issueType: "",
        issueTypeIconUrl: "",
        issueTypeHierarchyLevel: null,
      };
      const board = await getProjectJiraBoard(projectId);
      const nextColumns = toKanbanColumns(board.columns || []);
      const nextTasks = jiraBoardToTasks(board, nextColumns);
      if (!nextTasks.some((task) => task.code === result.issue_key)) {
        nextTasks.unshift(optimisticTask);
      }
      setBoardColumns(nextColumns);
      setTasks(nextTasks);
      setJiraParentOptions(board.parent_options || []);
      setCanManageJira(Boolean(board.can_manage));
      closeModal();
    } catch (error) {
      console.error("Jira 업무 생성 실패:", error);
      alert("Jira 업무 생성에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col bg-[#FFFDFD] pb-[32px] pt-[32px]">
      <div className="mx-[68px] mb-[12px]">
        <div
          className="w-full h-[200px] flex flex-col justify-center px-[64px] rounded-[15px] overflow-hidden"
          style={{
            backgroundImage: `url(${title})`,
            backgroundSize: "cover",
            backgroundRepeat: "no-repeat",
            backgroundPosition: "center",
          }}
        >
          <div className="flex flex-col gap-[14px]">
              <h1 className="text-[32px] font-medium text-[#141414]">대시보드</h1>
            <div className="flex flex-col gap-[0px]">
              <p className="text-[17px] text-[#141414]">
                현재 프로젝트
              </p>
              <p className="text-[20px] text-[#6A1FEB] font-medium">
                {projectName || "프로젝트 없음"}
              </p>
            </div>
          </div>
        </div>
        {!canManageJira && !loading && !error ? (
          <div className="text-[14px] font-medium text-[#969696] mt-[12px]">
            Jira 미연동 계정은 조회만 가능합니다. 업무 추가와 이동은 Jira 연동 및 프로젝트 접근 권한이 필요합니다.
          </div>
        ) : null}
      </div>

      {/* ─── [BUG FIX] JSX 구조 버그 수정 ────────────────────────────────────
          원본: error div와 canManageJira div가 </section> 닫힘 없이 떠있었고
                KanbanColumn 렌더링 후 갑자기 </section>이 등장해 구조 불일치 발생
          수정: 전체를 relative 컨테이너로 감싸고 section 태그 오용 제거
          ────────────────────────────────────────────────────────────────── */}
      <div className="relative mt-[20px]">
        {error ? (
          <div className="ml-[68px] text-[14px] font-medium leading-[1.2] text-[#B42318]">
            {error}
          </div>
        ) : null}
        {!loading && !error ? boardColumns.map((column) => (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={tasksByColumn[column.id]}
            onAddTask={openAddModal}
            onEditTask={openEditModal}
            onCardDragStart={handleCardDragStart}
            onCardDragEnd={handleCardDragEnd}
            onDropOnColumn={handleDropOnColumn}
            onDropOnCard={handleDropOnCard}
            draggingTaskId={draggingTask?.id ?? null}
            canManage={canManageJira}
          />
        )) : null}
      </div>

      {modal ? (
        <KanbanTaskModal
          modal={modal}
          onCancel={closeModal}
          onChange={(values) => setModal({ ...modal, values })}
          onSubmit={submitTask}
          assigneeOptions={assigneeOptions}
          parentOptions={modalParentOptions}
        />
      ) : null}
    </div>
  );
}
