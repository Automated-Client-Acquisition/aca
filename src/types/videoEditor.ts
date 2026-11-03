// ── Video Editor Types ──────────────────────────────────────────────

export type AspectRatio = 'portrait' | 'landscape' | 'square';

export type CaptionStyleId =
  | 'hormozi'
  | 'tiktok_bounce'
  | 'karaoke'
  | 'bold_punch'
  | 'minimal'
  | 'boxed'
  | 'none';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface BrandConfig {
  primary_color?: string;
  accent_color?: string;
  font_family?: string;
}

export interface VideoResolution {
  width: number;
  height: number;
  fps: number;
}

/**
 * Resolution scale factors by preset.
 * Base dimensions are for 1080p; others scale proportionally.
 */
const RESOLUTION_SCALES: Record<ResolutionPreset, number> = {
  '720p': 720 / 1080,
  '1080p': 1,
  '4k': 3840 / 1920,
};

export function getResolution(
  aspectRatio: AspectRatio | string,
  resolutionPreset?: ResolutionPreset,
  fpsOverride?: FpsPreset,
): VideoResolution {
  // Base 1080p dimensions
  let width: number;
  let height: number;
  switch (aspectRatio) {
    case 'portrait': case '9:16': width = 1080; height = 1920; break;
    case 'square': case '1:1': width = 1080; height = 1080; break;
    case 'landscape': case '16:9': default: width = 1920; height = 1080; break;
  }

  // Scale to resolution preset
  if (resolutionPreset && resolutionPreset !== '1080p') {
    const scale = RESOLUTION_SCALES[resolutionPreset];
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    // Ensure even dimensions (required by video codecs)
    width = width % 2 === 0 ? width : width + 1;
    height = height % 2 === 0 ? height : height + 1;
  }

  return { width, height, fps: fpsOverride ?? 30 };
}

// ── Caption Presets ─────────────────────────────────────────────────

export interface CaptionPreset {
  fontSize: number;
  fontWeight: number;
  fontFamily: string;
  color: string;
  activeColor: string;
  highlightColor?: string;
  textShadow: string;
  position: 'bottom' | 'center' | 'top';
  wordsPerChunk: number;
  uppercase: boolean;
  animation: 'bounce' | 'scale' | 'fill' | 'box' | 'none';
}

export const CAPTION_PRESETS: Record<Exclude<CaptionStyleId, 'none'>, CaptionPreset> = {
  hormozi: {
    fontSize: 80,
    fontWeight: 900,
    fontFamily: 'Arial Black, Arial, sans-serif',
    color: '#FFFFFF',
    activeColor: '#FFD700',
    textShadow: '0 4px 12px rgba(0,0,0,0.9), 0 2px 4px rgba(0,0,0,0.5)',
    position: 'center',
    wordsPerChunk: 3,
    uppercase: true,
    animation: 'scale',
  },
  tiktok_bounce: {
    fontSize: 56,
    fontWeight: 800,
    fontFamily: 'Arial, sans-serif',
    color: '#FFFFFF',
    activeColor: '#FF4444',
    textShadow: '0 2px 8px rgba(0,0,0,0.8)',
    position: 'bottom',
    wordsPerChunk: 4,
    uppercase: false,
    animation: 'bounce',
  },
  karaoke: {
    fontSize: 64,
    fontWeight: 800,
    fontFamily: 'Arial, sans-serif',
    color: 'rgba(255,255,255,0.4)',
    activeColor: '#FFFFFF',
    textShadow: '0 2px 8px rgba(0,0,0,0.7)',
    position: 'bottom',
    wordsPerChunk: 5,
    uppercase: false,
    animation: 'fill',
  },
  bold_punch: {
    fontSize: 72,
    fontWeight: 900,
    fontFamily: 'Impact, Arial Black, sans-serif',
    color: '#FFFFFF',
    activeColor: '#00FF88',
    textShadow: '0 4px 16px rgba(0,0,0,0.9)',
    position: 'center',
    wordsPerChunk: 3,
    uppercase: true,
    animation: 'scale',
  },
  minimal: {
    fontSize: 44,
    fontWeight: 600,
    fontFamily: 'Arial, sans-serif',
    color: '#FFFFFF',
    activeColor: '#FFFFFF',
    textShadow: '0 1px 4px rgba(0,0,0,0.6)',
    position: 'bottom',
    wordsPerChunk: 6,
    uppercase: false,
    animation: 'none',
  },
  boxed: {
    fontSize: 56,
    fontWeight: 800,
    fontFamily: 'Arial, sans-serif',
    color: '#FFFFFF',
    activeColor: '#FFFFFF',
    highlightColor: '#FF0050',
    textShadow: 'none',
    position: 'bottom',
    wordsPerChunk: 4,
    uppercase: false,
    animation: 'box',
  },
};

// ── Scene Types ─────────────────────────────────────────────────────

export type MediaSource = 'stock' | 'ai_image' | 'ai_video' | 'uploaded';
export type TransitionType = 'fade' | 'slide' | 'wipe' | 'none';

export interface SceneMedia {
  type: 'video' | 'image' | 'color';
  url: string;
  thumbnail_url?: string;
  source: MediaSource;
  prompt?: string;
}

export interface SceneText {
  content: string;
  position: 'top' | 'center' | 'bottom';
  fontSize: number;
  color: string;
  backgroundColor?: string;
}

export interface VideoScene {
  id: string;
  order: number;
  duration: number;
  media: SceneMedia;
  text?: SceneText;
  transition: TransitionType;
  /** If set, render a skill composition instead of generic media+text */
  skill_composition?: {
    id: string;
    props: Record<string, unknown>;
  };
}

// ── Audio Types ─────────────────────────────────────────────────────

export interface VoiceoverTrack {
  url: string;
  word_timestamps?: WordTimestamp[];
  voice_id?: string;
  source: 'ai' | 'uploaded';
  script?: string;
}

export interface MusicTrack {
  url: string;
  title?: string;
  volume: number;
  source: 'library' | 'uploaded' | 'ai';
}

export interface SoundEffect {
  id: string;
  url: string;
  name: string;
  timestamp: number;
  duration: number;
  volume: number;
}

// ── Project Types ───────────────────────────────────────────────────

export type ProjectStatus = 'draft' | 'rendering' | 'completed' | 'failed';

export type CaptionPosition = 'top' | 'center' | 'bottom';

export type ResolutionPreset = '720p' | '1080p' | '4k';
export type FpsPreset = 24 | 30 | 60;

export interface VideoSettings {
  aspect_ratio: AspectRatio;
  caption_style: CaptionStyleId;
  caption_position?: CaptionPosition;
  caption_font_size?: number;
  brand?: BrandConfig;
  resolution?: ResolutionPreset;
  fps?: FpsPreset;
}

export interface VideoProject {
  id: string;
  organization_id: string;
  user_id: string;
  title: string;
  scenes: VideoScene[];
  settings: VideoSettings;
  voiceover?: VoiceoverTrack;
  music?: MusicTrack;
  sound_effects?: SoundEffect[];
  status: ProjectStatus;
  output_url?: string;
  thumbnail_url?: string;
  /** Remotion TSX code pushed by external agents via MCP or generated in Code Mode */
  remotion_code?: string;
  created_at: string;
  updated_at: string;
}

// ── Stock Media Types ───────────────────────────────────────────────

export interface StockVideo {
  id: string;
  url: string;
  thumbnail_url: string;
  duration: number;
  width: number;
  height: number;
  source: 'pexels';
}

export interface StockImage {
  id: string;
  url: string;
  thumbnail_url: string;
  width: number;
  height: number;
  source: 'pexels';
}

// ── Editor State Types ──────────────────────────────────────────────

export type EditorPanel = 'chat' | 'scenes' | 'stock' | 'ai_image' | 'ai_video' | 'upload' | 'voiceover' | 'music' | 'sfx' | 'text' | 'captions' | 'blueprints' | 'saved_assets' | 'code';

export interface ChatUploadedAsset {
  url: string;
  type: 'video' | 'image';
  name: string;
  transcriptionState?: 'idle' | 'loading' | 'done' | 'error';
}

export interface EditorState {
  project: VideoProject;
  selectedSceneId: string | null;
  activePanel: EditorPanel;
  isPlaying: boolean;
  currentFrame: number;
  isSaving: boolean;
  isDirty: boolean;
  history: VideoProject[];
  historyIndex: number;
}

export type EditorAction =
  | { type: 'SET_PROJECT'; project: VideoProject }
  | { type: 'ADD_SCENE'; scene: VideoScene }
  | { type: 'REMOVE_SCENE'; sceneId: string }
  | { type: 'UPDATE_SCENE'; sceneId: string; updates: Partial<VideoScene> }
  | { type: 'REORDER_SCENES'; sceneIds: string[] }
  | { type: 'SELECT_SCENE'; sceneId: string | null }
  | { type: 'SET_PANEL'; panel: EditorPanel }
  | { type: 'SET_VOICEOVER'; voiceover: VoiceoverTrack | undefined }
  | { type: 'SET_MUSIC'; music: MusicTrack | undefined }
  | { type: 'ADD_SOUND_EFFECT'; effect: SoundEffect }
  | { type: 'REMOVE_SOUND_EFFECT'; effectId: string }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<VideoSettings> }
  | { type: 'SET_TITLE'; title: string }
  | { type: 'SET_REMOTION_CODE'; code: string }
  | { type: 'SET_PLAYING'; isPlaying: boolean }
  | { type: 'SET_FRAME'; frame: number }
  | { type: 'SET_SAVING'; isSaving: boolean }
  | { type: 'MARK_CLEAN' }
  | { type: 'UNDO' }
  | { type: 'REDO' };
