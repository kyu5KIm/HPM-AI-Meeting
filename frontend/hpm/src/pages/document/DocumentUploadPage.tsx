import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import DocumentUploadPanel from "../../components/document/DocumentUploadPanel";
import UploadWarningModal from "../../components/document/UploadWarningModal";
import {
  DOCUMENT_ALLOWED_EXTENSIONS,
  DOCUMENT_MAX_UPLOAD_SIZE,
} from "../../constants/documentManagement";
import { useAuth } from "../../context/AuthContext";
import {
  getDocumentIngestStatus,
  getUploadConfig,
  uploadDocuments,
} from "../../services/documents";
import type { UploadConfig } from "../../services/documents";
import type { UploadedDocument } from "../../types/documentManagement";

const getExtension = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const DEFAULT_MESSAGES = {
  entry: "최대 파일 10개만 업로드 가능합니다",
  size_exceeded: "파일의 용량이 20MB를 초과했습니다.\n다시 한번 확인해주세요",
  unsupported_format: "지원하지 않는 파일 형식입니다",
};

const DEFAULT_MAX_FILES = 10;
const DOCUMENT_UPLOAD_PENDING_MESSAGE = "내부문서 업로드 중... 완료후 알림 발송 해드리겠습니다";

export default function DocumentUploadPage() {
  const navigate = useNavigate();
  const { projectId } = useAuth();
  const [uploadedDocuments, setUploadedDocuments] = useState<UploadedDocument[]>([]);
  const [uploadMessage, setUploadMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [config, setConfig] = useState<UploadConfig | null>(null);
  const [modal, setModal] = useState<string | null>(null);

  const messages = config?.messages ?? DEFAULT_MESSAGES;

  useEffect(() => {
    getUploadConfig()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const addUploadFiles = (files: File[]) => {
    if (files.length === 0) return;

    const maxFiles = config?.max_files ?? DEFAULT_MAX_FILES;
    const allowedExtensions = config?.allowed_formats?.length
      ? new Set(config.allowed_formats.map((format) => format.toLowerCase()))
      : DOCUMENT_ALLOWED_EXTENSIONS;
    if (uploadedDocuments.length + files.length > maxFiles) {
      setModal(messages.entry);
      return;
    }

    for (const file of files) {
      if (!allowedExtensions.has(getExtension(file.name))) {
        setModal(messages.unsupported_format);
        return;
      }
      if (file.size > DOCUMENT_MAX_UPLOAD_SIZE) {
        setModal(messages.size_exceeded);
        return;
      }
    }

    setUploadedDocuments((current) => [
      ...current,
      ...files.map((file, index) => ({
        id: Date.now() + index,
        file,
      })),
    ]);
    setUploadMessage("");
  };

  const removeUploadedDocument = (documentId: number) => {
    setUploadedDocuments((current) => current.filter((item) => item.id !== documentId));
    setUploadMessage("");
  };

  const waitForDocumentIngest = async (jobId: string) => {
    if (!projectId) return;

    const maxAttempts = 1000;
    for (let attempts = 1; attempts <= maxAttempts; attempts += 1) {
      setUploadMessage(DOCUMENT_UPLOAD_PENDING_MESSAGE);
      await delay(3000);

      const status = await getDocumentIngestStatus(projectId, jobId);
      if (status.status === "completed") {
        return;
      }
      if (status.status === "failed") {
        throw new Error(status.error || "내부문서 적재에 실패했습니다.");
      }
    }

    throw new Error("내부문서 적재 시간이 초과되었습니다.");
  };

  const completeUpload = async () => {
    if (!projectId) {
      setUploadMessage("프로젝트를 먼저 선택해야 합니다.");
      return;
    }
    if (uploadedDocuments.length === 0 || submitting) return;

    setSubmitting(true);
    try {
      setUploadMessage(DOCUMENT_UPLOAD_PENDING_MESSAGE);
      const result = await uploadDocuments(
        projectId,
        uploadedDocuments.map((item) => item.file),
      );

      if (result.errors.length > 0 && result.created.length === 0) {
        setUploadMessage(result.errors.map((item) => `${item.file}: ${item.error}`).join(", "));
        return;
      }

      if (result.created.length === 0) {
        setUploadMessage("문서는 저장되지 않았습니다.");
        return;
      }

      if (!result.ingest_job_id) {
        setUploadMessage(
          `문서는 저장됐지만 내부문서 적재 요청에 실패했습니다. ${result.ingest_error || ""}`.trim(),
        );
        return;
      }

      await waitForDocumentIngest(result.ingest_job_id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "문서 업로드에 실패했습니다.";
      setUploadMessage(message);
      return;
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="-m-6 min-h-screen overflow-x-hidden bg-[#fffdfd] pt-[64px] font-pretendard">
      {modal && (
        <UploadWarningModal message={modal} onClose={() => setModal(null)} />
      )}
      <section className="min-h-[1016px] w-full min-w-0 px-[32px] pb-[72px] pt-[64px]">
        <DocumentUploadPanel
          uploadMessage={uploadMessage}
          uploadedDocuments={uploadedDocuments}
          submitting={submitting}
          onAddFiles={addUploadFiles}
          onBack={() => navigate("/documents")}
          onComplete={() => void completeUpload()}
          onRemoveUploadedDocument={removeUploadedDocument}
        />
      </section>
    </div>
  );
}
