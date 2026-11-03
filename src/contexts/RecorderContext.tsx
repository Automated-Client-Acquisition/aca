import { createContext, useContext, type ReactNode } from "react";

export interface RecordingMetadata {
  videoUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

interface RecorderOverlayState {
  consumeRecording: () => RecordingMetadata | null;
}

const RecorderContext = createContext<RecorderOverlayState>({
  consumeRecording: () => null,
});

export function RecorderProvider({ children }: { children: ReactNode }) {
  return (
    <RecorderContext.Provider value={{ consumeRecording: () => null }}>
      {children}
    </RecorderContext.Provider>
  );
}

export function useRecorderOverlay() {
  return useContext(RecorderContext);
}
