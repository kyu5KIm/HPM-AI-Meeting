import React from "react";
import * as DESIGN from "../../constants/design";

export interface TableColumn<T> {
  /**
   * 고유 키값
   */
  key: string;
  /**
   * 헤더 영역에 렌더링될 라벨 혹은 노드
   */
  header: React.ReactNode;
  /**
   * 셀 영역 렌더링 함수
   */
  render?: (row: T, index: number) => React.ReactNode;
  /**
   * 열 너비 (예: '150px', '20%', 'flex-1' 등)
   */
  width?: string;
  /**
   * 정렬 방식
   */
  align?: "left" | "center" | "right";
}

interface TableProps<T> {
  /**
   * 테이블에 표시될 행 데이터 배열
   */
  data: T[];
  /**
   * 테이블 열 정의 정보 배열
   */
  columns: TableColumn<T>[];
  /**
   * 행 클릭 이벤트 헨들러 (선택 사항)
   */
  onRowClick?: (row: T) => void;
  /**
   * 로딩 상태 여부
   */
  isLoading?: boolean;
  /**
   * 데이터가 없을 때의 노출 메시지
   */
  emptyMessage?: string;
  /**
   * 테이블 스타일 확장을 위한 클래스네임
   */
  className?: string;
}

export default function Table<T>({
  data,
  columns,
  onRowClick,
  isLoading,
  emptyMessage = "데이터가 존재하지 않습니다.",
  className = "",
}: TableProps<T>) {
  return (
    <div className={`w-full overflow-x-auto ${DESIGN.RADIUS_SIZES.lg} ${DESIGN.BORDER_COLORS.lightGray} ${DESIGN.BACKGROUND_COLORS.white} ${className}`}>
      <table className="w-full border-collapse text-left table-fixed">
        {/* 테이블 헤더 */}
        <thead>
          <tr className={`${DESIGN.BACKGROUND_COLORS.grayLight} border-b border-b-[#E6E1E6]`}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{ width: col.width, textAlign: col.align }}
                className={`py-4 px-6 ${DESIGN.FONT_SIZES.md} ${DESIGN.COLORS.gray} font-medium whitespace-nowrap`}
              >
                {col.header}
              </th>
            ))}
          </tr>
        </thead>

        {/* 테이블 바디 */}
        <tbody>
          {isLoading ? (
            <tr>
              <td colSpan={columns.length} className="py-12 text-center">
                <div className="flex flex-col items-center justify-center gap-2">
                  {/* 심플한 로딩 스피너 */}
                  <div className="w-8 h-8 border-4 border-[#6A1FEB]/20 border-t-[#6A1FEB] rounded-full animate-spin"></div>
                  <span className={`${DESIGN.FONT_SIZES.sm} ${DESIGN.COLORS.gray}`}>로딩 중입니다...</span>
                </div>
              </td>
            </tr>
          ) : data.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className={`py-16 text-center ${DESIGN.FONT_SIZES.md} ${DESIGN.COLORS.gray}`}
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            data.map((row, rowIndex) => (
              <tr
                key={rowIndex}
                onClick={() => onRowClick && onRowClick(row)}
                className={`border-b border-b-[#E6E1E6] last:border-b-0 transition-colors duration-150 ${
                  onRowClick ? "cursor-pointer" : ""
                } ${DESIGN.BACKGROUND_COLORS.grayLightHover}`}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    style={{ textAlign: col.align }}
                    className={`py-4 px-6 ${DESIGN.FONT_SIZES.md} ${DESIGN.COLORS.black} align-middle break-words`}
                  >
                    {col.render ? col.render(row, rowIndex) : (row as Record<string, React.ReactNode>)[col.key]}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
