import type { DragEvent } from "react";
import type { KanbanTask } from "../../types/kanban";

export type KanbanDropSide = "before" | "after";

interface KanbanCardProps {
  task: KanbanTask;
  top: number;
  onClick: () => void;
  canManage?: boolean;
  isDragging?: boolean;
  onDragStart?: (task: KanbanTask) => void;
  onDragEnd?: () => void;
  // 드래그 중인 카드가 이 카드의 위쪽 절반(before) 또는 아래쪽 절반(after) 위에 있을 때 호출
  onDragOverCard?: (task: KanbanTask, side: KanbanDropSide) => void;
}

const formatKoreanDate = (dateStr: string) => {
  if (!dateStr) return "";
  if (dateStr.includes("(")) return dateStr;

  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;

  const year = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const day = parseInt(parts[2], 10);

  const date = new Date(year, month, day);
  const dayOfWeek = days[date.getDay()];
  return `${dateStr}(${dayOfWeek})`;
};

export default function KanbanCard({
  task,
  top,
  onClick,
  canManage = true,
  isDragging = false,
  onDragStart,
  onDragEnd,
  onDragOverCard,
}: KanbanCardProps) {
  const handleDragStart = (e: DragEvent<HTMLElement>) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.code);
    onDragStart?.(task);
  };

  // 놓기(drop)는 컬럼이 처리한다. 카드는 마우스가 위/아래 어느 절반에 있는지만 알린다.
  const handleDragOver = (e: DragEvent<HTMLElement>) => {
    if (!canManage) return;
    e.preventDefault(); // drop 허용
    e.stopPropagation(); // 컬럼의 "맨 끝" 판정보다 카드 기준 위치 우선
    e.dataTransfer.dropEffect = "move";
    const rect = e.currentTarget.getBoundingClientRect();
    onDragOverCard?.(task, e.clientY < rect.top + rect.height / 2 ? "before" : "after");
  };

  return (
    <article
      draggable={canManage}
      onDragStart={handleDragStart}
      onDragEnd={() => onDragEnd?.()}
      onDragOver={handleDragOver}
      className={`flex ml-[23px] w-[306px] mb-[18px] select-none rounded-[10px] border border-[#CCCCCC] bg-[#FFFDFD] p-[14px] text-left transition-all duration-150 ease-out hover:bg-[#F4F5F8]
      ${canManage ? "cursor-grab active:cursor-grabbing" : ""}
      ${isDragging ? "opacity-40 ring-2 ring-[#623FB5]" : ""}
      focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#623FB5]`}
      style={{ top }}
      data-name="dashboard=card"
    >
      <button
        type="button"
        onClick={canManage ? onClick : undefined}
        className={`rounded-[10px] border-0 bg-transparent p-0 text-left transition-all duration-150 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6A1FEB] ${
          canManage ? "active:scale-[0.985]" : "cursor-default"
        }`}
      >
        <div className="flex flex-col">
          <div className="flex w-full flex-col items-start gap-[10px]">
            <p className="m-0 w-[270px] text-[15px] font-normal leading-[1.2] text-[#141414]">
              {task.title}
            </p>
            <span className="flex h-[22px] items-center justify-center rounded-[20px] bg-[#6A1FEB] px-[8px] py-px text-[11px] font-normal leading-[1.2] text-[#FFFDFD]">
              {task.category}
            </span>
            <p className="m-0 text-[12px] font-normal leading-[1.2] text-[#969696]">
              {formatKoreanDate(task.dueDate)}
            </p>
          </div>
          <div className="mt-[18px] flex w-full justify-between items-center">
            <p className=" text-[12px] font-normal text-[#141414]">
              {task.code}
            </p>
            {task.owner !== "-" && (
              <p className="text-right text-[12px] font-normal text-[#969696]">
                {task.owner}
              </p>
            )}
          </div>
        </div>
      </button>
    </article>
  );
}
