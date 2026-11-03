import { useState, useCallback } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

// ── Scene-based editing types (Remotion Recorder inspired) ──────────────

export interface Scene {
  id: string;
  type: 'video' | 'title' | 'endcard';

  // Video scene content
  primarySource?: string;
  sourceType?: 'screenshot' | 'video' | 'webcam';

  // Layout
  layout: SceneLayout;
  webcamPosition?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

  // Timing
  durationInFrames: number;

  // Camera & effects
  cameraMove?: string;
  highlights?: HighlightEffect[];
  motionBlur?: boolean;
  speed?: number; // 0.5, 1, 1.5, 2

  // B-roll overlays (multiple per scene)
  bRoll: BRollOverlay[];

  // Narration
  narration?: string;

  // Transition to next scene
  transitionToNext?: TransitionType | null;
  transitionDuration?: number;

  // Title scene
  title?: string;
  subtitle?: string;

  // Endcard
  ctaText?: string;
  ctaUrl?: string;
}

export interface BRollOverlay {
  id: string;
  src: string;
  type: 'video' | 'image';
  from: number; // start frame relative to scene
  durationInFrames: number;
  label?: string;
}

export type SceneLayout =
  | 'screenshot_fullscreen'
  | 'avatar_pip'
  | 'avatar_fullscreen'
  | 'split_screen'
  | 'text_card'
  | 'stat_card'
  | 'quote_card'
  | 'list_reveal'
  | 'gradient_title'
  | 'b_roll_fullscreen';

export interface HighlightEffect {
  type:
    | 'red_circle'
    | 'underline_draw'
    | 'blur_except'
    | 'glow_pulse'
    | 'arrow'
    | 'fake_cursor_click'
    | 'magnify';
  x: number;
  y: number;
  width?: number;
  height?: number;
  startFrame: number;
  durationInFrames: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
  highlighted?: boolean;
}

// ── Clip-based editing types ────────────────────────────────────────────

export interface Clip {
  id: string;
  src: string;
  /** Clip type: 'video' for video files, 'image' for storyboard scene images */
  type?: 'video' | 'image';
  /** Start of the usable region within the source file, in seconds */
  trimStart: number;
  /** End of the usable region within the source file, in seconds */
  trimEnd: number;
  /** Duration in frames (at 30 fps) — derived from trimStart/trimEnd */
  durationInFrames: number;
  /** Display label */
  label?: string;
  /** Actual source video duration in seconds, loaded from metadata */
  sourceDuration?: number;
  /** Ken Burns / camera animation for image clips */
  cameraMove?: string;
}

export interface TextOverlay {
  id: string;
  text: string;
  /** Position in the composition, in frames from start */
  startFrame: number;
  /** Duration the overlay is visible, in frames */
  durationInFrames: number;
  /** x position as a percentage 0-100 */
  x: number;
  /** y position as a percentage 0-100 */
  y: number;
  fontSize: number;
  color: string;
  fontWeight: 'normal' | 'bold';
}

export type TransitionType = 'cut' | 'crossfade' | 'slide_left' | 'slide_up' | 'zoom';

export interface Transition {
  id: string;
  /** Index of the clip this transition leads INTO (i.e. between clip[i-1] and clip[i]) */
  afterClipIndex: number;
  type: TransitionType;
  /** Duration of the transition in frames */
  durationInFrames: number;
}

export interface AudioTrack {
  id: string;
  src: string;
  label: string;
  volume: number; // 0 – 1
  /** Offset in frames from the composition start */
  startFrame: number;
}

export interface VideoEditorState {
  clips: Clip[];
  textOverlays: TextOverlay[];
  transitions: Transition[];
  audioTracks: AudioTrack[];
}

// ── Constants ──────────────────────────────────────────────────────────────

const FPS = 30;
const VIDEO_RENDERER_WORKER_URL = import.meta.env.VITE_VIDEO_RENDERER_WORKER_URL || '';

// ── Hook ───────────────────────────────────────────────────────────────────

interface UseVideoEditorOptions {
  initialAudioTracks?: AudioTrack[];
  onExportComplete?: (url: string) => void;
  onExportError?: (error: string) => void;
}

export function useVideoEditor(initialClips: Clip[], options: UseVideoEditorOptions = {}) {
  const [clips, setClips] = useState<Clip[]>(initialClips);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [transitions, setTransitions] = useState<Transition[]>([]);
  const [audioTracks, setAudioTracks] = useState<AudioTrack[]>(options.initialAudioTracks ?? []);
  const [exportProgress, setExportProgress] = useState(0);

  // ── Scene state ────────────────────────────────────────────────────────

  const [scenes, setScenes] = useState<Scene[]>([]);
  const [undoStack, setUndoStack] = useState<Scene[][]>([]);
  const [redoStack, setRedoStack] = useState<Scene[][]>([]);

  const pushUndo = useCallback(() => {
    setUndoStack((prev) => [...prev.slice(-49), scenes]);
    setRedoStack([]);
  }, [scenes]);

  const undo = useCallback(() => {
    setUndoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setRedoStack((r) => [...r, scenes]);
      setScenes(last);
      return prev.slice(0, -1);
    });
  }, [scenes]);

  const redo = useCallback(() => {
    setRedoStack((prev) => {
      if (prev.length === 0) return prev;
      const last = prev[prev.length - 1];
      setUndoStack((u) => [...u, scenes]);
      setScenes(last);
      return prev.slice(0, -1);
    });
  }, [scenes]);

  const addScene = useCallback((scene: Scene) => {
    pushUndo();
    setScenes((prev) => [...prev, scene]);
  }, [pushUndo]);

  const removeScene = useCallback((id: string) => {
    pushUndo();
    setScenes((prev) => prev.filter((s) => s.id !== id));
  }, [pushUndo]);

  const reorderScenes = useCallback((fromIndex: number, toIndex: number) => {
    pushUndo();
    setScenes((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, [pushUndo]);

  const updateScene = useCallback((id: string, patch: Partial<Scene>) => {
    pushUndo();
    setScenes((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  }, [pushUndo]);

  const addBRoll = useCallback((sceneId: string, broll: BRollOverlay) => {
    pushUndo();
    setScenes((prev) =>
      prev.map((s) => (s.id === sceneId ? { ...s, bRoll: [...s.bRoll, broll] } : s)),
    );
  }, [pushUndo]);

  const removeBRoll = useCallback((sceneId: string, brollId: string) => {
    pushUndo();
    setScenes((prev) =>
      prev.map((s) =>
        s.id === sceneId ? { ...s, bRoll: s.bRoll.filter((b) => b.id !== brollId) } : s,
      ),
    );
  }, [pushUndo]);

  const updateBRoll = useCallback(
    (sceneId: string, brollId: string, patch: Partial<BRollOverlay>) => {
      pushUndo();
      setScenes((prev) =>
        prev.map((s) =>
          s.id === sceneId
            ? { ...s, bRoll: s.bRoll.map((b) => (b.id === brollId ? { ...b, ...patch } : b)) }
            : s,
        ),
      );
    },
    [pushUndo],
  );

  const splitScene = useCallback((sceneId: string, atFrame: number) => {
    pushUndo();
    setScenes((prev) => {
      const idx = prev.findIndex((s) => s.id === sceneId);
      if (idx === -1) return prev;
      const scene = prev[idx];
      if (atFrame <= 0 || atFrame >= scene.durationInFrames) return prev;

      const firstHalf: Scene = {
        ...scene,
        id: `${scene.id}-a`,
        durationInFrames: atFrame,
        bRoll: scene.bRoll.filter((b) => b.from < atFrame),
        transitionToNext: null,
        transitionDuration: undefined,
      };

      const secondHalf: Scene = {
        ...scene,
        id: `${scene.id}-b`,
        durationInFrames: scene.durationInFrames - atFrame,
        bRoll: scene.bRoll
          .filter((b) => b.from + b.durationInFrames > atFrame)
          .map((b) => ({ ...b, from: Math.max(0, b.from - atFrame) })),
      };

      const next = [...prev];
      next.splice(idx, 1, firstHalf, secondHalf);
      return next;
    });
  }, [pushUndo]);

  // ── Clip helpers ─────────────────────────────────────────────────────────

  const addClip = useCallback((clip: Clip) => {
    setClips((prev) => [...prev, clip]);
  }, []);

  const removeClip = useCallback((clipId: string) => {
    setClips((prev) => prev.filter((c) => c.id !== clipId));
    // Also remove any transitions that reference the removed clip index
    setTransitions((prev) => {
      const newClips = clips.filter((c) => c.id !== clipId);
      return prev.filter((t) => t.afterClipIndex < newClips.length && t.afterClipIndex > 0);
    });
  }, [clips]);

  const reorderClips = useCallback((fromIndex: number, toIndex: number) => {
    setClips((prev) => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  }, []);

  const updateClipTrim = useCallback((clipId: string, trimStart: number, trimEnd: number) => {
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId
          ? { ...c, trimStart, trimEnd, durationInFrames: Math.round((trimEnd - trimStart) * FPS) }
          : c,
      ),
    );
  }, []);

  const updateClipSourceDuration = useCallback((clipId: string, sourceDuration: number) => {
    setClips((prev) =>
      prev.map((c) => {
        if (c.id !== clipId) return c;
        const newTrimEnd = c.trimEnd >= sourceDuration ? sourceDuration : c.trimEnd;
        return {
          ...c,
          sourceDuration,
          trimEnd: newTrimEnd,
          durationInFrames: Math.round((newTrimEnd - c.trimStart) * FPS),
        };
      }),
    );
  }, []);

  /** Update an image clip's display duration (in seconds) */
  const updateClipDuration = useCallback((clipId: string, durationSeconds: number) => {
    setClips((prev) =>
      prev.map((c) =>
        c.id === clipId
          ? { ...c, trimEnd: durationSeconds, durationInFrames: Math.round(durationSeconds * FPS), sourceDuration: durationSeconds }
          : c,
      ),
    );
  }, []);

  /** Update a clip's camera move animation */
  const updateClipCameraMove = useCallback((clipId: string, cameraMove: string) => {
    setClips((prev) =>
      prev.map((c) => (c.id === clipId ? { ...c, cameraMove } : c)),
    );
  }, []);

  // ── Text overlay helpers ─────────────────────────────────────────────────

  const addTextOverlay = useCallback((overlay: TextOverlay) => {
    setTextOverlays((prev) => [...prev, overlay]);
  }, []);

  const updateTextOverlay = useCallback((id: string, patch: Partial<TextOverlay>) => {
    setTextOverlays((prev) =>
      prev.map((o) => (o.id === id ? { ...o, ...patch } : o)),
    );
  }, []);

  const removeTextOverlay = useCallback((id: string) => {
    setTextOverlays((prev) => prev.filter((o) => o.id !== id));
  }, []);

  // ── Transition helpers ───────────────────────────────────────────────────

  const setTransitionAt = useCallback(
    (afterClipIndex: number, type: TransitionType, durationInFrames = 15) => {
      setTransitions((prev) => {
        const existing = prev.find((t) => t.afterClipIndex === afterClipIndex);
        if (existing) {
          return prev.map((t) =>
            t.afterClipIndex === afterClipIndex ? { ...t, type, durationInFrames } : t,
          );
        }
        return [
          ...prev,
          { id: `tr-${afterClipIndex}-${Date.now()}`, afterClipIndex, type, durationInFrames },
        ];
      });
    },
    [],
  );

  const removeTransition = useCallback((afterClipIndex: number) => {
    setTransitions((prev) => prev.filter((t) => t.afterClipIndex !== afterClipIndex));
  }, []);

  // ── Audio track helpers ──────────────────────────────────────────────────

  const setAudioVolume = useCallback((trackId: string, volume: number) => {
    setAudioTracks((prev) =>
      prev.map((a) => (a.id === trackId ? { ...a, volume: Math.max(0, Math.min(1, volume)) } : a)),
    );
  }, []);

  const addAudioTrack = useCallback((track: AudioTrack) => {
    setAudioTracks((prev) => [...prev, track]);
  }, []);

  const removeAudioTrack = useCallback((trackId: string) => {
    setAudioTracks((prev) => prev.filter((a) => a.id !== trackId));
  }, []);

  // ── Computed values ──────────────────────────────────────────────────────

  const totalDurationInFrames = clips.reduce((sum, c) => sum + c.durationInFrames, 0)
    - transitions.reduce((sub, t) => (t.type !== 'cut' ? sub + t.durationInFrames : sub), 0);

  // ── Export mutation ──────────────────────────────────────────────────────

  const exportMutation = useMutation({
    mutationFn: async () => {
      if (!VIDEO_RENDERER_WORKER_URL) {
        throw new Error('Video renderer worker URL is not configured');
      }

      setExportProgress(0);

      const hasImageClips = clips.some((c) => c.type === 'image');

      const payload = {
        composition: 'EditorComposition',
        inputProps: {
          clips,
          textOverlays,
          transitions,
          audioTracks,
        },
        fps: FPS,
        width: 1080,
        height: 1920,
      };

      const response = await fetch(`${VIDEO_RENDERER_WORKER_URL}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`Render failed: ${errorBody}`);
      }

      const result = await response.json();

      // If the response includes a polling URL, poll for completion
      if (result.renderId) {
        return await pollRenderStatus(result.renderId);
      }

      return result.url as string;
    },
    onSuccess: (url: string) => {
      setExportProgress(100);
      toast.success('Video exported successfully!');
      options.onExportComplete?.(url);
    },
    onError: (error: Error) => {
      setExportProgress(0);
      toast.error(error.message || 'Export failed');
      options.onExportError?.(error.message);
    },
  });

  async function pollRenderStatus(renderId: string): Promise<string> {
    const maxAttempts = 120; // 10 minutes at 5s intervals
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise((r) => setTimeout(r, 5000));

      const res = await fetch(`${VIDEO_RENDERER_WORKER_URL}/status/${renderId}`);
      if (!res.ok) continue;

      const status = await res.json();

      if (status.progress !== undefined) {
        setExportProgress(Math.round(status.progress * 100));
      }

      if (status.status === 'completed' && status.url) {
        return status.url;
      }

      if (status.status === 'failed') {
        throw new Error(status.error || 'Render failed');
      }
    }

    throw new Error('Render timed out');
  }

  const exportVideo = useCallback(() => {
    exportMutation.mutate();
  }, [exportMutation]);

  // ── Return ───────────────────────────────────────────────────────────────

  return {
    // State
    clips,
    setClips,
    textOverlays,
    setTextOverlays,
    transitions,
    setTransitions,
    audioTracks,
    setAudioTracks,

    // Clip ops
    addClip,
    removeClip,
    reorderClips,
    updateClipTrim,
    updateClipSourceDuration,
    updateClipDuration,
    updateClipCameraMove,

    // Text overlay ops
    addTextOverlay,
    updateTextOverlay,
    removeTextOverlay,

    // Transition ops
    setTransitionAt,
    removeTransition,

    // Audio ops
    setAudioVolume,
    addAudioTrack,
    removeAudioTrack,

    // Computed
    totalDurationInFrames,
    fps: FPS,

    // Scene ops
    scenes,
    setScenes,
    addScene,
    removeScene,
    reorderScenes,
    updateScene,
    addBRoll,
    removeBRoll,
    updateBRoll,
    splitScene,

    // Undo/redo
    undoStack,
    redoStack,
    undo,
    redo,
    pushUndo,

    // Export
    exportVideo,
    isExporting: exportMutation.isPending,
    exportProgress,
    exportError: exportMutation.error?.message || null,
  };
}
