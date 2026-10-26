import type { ChangeEvent, DragEvent } from "react";
import { DOCUMENT_MAX_UPLOAD_SIZE } from "../../constants/documentManagement";
import type { UploadedDocument } from "../../types/documentManagement";

interface DocumentUploadPanelProps {
  uploadMessage: string;
  uploadedDocuments: UploadedDocument[];
  submitting?: boolean;
  onAddFiles: (files: File[]) => void;
  onBack: () => void;
  onComplete: () => void;
  onRemoveUploadedDocument: (documentId: number) => void;
}

const formatBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}gb`;
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(bytes % (1024 * 1024) === 0 ? 0 : 1)}mb`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))}kb`;
};

function UploadIcon() {
  return (
    <svg
      aria-hidden="true"
      className="size-[107px]"
      fill="none"
      viewBox="0 0 120 120"
    >
      <path
        d="M60 78V31m0 0L43 48m17-17 17 17M35 88h50"
        stroke="#141414"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="5"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg aria-hidden="true" className="size-[8px]" fill="none" viewBox="0 0 12 12">
      <path
        d="m2 2 8 8m0-8-8 8"
        stroke="#141414"
        strokeLinecap="round"
        strokeWidth="1.6"
      />
    </svg>
  );
}

export default function DocumentUploadPanel({
  uploadMessage,
  uploadedDocuments,
  submitting = false,
  onAddFiles,
  onBack,
  onComplete,
  onRemoveUploadedDocument,
}: DocumentUploadPanelProps) {
  const totalUploadSize = uploadedDocuments.reduce(
    (sum, item) => sum + item.file.size,
    0,
  );
  const uploadPercent = Math.min(
    100,
    (totalUploadSize / DOCUMENT_MAX_UPLOAD_SIZE) * 100,
  );
  const hasUploadedDocuments = uploadedDocuments.length > 0;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    onAddFiles(Array.from(event.target.files ?? []));
    event.target.value = "";
  };

  const handleDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault();
    onAddFiles(Array.from(event.dataTransfer.files));
  };

  return (
    <section className="mx-auto w-full max-w-[1376px]" data-node-id="1:1092">
      <header>
        <h1 className="m-0 text-[32px] font-medium leading-[1.2] text-[#141414]">
          내부 문서 업로드
        </h1>
        <p className="mt-[7px] text-[17px] font-normal leading-[1.2] text-[#969696]">
          회의 준비 자료 생성과 챗봇에서 검색할 문서를 업로드 하세요
        </p>
      </header>

      <section className="mx-auto mt-[43px] w-full max-w-[992px] rounded-[20px] bg-[#f4f5f8] px-[23px] pb-[26px] pt-[46px]">
        <input
          id="document-file-upload-input"
          type="file"
          multiple
          accept=".pdf,.hwp,.hwpx,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          className="hidden"
          onChange={handleFileChange}
        />

        <div className="flex flex-col gap-[24px] lg:flex-row lg:gap-[45px]">
          <button
            type="button"
            onClick={() => document.getElementById("document-file-upload-input")?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={handleDrop}
            className="flex h-[380px] w-full flex-col items-center justify-center rounded-[15px] border border-dashed border-[#969696] bg-[#fdfdfd] px-[28px] text-center transition-all duration-150 hover:border-[#6A1FEB] hover:bg-white active:scale-[0.99] lg:w-[430px]"
          >
            <UploadIcon />
            <span className="mt-[28px] text-[15px] font-medium text-[#808080]">
              파일을 드래그하거나 클릭하여 업로드
            </span>
            <span className="mt-[10px] text-[15px] font-medium text-[#808080]">
              PDF · HWP · HWPX · DOCX · TXT 파일당 최대 20MB
            </span>
            <span className="mt-[33px] flex h-[48px] w-[150px] items-center justify-center rounded-[7px] bg-[#141414] text-[17px] font-medium text-[#fdfdfd]">
              파일 선택
            </span>
          </button>

          <section className="h-[380px] w-full bg-[#fdfdfd] px-[16px] py-[13px] lg:w-[430px]">
            <h2 className="m-0 text-[17px] font-medium leading-[1.2] text-[#141414]">
              업로드 자료
            </h2>
            <div className="mt-[22px] flex max-h-[318px] flex-col gap-[10px] overflow-y-auto pr-[2px]">
              {hasUploadedDocuments ? (
                uploadedDocuments.map((item) => (
                  <div
                    key={item.id}
                    className="flex h-[34px] items-center justify-between rounded-[6px] border border-[#e0dedb] bg-white px-[10px] py-[9px] text-[15px]"
                  >
                    <span className="min-w-0 flex-1 truncate text-[#141414]">
                      {item.file.name}
                    </span>
                    <span className="ml-[12px] shrink-0 text-[#969696]">
                      {formatBytes(item.file.size)}
                    </span>
                    <button
                      type="button"
                      aria-label={`${item.file.name} 삭제`}
                      onClick={() => onRemoveUploadedDocument(item.id)}
                      className="ml-[14px] flex size-[18px] shrink-0 items-center justify-center rounded-full border-0 bg-transparent p-0 transition-colors hover:bg-[#eee]"
                    >
                      <CloseIcon />
                    </button>
                  </div>
                ))
              ) : (
                <p className="mt-[124px] text-center text-[15px] text-[#969696]">
                  업로드된 자료가 없습니다.
                </p>
              )}
            </div>
          </section>
        </div>

        <div className="mt-[22px] flex flex-col gap-[24px] lg:flex-row lg:items-start lg:justify-between">
          <div className="w-full lg:w-[430px]">
            <div className="h-[16px] overflow-hidden rounded-[32px] border border-[#969696] bg-[#fdfdfd]">
              <div
                className="h-full rounded-[32px] bg-[#6A1FEB] transition-all duration-200"
                style={{ width: `${uploadPercent}%` }}
              />
            </div>
            <div className="mt-[8px] flex justify-between text-[15px] font-medium text-black">
              <span>0Mb</span>
              <span>20MB</span>
            </div>
            {uploadMessage ? (
              <p className="mt-[8px] text-[15px] text-[#e52e2e]">{uploadMessage}</p>
            ) : null}
          </div>

          <div className="flex justify-end gap-[14px]">
            <button
              type="button"
              onClick={onBack}
              className="h-[48px] w-[150px] rounded-[7px] border-0 bg-[#dcd0fe] text-[17px] font-medium text-[#141414] transition-all duration-150 hover:bg-[#ccbafd] active:scale-[0.98]"
            >
              이전
            </button>
            <button
              type="button"
              disabled={!hasUploadedDocuments || submitting}
              onClick={onComplete}
              className="h-[48px] w-[150px] rounded-[7px] border-0 bg-[#6A1FEB] text-[17px] font-medium text-[#fdfdfd] transition-all duration-150 hover:bg-[#5635a8] active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-[#969696]"
            >
              {submitting ? "업로드 중..." : "완료"}
            </button>
          </div>
        </div>
      </section>
    </section>
  );
}
