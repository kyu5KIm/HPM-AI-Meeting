import { useCallback, useEffect, useRef, useState } from "react";
import { useBlocker } from "react-router-dom";
import ConfirmModal from "../components/ui/ConfirmModal";
import { completeMeetingRawTranscriptOnly } from "../services/meeting";

const EXIT_MESSAGE = "페이지를 벗어나면 회의록이 생성되지 않습니다.";
const BACK_MESSAGE = "검토 단계에서는 뒤로가기를 사용할 수 없습니다.";

interface ReviewNavigationGuardOptions {
  enabled: boolean;
  meetingId: number;
  message?: string;
  backMessage?: string;
  onConfirmExit?: () => Promise<void>;
}

export default function useMeetingReviewNavigationGuard({
  enabled,
  meetingId,
  message = EXIT_MESSAGE,
  backMessage = BACK_MESSAGE,
  onConfirmExit,
}: ReviewNavigationGuardOptions) {
  const allowNavigationRef = useRef(false);
  const blockReasonRef = useRef<"back" | "leave">("leave");
  const [showExitModal, setShowExitModal] = useState(false);
  const [confirmingExit, setConfirmingExit] = useState(false);

  const allowReviewNavigation = useCallback(() => {
    allowNavigationRef.current = true;
  }, []);

  const blocker = useBlocker(({ currentLocation, nextLocation, historyAction }) => {
    if (!enabled || allowNavigationRef.current || currentLocation.pathname === nextLocation.pathname) {
      return false;
    }

    blockReasonRef.current = historyAction === "POP" ? "back" : "leave";
    return true;
  });

  useEffect(() => {
    if (blocker.state !== "blocked") return;

    if (blockReasonRef.current === "back") {
      alert(backMessage);
      blocker.reset();
      return;
    }

    setShowExitModal(true);
  }, [backMessage, blocker]);

  const handleCancelExit = useCallback(() => {
    setShowExitModal(false);
    blocker.reset?.();
  }, [blocker]);

  const handleConfirmExit = useCallback(async () => {
    if (confirmingExit) return;

    setConfirmingExit(true);
    try {
      if (onConfirmExit) {
        await onConfirmExit();
      } else {
        await completeMeetingRawTranscriptOnly(meetingId);
      }

      allowNavigationRef.current = true;
      setShowExitModal(false);
      blocker.proceed?.();
    } catch (error) {
      console.error("검토 페이지 이탈 처리 실패:", error);
      alert("회의 원문 저장 처리에 실패했습니다. 잠시 후 다시 시도해주세요.");
      blocker.reset?.();
    } finally {
      setConfirmingExit(false);
    }
  }, [blocker, confirmingExit, meetingId, onConfirmExit]);

  const reviewExitModal = showExitModal ? (
    <ConfirmModal
      message={message}
      loading={confirmingExit}
      onConfirm={handleConfirmExit}
      onCancel={handleCancelExit}
    />
  ) : null;

  return { allowReviewNavigation, reviewExitModal };
}
