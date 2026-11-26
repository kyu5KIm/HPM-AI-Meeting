export const ALL_DOCUMENT_FILTER = "전체";
// 백엔드 /documents/upload-config/ 의 allowed_formats를 우선하고, 응답이 없을 때만 이 값을 쓴다.
export const DOCUMENT_ALLOWED_EXTENSIONS = new Set(["pdf", "hwp", "hwpx", "docx", "txt"]);
export const DOCUMENT_MAX_UPLOAD_SIZE = 20 * 1024 * 1024;
export const UPLOAD_PERIOD_OPTIONS = ["전체", "1주일", "1개월", "3개월", "6개월", "1년"] as const;
export const SORT_OPTIONS = ["최신순", "오래된순"] as const;
export const PERIOD_DAYS: Record<string, number> = {
  "1주일": 7,
  "1개월": 30,
  "3개월": 90,
  "6개월": 180,
  "1년": 365,
};
