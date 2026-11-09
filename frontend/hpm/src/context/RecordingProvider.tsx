import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { RecordingContext } from "./RecordingContext";

const LS_KEY = "hpm_recording";

interface StoredState {
  meetingId: number | null;
  startTime: number | null;
  isPaused: boolean;
  pausedElapsed: number | null;
}

function loadStorage(): StoredState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { meetingId: null, startTime: null, isPaused: false, pausedElapsed: null };
    return JSON.parse(raw);
  } catch {
    return { meetingId: null, startTime: null, isPaused: false, pausedElapsed: null };
  }
}

export function RecordingProvider({ children }: { children: ReactNode }) {
  const initial = loadStorage();
  const [meetingId, setMeetingId] = useState<number | null>(initial.meetingId);
  const [startTime, setStartTime] = useState<number | null>(initial.startTime);
  const [isPaused, setIsPaused] = useState<boolean>(initial.isPaused);
  const [pausedElapsed, setPausedElapsed] = useState<number | null>(initial.pausedElapsed);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    if (meetingId === null) {
      localStorage.removeItem(LS_KEY);
    } else {
      localStorage.setItem(LS_KEY, JSON.stringify({ meetingId, startTime, isPaused, pausedElapsed }));
    }
  }, [meetingId, startTime, isPaused, pausedElapsed]);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const startRecording = useCallback((id: number, existingElapsed?: number, recorder?: MediaRecorder) => {
    const adjustedStart = existingElapsed !== undefined
      ? Date.now() - existingElapsed * 1000
      : Date.now();
    setMeetingId(id);
    setStartTime(adjustedStart);
    setIsPaused(false);
    setPausedElapsed(null);

    if (recorder) {
      chunksRef.current = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };
      recorderRef.current = recorder;
      streamRef.current = recorder.stream;
    }
  }, []);

  const finishRecording = useCallback(async (fileName: string) => {
    const recorder = recorderRef.current;
    if (!recorder) return undefined;

    const mimeType = recorder.mimeType || "audio/webm";
    if (recorder.state !== "inactive") {
      await new Promise<void>((resolve, reject) => {
        recorder.onstop = () => resolve();
        recorder.onerror = () => reject(new Error("MediaRecorder failed while stopping."));
        recorder.stop();
      });
    }

    const blob = new Blob(chunksRef.current, { type: mimeType });
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks();

    if (blob.size === 0) return undefined;
    return new File([blob], fileName, { type: mimeType });
  }, [stopTracks]);

  const stopRecording = useCallback(() => {
    const recorder = recorderRef.current;
    try {
      if (recorder && recorder.state !== "inactive") {
        recorder.stop();
      }
    } catch {
      // Ignore cleanup failures; this path is used for reset/abandon flows.
    }
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks();
    setMeetingId(null);
    setStartTime(null);
    setIsPaused(false);
    setPausedElapsed(null);
  }, [stopTracks]);

  const pauseRecording = useCallback((elapsedSeconds: number) => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.pause();
    }
    setIsPaused(true);
    setPausedElapsed(elapsedSeconds);
  }, []);

  const resumeRecording = useCallback(() => {
    if (recorderRef.current?.state === "paused") {
      recorderRef.current.resume();
    }
    setPausedElapsed((pe) => {
      const newStart = pe !== null ? Date.now() - pe * 1000 : Date.now();
      setStartTime(newStart);
      return null;
    });
    setIsPaused(false);
  }, []);

  return (
    <RecordingContext.Provider value={{ meetingId, startTime, isPaused, pausedElapsed, startRecording, finishRecording, stopRecording, pauseRecording, resumeRecording }}>
      {children}
    </RecordingContext.Provider>
  );
}
