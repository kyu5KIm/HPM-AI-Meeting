import { useState, type CSSProperties, type DragEvent } from "react";
import plusIcon from "../../assets/kanban/plus.png";
import {
  KANBAN_CARD_GAP,
  KANBAN_COLUMN_TOP,
  KANBAN_FIRST_CARD_TOP,
} from "../../constants/kanban";
import type { KanbanColumnConfig, KanbanColumnId, KanbanTask } from "../../types/kanban";
import KanbanCard, { type KanbanDropSide } from "./KanbanCard";

const cn = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(" ");

// 카드가 들어갈 자리를 보여주는 선 (Jira처럼 왼쪽에 원이 붙은 가로선)
function DropIndicator({ edge }: { edge: "top" | "bottom" }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute left-[23px] z-10 h-[2px] w-[306px] bg-[#623FB5]",
        edge === "top" ? "top-[-10px]" : "bottom-[-10px]",
      )}
    >
      <span className="absolute left-[-4px] top-[-3px] size-[8px] rounded-full border-2 border-[#623FB5] bg-[#FFFDFD]" />
    </div>
  );
}

interface AddTaskButtonProps {
  className: string;
  onClick: () => void;
  style?: CSSProperties;
}

function AddTaskButton({ className, onClick, style }: AddTaskButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={style}
      className={cn(
        "mt-[23px] ml-[23px] flex items-center gap-[8px] rounded-[5px] border-0 bg-transparent p-0 transition-all duration-150 ease-out hover:text-[#6A1FEB] hover:opacity-80 active:scale-[0.97]",
        className,
      )}
    >
      <img alt="" aria-hidden="true" className="size-[12px] object-contain" src={plusIcon} />
      <span className="text-[15px] font-normal leading-[1.2] text-[#141414]">
        추가 하기
      </span>
    </button>
  );
}

interface EmptyAddCardProps {
  onClick: () => void;
}

function EmptyAddCard({ onClick }: EmptyAddCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className=" flex ml-[23px] h-[142px] w-[306px] flex-col items-center justify-center gap-[12px] rounded-[10px] border border-dashed border-[#C4B6E5] bg-[#FFFDFD] p-0 text-center transition-all duration-150 ease-out hover:border-[#6A1FEB] hover:bg-[#F4F5F8] hover:shadow-[1px_1px_14px_4px_rgba(98,63,181,0.18)] active:scale-[0.985]"
    >
      <img alt="" aria-hidden="true" className="size-[14px] object-contain" src={plusIcon} />
      <span className="text-[15px] font-normal leading-[1.2] text-[#141414]">
        추가 하기
      </span>
    </button>
  );
}

interface KanbanColumnProps {
  column: KanbanColumnConfig;
  tasks: KanbanTask[];
  onAddTask: (columnId: KanbanColumnId) => void;
  onEditTask: (task: KanbanTask) => void;
  onCardDragStart?: (task: KanbanTask) => void;
  onCardDragEnd?: () => void;
  // beforeTask 앞에 놓기. null이면 컬럼 맨 끝
  onDropAt?: (columnId: KanbanColumnId, beforeTask: KanbanTask | null) => void;
  // 보드 전체에서 표시선은 한 컬럼에만 그린다. 상위가 마지막으로 dragover된 컬럼을 관리한다.
  isDropTarget?: boolean;
  onColumnDragOver?: (columnId: KanbanColumnId) => void;
  draggingTaskId?: number | null;
  canManage?: boolean;
}

export default function KanbanColumn({
  column,
  tasks,
  onAddTask,
  onEditTask,
  onCardDragStart,
  onCardDragEnd,
  onDropAt,
  isDropTarget = true,
  onColumnDragOver,
  draggingTaskId = null,
  canManage = true,
}: KanbanColumnProps) {

  const hasTasks = tasks.length > 0;
  // 드래그 중인 카드가 들어갈 자리(0 ~ tasks.length). "카드 i 뒤"와 "카드 i+1 앞"은 같은 자리로 본다.
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  // 같은 컬럼에서 자기 바로 앞·뒤 자리는 순서가 그대로라 표시하지 않는다.
  const draggingIndex = tasks.findIndex((task) => task.id === draggingTaskId);
  const isNoopIndex = (index: number) =>
    draggingIndex >= 0 && (index === draggingIndex || index === draggingIndex + 1);
  const activeDropIndex =
    isDropTarget && draggingTaskId !== null && dropIndex !== null && !isNoopIndex(dropIndex)
      ? dropIndex
      : null;

  const updateDropIndex = (index: number) => {
    if (dropIndex !== index) setDropIndex(index);
    if (!isDropTarget) onColumnDragOver?.(column.id);
  };

  const handleCardDragOver = (task: KanbanTask, side: KanbanDropSide) => {
    const index = tasks.findIndex((t) => t.id === task.id);
    updateDropIndex(side === "before" ? index : index + 1);
  };

  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (!canManage) return;
    e.preventDefault(); // drop 허용
    e.dataTransfer.dropEffect = "move";
    updateDropIndex(tasks.length); // 카드가 아닌 빈 공간 → 컬럼 맨 끝
  };

  const handleDragLeave = (e: DragEvent<HTMLElement>) => {
    // 자식 요소로 옮겨갈 때도 dragleave가 발생하므로, 컬럼 밖으로 나갈 때만 지운다.
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropIndex(null);
  };

  const handleDrop = (e: DragEvent<HTMLElement>) => {
    if (!canManage) return;
    e.preventDefault();
    const index = activeDropIndex;
    setDropIndex(null);
    if (index === null) return; // 제자리
    onDropAt?.(column.id, tasks[index] ?? null);
  };

  return (
    <section
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`absolute rounded-[12px] mt-[-20px] mb-[45px] transition-all`}
      style={{
        left: column.left,
        top: KANBAN_COLUMN_TOP,
        width: 352,
        height: "auto",
        backgroundColor: "#ECECF2",
      }}
      data-name="dashboard-card-group"
    >
      <h2 className=" m-[26px] mb-[18px] text-[17px] font-medium leading-[1.2] text-[#141414]">
        {column.label}
      </h2>
      <div
        className="flex flex-col pb-[28px]"
      >
        <div className="w-full">
          {hasTasks ? (
            <>
              {tasks.map((task, index) => (
                <div key={task.id} className="relative">
                  {activeDropIndex === index ? <DropIndicator edge="top" /> : null}
                  <KanbanCard
                    task={task}
                    top={KANBAN_FIRST_CARD_TOP + index * KANBAN_CARD_GAP}
                    onClick={() => onEditTask(task)}
                    canManage={canManage}
                    isDragging={draggingTaskId === task.id}
                    onDragStart={onCardDragStart}
                    onDragEnd={() => {
                      setDropIndex(null);
                      onCardDragEnd?.();
                    }}
                    onDragOverCard={handleCardDragOver}
                  />
                  {activeDropIndex === tasks.length && index === tasks.length - 1 ? (
                    <DropIndicator edge="bottom" />
                  ) : null}
                </div>
              ))}
              {canManage ? (
                <AddTaskButton
                  className="left-[23px]"
                  onClick={() => onAddTask(column.id)}
                />
              ) : null}
            </>
          ) : (
            <div className="relative">
              {activeDropIndex === 0 ? <DropIndicator edge="top" /> : null}
              {canManage ? <EmptyAddCard onClick={() => onAddTask(column.id)} /> : null}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
