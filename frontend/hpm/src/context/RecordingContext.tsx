import { createContext, useContext } from "react";

interface RecordingCtx {
  meetingId: number | null;
  startTime: number | null;
  isPaused: boolean;
  pausedElapsed: number | null;
  startRecording: (id: number, existingElapsed?: number, recorder?: MediaRecorder) => void;
  finishRecording: (fileName: string) => Promise<File | undefined>;
  stopRecording: () => void;
  pauseRecording: (elapsedSeconds: number) => void;
  resumeRecording: () => void;
}

// Provider 컴포넌트는 RecordingProvider.tsx에 있다(Fast Refresh 규칙상 훅과 분리).
export const RecordingContext = createContext<RecordingCtx | null>(null);

export function useRecording() {
  const ctx = useContext(RecordingContext);
  if (!ctx) throw new Error("useRecording must be used within RecordingProvider");
  return ctx;
}
