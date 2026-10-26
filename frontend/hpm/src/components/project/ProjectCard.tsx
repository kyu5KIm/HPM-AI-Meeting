import { type ComponentPropsWithoutRef, type MouseEvent } from "react";
import * as DESIGN from "../../constants/design";
import folder from "../../assets/project/folder.png";
import trash from "../../assets/project/trash.png";
import trashHover from "../../assets/project/trashHover.png";

const VISIBLE_MEMBER_COUNT = 3;

interface Project {
  project_id: number;
  project_owner: number;
  project_name: string;
  startDate: string;
  members: string[];
}

interface ProjectCardProps extends ComponentPropsWithoutRef<"div"> {
  project: Project;
  className?: string;
  canDelete?: boolean;
  onDelete?: (project: Project) => void;
}

export default function ProjectCard({
  project,
  className = "",
  canDelete = false,
  onDelete,
  ...props
}: ProjectCardProps) {
  const visibleMembers = project.members?.slice(0, VISIBLE_MEMBER_COUNT) ?? [];
  const remainingMemberCount = Math.max(
    (project.members?.length ?? 0) - VISIBLE_MEMBER_COUNT,
    0,
  );

  const handleDeleteClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    onDelete?.(project);
  };

  return (
    <div
      {...props}
      className={`${DESIGN.BACKGROUND_COLORS.grayLight} ${DESIGN.PADDING_SIZES.xl} hover:shadow-md ${DESIGN.BORDER_COLORS.gray} hover:border-[#6A1FEB] ${DESIGN.RADIUS_SIZES.xl} relative flex min-h-[224px] w-[352px] flex-col ${className}`}
    >
      {canDelete ? (
        <div className="absolute right-[24px] top-[24px] z-10">
          <button
            type="button"
            aria-label="프로젝트 삭제"
            onClick={handleDeleteClick}
            className="group flex size-[28px] items-center justify-center rounded-full transition hover:bg-[#E6E1E6] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6A1FEB]"
          >
            <img src={trash} alt="" className="w-4 group-hover:hidden" />
            <img src={trashHover} alt="" className="w-4 hidden group-hover:block" />
          </button>
        </div>
      ) : null}

      <img src={folder} alt="" className={`w-[20px] ${DESIGN.MARGIN_BOTTOM_SIZES.lg}`} />
      
      <p className={`${DESIGN.FONT_SIZES.h3} break-words`}>
        {project.project_name}
      </p>
      <p className={`${DESIGN.FONT_SIZES.lg} ${DESIGN.COLORS.gray} ${DESIGN.MARGIN_TOP_SIZES.xl}`}>
        {project.startDate}
      </p>
      <p className={`${DESIGN.FONT_SIZES.lg} ${DESIGN.COLORS.black} mt-auto break-words`}>
        {visibleMembers.length > 0 ? (
          <>
            {visibleMembers.join(", ")}
            {remainingMemberCount > 0 && (
              <span className={DESIGN.COLORS.gray}>
                {` 외 +${remainingMemberCount}`}
              </span>
            )}
          </>
        ) : (
          "참여자 없음"
        )}
      </p>
    </div>
  );
}
