import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import DocumentManagementPanel from "../../components/document/DocumentManagementPanel";
import UploadWarningModal from "../../components/document/UploadWarningModal";
import {
  ALL_DOCUMENT_FILTER,
  PERIOD_DAYS,
} from "../../constants/documentManagement";
import { useAuth } from "../../context/AuthContext";
import { deleteDocument, getDocuments } from "../../services/documents";
import type { DocumentRecord } from "../../types/documentManagement";

const DOCUMENTS_PER_PAGE = 10;

function openInNewTab(url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function downloadDocumentFile(item: DocumentRecord) {
  if (item.fileUrl) {
    openInNewTab(item.fileUrl);
    return;
  }

  const blob =
    item.file ??
    new Blob([`${item.name}\n생성자: ${item.creator}\n업로드 날짜: ${item.uploadedAt}`], {
      type: "text/plain;charset=utf-8",
    });
  const url = URL.createObjectURL(blob);
  openInNewTab(url);
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export default function DocumentManagementPage() {
  const navigate = useNavigate();
  const { projectId, user } = useAuth();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set());
  const [query, setQuery] = useState("");
  const [creatorFilter, setCreatorFilter] = useState(ALL_DOCUMENT_FILTER);
  const [uploadPeriod, setUploadPeriod] = useState("전체");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [sortOrder, setSortOrder] = useState("최신순");
  const [currentPage, setCurrentPage] = useState(1);
  const [showDeletePermissionModal, setShowDeletePermissionModal] = useState(false);

  const loadDocuments = useCallback(async () => {
    if (!projectId) {
      setDocuments([]);
      return;
    }

    try {
      const data = await getDocuments(projectId);
      setDocuments(data);
    } catch {
      setDocuments([]);
    }
  }, [projectId]);

  useEffect(() => {
    void loadDocuments();
  }, [loadDocuments]);

  const creators = useMemo(
    () => [
      ALL_DOCUMENT_FILTER,
      ...Array.from(
        new Set(
          documents.map((item) =>
            item.creatorRank ? `${item.creator}(${item.creatorRank})` : item.creator,
          ),
        ),
      ),
    ],
    [documents],
  );

  const filteredDocuments = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    const filtered = documents.filter((item) => {
      const matchesQuery =
        !normalizedQuery ||
        [item.name, item.creator, item.department, item.uploadedAt]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);

      const creatorLabel = item.creatorRank
        ? `${item.creator}(${item.creatorRank})`
        : item.creator;
      const matchesCreator =
        creatorFilter === ALL_DOCUMENT_FILTER || creatorLabel === creatorFilter;

      const matchesDate = (() => {
        if (startDate || endDate) {
          const d = new Date(item.uploadedAt);
          if (startDate && d < new Date(startDate)) return false;
          if (endDate && d > new Date(endDate)) return false;
          return true;
        }
        if (uploadPeriod === "전체") return true;
        const days = PERIOD_DAYS[uploadPeriod];
        if (!days) return true;
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - days);
        return new Date(item.uploadedAt) >= cutoff;
      })();

      return matchesQuery && matchesCreator && matchesDate;
    });

    if (sortOrder === "최신순") {
      filtered.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
    } else if (sortOrder === "오래된순") {
      filtered.sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt));
    }

    return filtered;
  }, [creatorFilter, documents, query, uploadPeriod, startDate, endDate, sortOrder]);

  const totalPages = Math.ceil(filteredDocuments.length / DOCUMENTS_PER_PAGE);
  const pagedDocuments = useMemo(() => {
    const startIndex = (currentPage - 1) * DOCUMENTS_PER_PAGE;
    return filteredDocuments.slice(startIndex, startIndex + DOCUMENTS_PER_PAGE);
  }, [currentPage, filteredDocuments]);

  useEffect(() => {
    setCurrentPage(1);
  }, [creatorFilter, endDate, query, sortOrder, startDate, uploadPeriod]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, Math.max(1, totalPages)));
  }, [totalPages]);

  const allVisibleSelected =
    pagedDocuments.length > 0 &&
    pagedDocuments.every((item) => selectedIds.has(item.id));

  const toggleSelected = (documentId: number) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) {
        next.delete(documentId);
      } else {
        next.add(documentId);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedIds((current) => {
      const next = new Set(current);

      if (allVisibleSelected) {
        pagedDocuments.forEach((item) => next.delete(item.id));
      } else {
        pagedDocuments.forEach((item) => next.add(item.id));
      }

      return next;
    });
  };

  const deleteSelected = async () => {
    if (!projectId || selectedIds.size === 0) return;

    const selectedDocs = documents.filter((item) => selectedIds.has(item.id));
    const currentUserId = Number(user?.users_id ?? user?.user_id);
    const hasUnauthorized = selectedDocs.some(
      (doc) => doc.uploaderId === undefined || Number(doc.uploaderId) !== currentUserId,
    );
    if (hasUnauthorized) {
      setShowDeletePermissionModal(true);
      return;
    }

    try {
      await Promise.all(
        Array.from(selectedIds).map((documentId) => deleteDocument(projectId, documentId)),
      );
      setSelectedIds(new Set());
      await loadDocuments();
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } }).response?.data?.error ||
        "문서 삭제에 실패했습니다.";
      alert(message);
    }
  };

  const downloadSelected = () => {
    documents
      .filter((item) => selectedIds.has(item.id))
      .forEach((item) => downloadDocumentFile(item));
  };

  return (
    <div className="-m-6 min-h-screen overflow-x-hidden bg-[#fffdfd] pt-[45px] pb-[45px] font-pretendard">
      {showDeletePermissionModal && (
        <UploadWarningModal
          message="삭제 권한이 없습니다"
          onClose={() => setShowDeletePermissionModal(false)}
        />
      )}
      <section className="min-h-[1016px] w-full min-w-0 px-[32px] pb-0 pt-0">
        <DocumentManagementPanel
          allVisibleSelected={allVisibleSelected}
          creatorFilter={creatorFilter}
          creators={creators}
          documents={pagedDocuments}
          query={query}
          selectedIds={selectedIds}
          uploadPeriod={uploadPeriod}
          startDate={startDate}
          endDate={endDate}
          sortOrder={sortOrder}
          currentPage={currentPage}
          totalPages={totalPages}
          onCreatorFilterChange={setCreatorFilter}
          onDeleteSelected={() => void deleteSelected()}
          onDownloadSelected={downloadSelected}
          onOpenUpload={() => navigate("/documents/upload")}
          onQueryChange={setQuery}
          onPageChange={setCurrentPage}
          onToggleAllVisible={toggleAllVisible}
          onToggleSelected={toggleSelected}
          onUploadPeriodChange={setUploadPeriod}
          onStartDateChange={setStartDate}
          onEndDateChange={setEndDate}
          onSortOrderChange={setSortOrder}
          onDownloadDocument={downloadDocumentFile}
        />
      </section>
    </div>
  );
}
