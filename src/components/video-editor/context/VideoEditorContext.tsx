import { createContext, useContext, useReducer, useCallback, useRef, useEffect, useState, MutableRefObject } from "react";
import type { ReactNode } from "react";
import type {
  EditorState,
  EditorAction,
  VideoProject,
  VideoScene,
  VideoSettings,
  VoiceoverTrack,
  MusicTrack,
  SoundEffect,
  EditorPanel,
  ChatUploadedAsset,
  ChatMessagePersisted,
} from "@/types/videoEditor";
import { TRANSITION_FRAMES } from "../remotion/EditorComposition";

// ── Scene extraction from remotion code ──────────────────────────────

function extractScenesFromCode(code: string): VideoScene[] {
  const scenes: VideoScene[] = [];

  // Parse @fps from metadata
  const fpsMatch = code.match(/\/\/\s*@fps\s+(\d+)/i);
  const fps = fpsMatch ? parseInt(fpsMatch[1]) : 30;

  // Resolve a durationInFrames expression to seconds
  function resolveDuration(expr: string): number {
    // Math.round(...) wrapper
    const roundMatch = expr.match(/Math\.round\((.+)\)/);
    if (roundMatch) return resolveDuration(roundMatch[1]);
    // Inline math like "5.6 * fps" or "20 * 30"
    const mathMatch = expr.match(/^([\d.]+)\s*\*\s*(\w+|\d+)$/);
    if (mathMatch) {
      const left = parseFloat(mathMatch[1]);
      const right = mathMatch[2] === "fps" ? fps : parseInt(mathMatch[2]);
      return (left * right) / fps;
    }
    // Literal frame count
    const literalMatch = expr.match(/^(\d+)$/);
    if (literalMatch) return parseInt(literalMatch[1]) / fps;
    // Variable reference
    const safeExpr = expr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const varMatch = code.match(new RegExp(`const\\s+${safeExpr}\\s*=\\s*(\\d+)\\s*\\*\\s*fps`));
    if (varMatch) return parseInt(varMatch[1]);
    const varMatch2 = code.match(new RegExp(`const\\s+${safeExpr}\\s*=\\s*(\\d+)`));
    if (varMatch2) return parseInt(varMatch2[1]) / fps;
    return 5; // fallback
  }

  // Find the body of a component by name to extract media from it
  function findComponentBody(componentName: string): string {
    const pattern = new RegExp(`const\\s+${componentName}\\s*=`);
    const startMatch = pattern.exec(code);
    if (!startMatch) return "";
    const startIdx = startMatch.index;
    // Find the next top-level const declaration or end of code as the boundary
    const nextConst = code.indexOf("\nconst ", startIdx + 10);
    const endIdx = nextConst > startIdx ? nextConst : Math.min(code.length, startIdx + 8000);
    return code.substring(startIdx, endIdx);
  }

  // Extract image URL from a component body
  function extractImageUrl(body: string): { type: "image" | "color"; url: string; source: "ai_image" | "stock" } {
    const usesImage = /<(?:Img|BgImage)\s/.test(body);
    if (!usesImage) return { type: "color", url: "#0a0a1a", source: "stock" };

    // 1. Direct string URL: src="https://..."
    const directMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=["']([^"']+)["']/);
    if (directMatch && directMatch[1].startsWith("http")) {
      return { type: "image", url: directMatch[1], source: "ai_image" };
    }

    // 2. Template literal: src={`${VAR}/path.ext`}
    const templateMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=\{`\$\{(\w+)\}\/([^`]+)`\}/);
    if (templateMatch) {
      const varName = templateMatch[1];
      const path = templateMatch[2];
      const varValMatch = code.match(new RegExp(`const\\s+${varName}\\s*=\\s*['"\`]([^'"\`]+)['"\`]`));
      if (varValMatch) {
        return { type: "image", url: `${varValMatch[1]}/${path}`, source: "ai_image" };
      }
    }

    // 3. Object property: src={IMAGES.hook}
    const objMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=\{(\w+)\.(\w+)\}/);
    if (objMatch) {
      const key = objMatch[2];
      const valMatch = code.match(new RegExp(`${key}:\\s*['"\`]([^'"\`]+)['"\`]`));
      if (valMatch && valMatch[1].startsWith("http")) {
        return { type: "image", url: valMatch[1], source: "ai_image" };
      }
    }

    // 4. Fallback: find any http URL near Img/BgImage in the body
    const urlInBody = body.match(/(?:Img|BgImage)[^]*?['"`](https?:\/\/[^'"`\s]+)['"`]/);
    if (urlInBody) {
      return { type: "image", url: urlInBody[1], source: "ai_image" };
    }

    // 5. Resolve variable references used as src
    const varSrcMatch = body.match(/<(?:Img|BgImage)\s+[^>]*src=\{([A-Z_]\w*(?:\.\w+)?)\}/);
    if (varSrcMatch) {
      const ref = varSrcMatch[1];
      const parts = ref.split(".");
      if (parts.length === 2) {
        const valMatch = code.match(new RegExp(`${parts[1]}:\\s*['"\`]([^'"\`]+)['"\`]`));
        if (valMatch && valMatch[1].startsWith("http")) {
          return { type: "image", url: valMatch[1], source: "ai_image" };
        }
      }
    }

    // Has Img/BgImage but couldn't resolve URL
    return { type: "image", url: "#pending", source: "ai_image" };
  }

  // 1. TransitionSeries.Sequence blocks
  const tsRegex = /TransitionSeries\.Sequence\s+durationInFrames=\{([^}]+)\}[^>]*>\s*<(\w+)/g;
  let match;
  while ((match = tsRegex.exec(code)) !== null) {
    const duration = resolveDuration(match[1].trim());
    const componentName = match[2];

    let transition: "fade" | "slide" | "wipe" | "none" = scenes.length === 0 ? "none" : "fade";
    const beforeSeq = code.substring(0, match.index);
    const lastTransition = beforeSeq.match(/presentation=\{(fade|slide|wipe)\(\)/g);
    if (lastTransition) {
      const t = lastTransition[lastTransition.length - 1];
      if (t.includes("slide")) transition = "slide";
      else if (t.includes("wipe")) transition = "wipe";
      else if (t.includes("fade")) transition = "fade";
    }

    const body = findComponentBody(componentName);
    const media = extractImageUrl(body);

    scenes.push({
      id: `scene_code_${scenes.length}_${Date.now()}`,
      order: scenes.length,
      duration,
      media: { type: media.type, url: media.url, source: media.source as MediaSource },
      transition,
      text: { content: componentName.replace(/([A-Z])/g, " $1").trim(), position: "center", fontSize: 48, color: "#FFFFFF" },
    });
  }

  // 2. Plain <Sequence> blocks
  if (scenes.length === 0) {
    const seqRegex = /<Sequence\s+[^>]*durationInFrames=\{([^}]+)\}[^>]*>\s*\n?\s*<(\w+)/g;
    while ((match = seqRegex.exec(code)) !== null) {
      const componentName = match[2];
      if (["AbsoluteFill", "Audio", "Video", "Img", "Loop", "Series"].includes(componentName)) continue;
      const duration = resolveDuration(match[1].trim());
      const body = findComponentBody(componentName);
      const media = extractImageUrl(body);
      scenes.push({
        id: `scene_code_${scenes.length}_${Date.now()}`,
        order: scenes.length,
        duration,
        media: { type: media.type, url: media.url, source: media.source as MediaSource },
        transition: scenes.length === 0 ? "none" : "fade",
        text: { content: componentName.replace(/([A-Z])/g, " $1").trim(), position: "center", fontSize: 48, color: "#FFFFFF" },
      });
    }
  }

  // 3. Data-driven scene arrays (storyboard videos with .map())
  // Matches arrays of objects with image/duration/title fields.
  // Also runs when previous patterns found very few scenes (e.g. 1 from a .map() call)
  // since .map() in source code only produces one regex match for the template.
  if (scenes.length <= 1) {
    // Reset if we only got a single bogus scene from a .map() template
    if (scenes.length === 1) scenes.length = 0;
    // Resolve BASE variable for template literals like `${BASE}/scene1.png`
    const baseVarMatch = code.match(/const\s+(\w+)\s*=\s*["'`]([^"'`]+)["'`]/g);
    const vars: Record<string, string> = {};
    if (baseVarMatch) {
      for (const m of baseVarMatch) {
        const kv = m.match(/const\s+(\w+)\s*=\s*["'`]([^"'`]+)["'`]/);
        if (kv) vars[kv[1]] = kv[2];
      }
    }

    // Find scene objects with image + duration fields
    const sceneObjRegex = /\{\s*\n?\s*image:\s*(?:[`"']([^`"']+)[`"']|`\$\{(\w+)\}\/([^`]+)`)/g;
    let sceneMatch;
    while ((sceneMatch = sceneObjRegex.exec(code)) !== null) {
      // Resolve image URL
      let imageUrl = sceneMatch[1] || "";
      if (!imageUrl && sceneMatch[2] && sceneMatch[3]) {
        const baseVal = vars[sceneMatch[2]] || "";
        imageUrl = `${baseVal}/${sceneMatch[3]}`;
      }

      // Extract duration from the same object block
      const blockEnd = code.indexOf("\n  },", sceneMatch.index);
      const block = code.substring(sceneMatch.index, blockEnd > sceneMatch.index ? blockEnd + 4 : sceneMatch.index + 500);
      const durMatch = block.match(/duration:\s*([\d.]+)/);
      const duration = durMatch ? parseFloat(durMatch[1]) : 5;

      // Extract title
      const titleMatch = block.match(/title:\s*["']([^"']+)["']/);
      const title = titleMatch ? titleMatch[1] : `Scene ${scenes.length + 1}`;

      scenes.push({
        id: `scene_code_${scenes.length}_${Date.now()}`,
        order: scenes.length,
        duration,
        media: {
          type: imageUrl.startsWith("http") ? "image" : "color",
          url: imageUrl || "#0a0a1a",
          source: "ai_image" as MediaSource,
        },
        transition: scenes.length === 0 ? "none" : "fade",
        text: { content: title, position: "center", fontSize: 48, color: "#FFFFFF" },
      });
    }
  }

  // 4. Fallback: look for named scene components by declaration
  if (scenes.length === 0) {
    const componentRegex = /const\s+(\w+(?:Scene|Section|Intro|CTA|Outro|Title))\s*[=:]/g;
    let compMatch;
    while ((compMatch = componentRegex.exec(code)) !== null) {
      const name = compMatch[1];
      const body = findComponentBody(name);
      const media = extractImageUrl(body);
      scenes.push({
        id: `scene_code_${scenes.length}_${Date.now()}`,
        order: scenes.length,
        duration: 5,
        media: { type: media.type, url: media.url, source: media.source as MediaSource },
        transition: scenes.length === 0 ? "none" : "fade",
        text: { content: name.replace(/([A-Z])/g, " $1").trim(), position: "center", fontSize: 48, color: "#FFFFFF" },
      });
    }
  }

  return scenes;
}

// ── Reducer ─────────────────────────────────────────────────────────

const MAX_HISTORY = 50;

function editorReducer(state: EditorState, action: EditorAction): EditorState {
  const pushHistory = (newProject: VideoProject): EditorState => {
    const history = state.history.slice(0, state.historyIndex + 1);
    history.push(structuredClone(state.project));
    if (history.length > MAX_HISTORY) history.shift();
    return {
      ...state,
      project: newProject,
      isDirty: true,
      history,
      historyIndex: history.length - 1,
    };
  };

  switch (action.type) {
    case "SET_PROJECT": {
      const proj = { ...action.project };
      // When remotion_code exists, always derive scenes from it so timeline stays in sync
      if (proj.remotion_code?.trim()) {
        proj.scenes = extractScenesFromCode(proj.remotion_code);
      }
      return {
        ...state,
        project: proj,
        selectedSceneId: proj.scenes[0]?.id ?? null,
        isDirty: proj.scenes.length > 0 && action.project.scenes.length === 0, // dirty if we generated scenes
        history: [],
        historyIndex: -1,
      };
    }

    case "ADD_SCENE": {
      const scenes = [...state.project.scenes, action.scene].map((s, i) => ({
        ...s,
        order: i,
      }));
      return pushHistory({ ...state.project, scenes });
    }

    case "REMOVE_SCENE": {
      const scenes = state.project.scenes
        .filter((s) => s.id !== action.sceneId)
        .map((s, i) => ({ ...s, order: i }));
      return {
        ...pushHistory({ ...state.project, scenes }),
        selectedSceneId:
          state.selectedSceneId === action.sceneId
            ? scenes[0]?.id ?? null
            : state.selectedSceneId,
      };
    }

    case "UPDATE_SCENE": {
      const scenes = state.project.scenes.map((s) =>
        s.id === action.sceneId ? { ...s, ...action.updates } : s
      );
      return pushHistory({ ...state.project, scenes });
    }

    case "REORDER_SCENES": {
      const sceneMap = new Map(state.project.scenes.map((s) => [s.id, s]));
      const scenes = action.sceneIds
        .map((id) => sceneMap.get(id))
        .filter(Boolean)
        .map((s, i) => ({ ...s!, order: i }));
      return pushHistory({ ...state.project, scenes });
    }

    case "SELECT_SCENE":
      return { ...state, selectedSceneId: action.sceneId };

    case "SET_PANEL":
      return { ...state, activePanel: action.panel };

    case "SET_VOICEOVER":
      return pushHistory({ ...state.project, voiceover: action.voiceover });

    case "SET_MUSIC":
      return pushHistory({ ...state.project, music: action.music });

    case "ADD_SOUND_EFFECT": {
      const effects = [...(state.project.sound_effects ?? []), action.effect];
      return pushHistory({ ...state.project, sound_effects: effects });
    }

    case "REMOVE_SOUND_EFFECT": {
      const effects = (state.project.sound_effects ?? []).filter(
        (e) => e.id !== action.effectId
      );
      return pushHistory({ ...state.project, sound_effects: effects });
    }

    case "UPDATE_SETTINGS":
      return pushHistory({
        ...state.project,
        settings: { ...state.project.settings, ...action.settings },
      });

    case "SET_TITLE":
      return pushHistory({ ...state.project, title: action.title });

    case "SET_REMOTION_CODE": {
      const newProject = { ...state.project, remotion_code: action.code };
      // Always regenerate scenes from code so the timeline stays in sync
      if (action.code.trim()) {
        newProject.scenes = extractScenesFromCode(action.code);
      }
      return pushHistory(newProject);
    }

    case "SET_CHAT_MESSAGES": {
      // Update chat_messages without pushing to undo history (chat isn't undoable)
      return {
        ...state,
        project: { ...state.project, chat_messages: action.chatMessages },
        isDirty: true,
      };
    }

    case "SET_PLAYING":
      return { ...state, isPlaying: action.isPlaying };

    case "SET_FRAME":
      return { ...state, currentFrame: action.frame };

    case "SET_SAVING":
      return { ...state, isSaving: action.isSaving };

    case "MARK_CLEAN":
      return { ...state, isDirty: false };

    case "UNDO": {
      if (state.historyIndex < 0) return state;
      const project = structuredClone(state.history[state.historyIndex]);
      return {
        ...state,
        project,
        historyIndex: state.historyIndex - 1,
        isDirty: true,
      };
    }

    case "REDO": {
      if (state.historyIndex >= state.history.length - 1) return state;
      const nextIndex = state.historyIndex + 2;
      if (nextIndex >= state.history.length) return state;
      return {
        ...state,
        project: structuredClone(state.history[nextIndex]),
        historyIndex: state.historyIndex + 1,
        isDirty: true,
      };
    }

    default:
      return state;
  }
}

// ── Context ─────────────────────────────────────────────────────────

interface VideoEditorContextValue {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  // Chat-originated uploads (shown in Upload panel)
  chatUploads: ChatUploadedAsset[];
  addChatUpload: (asset: ChatUploadedAsset) => void;
  updateChatUpload: (url: string, updates: Partial<ChatUploadedAsset>) => void;
  // Frame capture — VideoPreview registers this; ChatPanel calls it
  captureFrameRef: MutableRefObject<(() => Promise<HTMLCanvasElement> | null) | null>;
  // Seek — VideoPreview registers this; Timeline calls it
  seekRef: MutableRefObject<((frame: number) => void) | null>;
  // Called on first message when no projectId exists yet — creates DB row + job
  triggerFirstSave: (() => Promise<VideoProject>) | null;
  // Convenience helpers
  addScene: (scene: VideoScene) => void;
  removeScene: (sceneId: string) => void;
  updateScene: (sceneId: string, updates: Partial<VideoScene>) => void;
  reorderScenes: (sceneIds: string[]) => void;
  selectScene: (sceneId: string | null) => void;
  setPanel: (panel: EditorPanel) => void;
  setVoiceover: (voiceover: VoiceoverTrack | undefined) => void;
  setMusic: (music: MusicTrack | undefined) => void;
  addSoundEffect: (effect: SoundEffect) => void;
  removeSoundEffect: (effectId: string) => void;
  updateSettings: (settings: Partial<VideoSettings>) => void;
  setTitle: (title: string) => void;
  setRemotionCode: (code: string) => void;
  setChatMessages: (messages: ChatMessagePersisted[]) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  selectedScene: VideoScene | null;
  totalDuration: number;
}

const VideoEditorContext = createContext<VideoEditorContextValue | null>(null);

// ── Provider ────────────────────────────────────────────────────────

function createDefaultProject(): VideoProject {
  return {
    id: "",
    organization_id: "",
    user_id: "",
    title: "Untitled Video",
    scenes: [],
    settings: {
      aspect_ratio: "portrait",
      caption_style: "hormozi",
    },
    status: "draft",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

interface VideoEditorProviderProps {
  children: ReactNode;
  initialProject?: VideoProject;
  onSave?: (project: VideoProject) => Promise<void>;
  onFirstSave?: () => Promise<VideoProject>;
}

export function VideoEditorProvider({
  children,
  initialProject,
  onSave,
  onFirstSave,
}: VideoEditorProviderProps) {
  const [chatUploads, setChatUploads] = useState<ChatUploadedAsset[]>([]);
  // VideoPreview sets this ref so ChatPanel can capture frames without prop drilling
  const captureFrameRef = useRef<(() => Promise<HTMLCanvasElement> | null) | null>(null);
  // VideoPreview sets this ref so Timeline can seek without prop drilling
  const seekRef = useRef<((frame: number) => void) | null>(null);

  const addChatUpload = useCallback((asset: ChatUploadedAsset) => {
    setChatUploads((prev) => [...prev, asset]);
  }, []);

  const updateChatUpload = useCallback((url: string, updates: Partial<ChatUploadedAsset>) => {
    setChatUploads((prev) => prev.map((a) => (a.url === url ? { ...a, ...updates } : a)));
  }, []);

  // When remotion_code exists, always derive scenes from it so timeline stays in sync
  const resolvedInitial = (() => {
    const proj = initialProject ?? createDefaultProject();
    if (proj.remotion_code?.trim()) {
      return { ...proj, scenes: extractScenesFromCode(proj.remotion_code) };
    }
    return proj;
  })();

  const [state, dispatch] = useReducer(editorReducer, {
    project: resolvedInitial,
    selectedSceneId: resolvedInitial.scenes[0]?.id ?? null,
    activePanel: "chat" as EditorPanel,
    isPlaying: false,
    currentFrame: 0,
    isSaving: false,
    isDirty: resolvedInitial.scenes.length > 0 && (initialProject?.scenes.length ?? 0) === 0, // trigger save if we generated scenes
    history: [],
    historyIndex: -1,
  });

  // Auto-save debounce — use ref for onSave to avoid effect retriggering
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const onFirstSaveRef = useRef(onFirstSave);
  onFirstSaveRef.current = onFirstSave;

  useEffect(() => {
    if (!state.isDirty || !onSaveRef.current || !state.project.id) return;

    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(async () => {
      const saveFn = onSaveRef.current;
      if (!saveFn) return;
      dispatch({ type: "SET_SAVING", isSaving: true });
      try {
        await saveFn(state.project);
        dispatch({ type: "MARK_CLEAN" });
      } catch (err) {
        console.error("[VideoEditor] Auto-save failed:", err);
      } finally {
        dispatch({ type: "SET_SAVING", isSaving: false });
      }
    }, 2000);

    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, [state.isDirty, state.project]);

  const addScene = useCallback(
    (scene: VideoScene) => dispatch({ type: "ADD_SCENE", scene }),
    []
  );
  const removeScene = useCallback(
    (sceneId: string) => dispatch({ type: "REMOVE_SCENE", sceneId }),
    []
  );
  const updateScene = useCallback(
    (sceneId: string, updates: Partial<VideoScene>) =>
      dispatch({ type: "UPDATE_SCENE", sceneId, updates }),
    []
  );
  const reorderScenes = useCallback(
    (sceneIds: string[]) => dispatch({ type: "REORDER_SCENES", sceneIds }),
    []
  );
  const selectScene = useCallback(
    (sceneId: string | null) => dispatch({ type: "SELECT_SCENE", sceneId }),
    []
  );
  const setPanel = useCallback(
    (panel: EditorPanel) => dispatch({ type: "SET_PANEL", panel }),
    []
  );
  const setVoiceover = useCallback(
    (voiceover: VoiceoverTrack | undefined) =>
      dispatch({ type: "SET_VOICEOVER", voiceover }),
    []
  );
  const setMusic = useCallback(
    (music: MusicTrack | undefined) =>
      dispatch({ type: "SET_MUSIC", music }),
    []
  );
  const addSoundEffect = useCallback(
    (effect: SoundEffect) => dispatch({ type: "ADD_SOUND_EFFECT", effect }),
    []
  );
  const removeSoundEffect = useCallback(
    (effectId: string) =>
      dispatch({ type: "REMOVE_SOUND_EFFECT", effectId }),
    []
  );
  const updateSettings = useCallback(
    (settings: Partial<VideoSettings>) =>
      dispatch({ type: "UPDATE_SETTINGS", settings }),
    []
  );
  const setTitle = useCallback(
    (title: string) => dispatch({ type: "SET_TITLE", title }),
    []
  );
  const setRemotionCode = useCallback(
    (code: string) => dispatch({ type: "SET_REMOTION_CODE", code }),
    []
  );
  const setChatMessages = useCallback(
    (chatMessages: ChatMessagePersisted[]) => dispatch({ type: "SET_CHAT_MESSAGES", chatMessages }),
    []
  );
  const triggerFirstSave = useCallback(async () => {
    const fn = onFirstSaveRef.current;
    if (!fn) throw new Error("No onFirstSave handler");
    return fn();
  }, []);
  const undo = useCallback(() => dispatch({ type: "UNDO" }), []);
  const redo = useCallback(() => dispatch({ type: "REDO" }), []);

  const selectedScene =
    state.project.scenes.find((s) => s.id === state.selectedSceneId) ?? null;

  // Total duration accounting for transition overlaps, matching EditorComposition
  const projectFps = state.project.settings.fps || 30;
  const transitionOverlap = TRANSITION_FRAMES / projectFps;
  const sortedScenesForDuration = [...state.project.scenes].sort((a, b) => a.order - b.order);
  const totalDuration = sortedScenesForDuration.reduce((sum, scene, i) => {
    const overlap = i < sortedScenesForDuration.length - 1 && scene.transition !== "none"
      ? transitionOverlap
      : 0;
    return sum + scene.duration - overlap;
  }, 0);

  const value: VideoEditorContextValue = {
    state,
    dispatch,
    chatUploads,
    addChatUpload,
    updateChatUpload,
    captureFrameRef,
    seekRef,
    triggerFirstSave: onFirstSaveRef.current ? triggerFirstSave : null,
    addScene,
    removeScene,
    updateScene,
    reorderScenes,
    selectScene,
    setPanel,
    setVoiceover,
    setMusic,
    addSoundEffect,
    removeSoundEffect,
    updateSettings,
    setTitle,
    setRemotionCode,
    setChatMessages,
    undo,
    redo,
    canUndo: state.historyIndex >= 0,
    canRedo: state.historyIndex < state.history.length - 1,
    selectedScene,
    totalDuration,
  };

  return (
    <VideoEditorContext.Provider value={value}>
      {children}
    </VideoEditorContext.Provider>
  );
}

export function useVideoEditor() {
  const ctx = useContext(VideoEditorContext);
  if (!ctx) {
    throw new Error("useVideoEditor must be used inside VideoEditorProvider");
  }
  return ctx;
}
