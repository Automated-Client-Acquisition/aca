/**
 * Shared types for all Remotion compositions in the video-renderer worker.
 *
 * These types are used both server-side (renderMedia) and client-side (@remotion/player).
 * Keep them pure TypeScript — no Node.js-specific imports.
 */

// ─── Camera Moves ────────────────────────────────────────────────────────────

export type CameraMoveType =
  | 'ken_burns_slow'
  | 'punch_zoom'
  | 'pan_left'
  | 'pan_right'
  | 'pan_down'
  | 'zoom_out_reveal'
  | 'shake'
  | 'tilt_3d'
  | 'snap_to'
  | 'hold';

export interface CameraMove {
  move: CameraMoveType;
  target_element?: string;
  start_scale?: number;
  end_scale?: number;
}

export interface CameraTransform {
  scale: number;
  x: number;
  y: number;
  rotateX?: number;
  rotateY?: number;
}

// ─── Highlights ──────────────────────────────────────────────────────────────

export type HighlightType =
  | 'red_circle'
  | 'underline_draw'
  | 'blur_except'
  | 'glow_pulse'
  | 'arrow'
  | 'fake_cursor_click'
  | 'magnify';

export interface HighlightConfig {
  type: HighlightType;
  target_element: string;
}

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ─── Text Animation Types ───────────────────────────────────────────────────

export type TextAnimationType =
  | 'spring_fade'
  | 'typewriter'
  | 'glitch'
  | 'wave'
  | 'bounce'
  | 'gradient_sweep';

// ─── Background Types ───────────────────────────────────────────────────────

export type BackgroundType =
  | 'solid'
  | 'gradient'
  | 'particles'
  | 'mesh_gradient'
  | 'gradient_orbs';

export interface BackgroundConfig {
  type: BackgroundType;
  /** Intensity (0-1). Controls prominence of the background effect. */
  intensity?: number;
}

// ─── Overlay Config ─────────────────────────────────────────────────────────

export interface OverlayConfig {
  vignette?: boolean;
  vignette_intensity?: number;
  grain?: boolean;
  grain_intensity?: number;
  letterbox?: boolean;
}

// ─── Transitions ─────────────────────────────────────────────────────────────

export type TransitionType =
  | 'cut_hard'
  | 'slam_zoom'
  | 'slide_left'
  | 'slide_up'
  | 'fade'
  | 'snap_cut'
  | 'whoosh'
  | 'crossfade'
  | 'zoom';

// ─── Subtitles / Captions ────────────────────────────────────────────────────

export type SubtitleStyle =
  | 'clean_white'
  | 'karaoke_bold'
  | 'boxed_yellow'
  | 'bounce_pop'
  | 'cinematic_lower'
  // Legacy aliases (mapped to new styles at compose time)
  | 'tiktok_bounce'
  | 'big_center'
  | 'karaoke'
  | 'minimal';

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

// ─── Brand Config ────────────────────────────────────────────────────────────

export interface BrandConfig {
  accent_color: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  logo_url?: string;
}

// ─── Sound Effects ───────────────────────────────────────────────────────────

export type SoundEffectType =
  | 'whoosh'
  | 'pop'
  | 'click'
  | 'ding'
  | 'boom'
  | 'record_scratch'
  | 'cash_register'
  | 'typing';

// ─── Text Overlay Styles ─────────────────────────────────────────────────────

export type TextStyle =
  | 'hook_dramatic'
  | 'stat_callout'
  | 'quote_highlight'
  | 'stat_card'
  | 'quote_card'
  | 'list_reveal'
  | 'gradient_title';

// ─── Layout Types ────────────────────────────────────────────────────────────

export type LayoutType =
  | 'avatar_pip'
  | 'split_left'
  | 'split_right'
  | 'avatar_fullscreen'
  | 'screenshot_fullscreen'
  | 'text_card'
  | 'stat_card'
  | 'quote_card'
  | 'list_reveal'
  | 'gradient_title'
  | 'broll_cutaway'
  | 'scene_image'
  | 'video_clip';

// ─── Screenshot Data ─────────────────────────────────────────────────────────

export interface ScreenshotData {
  url: string;
  narration_hint?: string;
  elements: ScreenshotElement[];
}

export interface ScreenshotElement {
  selector: string;
  bounds: ElementBounds;
  text?: string;
  type?: string;
}

// ─── Decoration Instance ────────────────────────────────────────────────────

export interface DecorationInstance {
  decoration_id: string;
  position: { x: number; y: number };
  scale: number;
  rotation?: number;
  start_frame_offset?: number;
  duration_frames?: number | null;
  config?: Record<string, any>;
}

// ─── Shot (Presenter Video) ──────────────────────────────────────────────────

export interface Shot {
  duration: number;
  layout: LayoutType;
  screenshot_index?: number;
  camera: CameraMove;
  narration: string;
  caption_emphasis: string[];
  caption_style?: SubtitleStyle;
  highlight?: HighlightConfig;
  text_overlay?: string;
  text_style?: TextStyle;
  transition_in: TransitionType;
  sound_effect?: SoundEffectType;
  // B-roll cutaway fields
  broll_src?: string;
  broll_type?: 'video' | 'image';
  broll_label?: string;
  // Stat card fields
  stat_value?: number | string;
  stat_label?: string;
  // Quote card fields
  quote_text?: string;
  quote_attribution?: string;
  // List reveal fields
  list_items?: string[];
  list_title?: string;
  // Gradient title fields
  subtitle?: string;
  // Elements library fields (all optional, non-breaking)
  text_animation?: TextAnimationType;
  background?: BackgroundConfig;
  overlay_config?: OverlayConfig;
  decorations?: DecorationInstance[];
  // Unified video pipeline fields (scene_image + video_clip layouts)
  scene_image_url?: string;      // For scene_image layout — full-screen AI/uploaded image
  source_start?: number;         // For video_clip layout — start time in source video (seconds)
  source_end?: number;           // For video_clip layout — end time in source video (seconds)
  speed?: number;                // For video_clip layout — playback speed multiplier
  image_prompt?: string;         // For AI image generation (storyboard mode, not rendered)
  b_roll_keywords?: string[];    // For b-roll fetching (not rendered, used upstream)
  screenshot_description?: string; // Director's description of what's in the screenshot (not rendered)
}

// ─── Presenter Video Props ───────────────────────────────────────────────────

export interface PresenterVideoProps {
  shots: Shot[];
  screenshots: ScreenshotData[];
  avatarVideoUrl: string | null;
  audioUrl: string;
  wordTimestamps: WordTimestamp[];
  brand: BrandConfig;
  orientation: 'portrait' | 'landscape';
  subtitleStyle: SubtitleStyle;
}

// ─── Scene Data (Storyboard Video) ───────────────────────────────────────────

export interface SceneData {
  imageUrl: string;
  durationSeconds: number;
  cameraMove: CameraMove;
  caption?: string;
}

// ─── Storyboard Video Props ──────────────────────────────────────────────────

export interface StoryboardVideoProps {
  scenes: SceneData[];
  voiceoverUrl: string;
  wordTimestamps: WordTimestamp[];
  subtitleStyle: SubtitleStyle;
  transitionType: TransitionType;
  transitionDurationFrames: number;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  brand: BrandConfig;
}

// ─── Editor Types ────────────────────────────────────────────────────────────

export interface EditorTrack {
  id: string;
  clipUrl: string;
  startFrame: number;
  durationFrames: number;
  trimStartFrames: number;
  volume: number;
}

export interface AudioTrack {
  id: string;
  url: string;
  startFrame: number;
  durationFrames: number;
  volume: number;
  label?: string;
}

export interface TextOverlayData {
  id: string;
  text: string;
  startFrame: number;
  durationFrames: number;
  x: number;
  y: number;
  fontSize: number;
  fontWeight: number;
  color: string;
  backgroundColor?: string;
  animation: 'none' | 'fade_in' | 'slide_up' | 'scale_in';
}

export interface TransitionData {
  id: string;
  afterTrackId: string;
  type: TransitionType;
  durationFrames: number;
}

// ─── Video Editor Props ──────────────────────────────────────────────────────

export interface VideoEditorProps {
  tracks: EditorTrack[];
  audioTracks: AudioTrack[];
  textOverlays: TextOverlayData[];
  transitions: TransitionData[];
  totalDurationFrames: number;
}

// ─── Edit Segment (Video Remix) ─────────────────────────────────────────────

export interface EditSegment {
  /** Unique segment ID for React keys */
  id: string;
  /** Type of segment */
  type: 'video' | 'text_card' | 'b_roll';
  /** Start time in source video (seconds) — only for type 'video' */
  source_start: number;
  /** End time in source video (seconds) — only for type 'video' */
  source_end: number;
  /** Playback speed multiplier (1.0 = normal, 1.5 = fast, 0.5 = slow) */
  speed: number;
  /** Transition into this segment */
  transition_in: TransitionType;
  /** Narration text for this segment (used for subtitles) */
  narration: string;
  /** Key words for subtitle emphasis */
  caption_emphasis: string[];
  /** Caption style */
  caption_style?: SubtitleStyle;
  /** Text overlay (lower third, title, etc.) */
  text_overlay?: string;
  text_style?: TextStyle;
  /** Sound effect on entry */
  sound_effect?: SoundEffectType;
  /** B-roll URL — only for type 'b_roll' */
  broll_src?: string;
  broll_type?: 'video' | 'image';
  /** Text card fields — only for type 'text_card' */
  card_text?: string;
  card_subtitle?: string;
  /** Camera move for text_card/b_roll types */
  camera?: CameraMove;
  /** Duration override in seconds (computed from source_end - source_start if not set) */
  duration?: number;
  /** B-roll keywords for downstream B-roll fetching */
  b_roll_keywords?: string[];
}

// ─── Video Remix Props ──────────────────────────────────────────────────────

export interface VideoRemixProps {
  /** Original source video URL (the FULL video) */
  sourceVideoUrl: string;
  /** Edit decision list — ordered segments to render */
  segments: EditSegment[];
  /** New voiceover audio URL (null if keep_original) */
  voiceoverUrl: string | null;
  /** Original extracted audio URL (used for keep_original mode) */
  originalAudioUrl: string | null;
  /** Word-level timestamps for subtitle rendering */
  wordTimestamps: WordTimestamp[];
  /** Voice option: determines audio layering strategy */
  voiceOption: 'keep_original' | 'new_voice' | 'avatar';
  /** Avatar video URL (for PIP overlay in avatar mode) */
  avatarVideoUrl: string | null;
  /** Brand config for text cards, subtitles, overlays */
  brand: BrandConfig;
  /** Video orientation */
  orientation: 'portrait' | 'landscape';
  /** Subtitle style */
  subtitleStyle: SubtitleStyle;
  /** Original video duration in seconds */
  sourceDurationSeconds: number;
}

// ─── Unified Video Props ─────────────────────────────────────────────────────

export interface UnifiedVideoProps {
  /** Shot list from unified director */
  shots: Shot[];
  /** Screenshots from web_capture stage (empty if not applicable) */
  screenshots: ScreenshotData[];
  /** Source video URL from video_ingest stage (null if not applicable) */
  sourceVideoUrl: string | null;
  /** Source video duration in seconds */
  sourceDurationSeconds: number;
  /** AI voiceover audio URL */
  audioUrl: string | null;
  /** Original extracted audio from source video (for keep_original mode) */
  originalAudioUrl: string | null;
  /** Word-level timestamps for subtitle rendering */
  wordTimestamps: WordTimestamp[];
  /** Voice mode determines audio layering */
  voiceMode: 'voiceover' | 'avatar' | 'keep_original' | 'none';
  /** Avatar video URL (lip-synced talking head) */
  avatarVideoUrl: string | null;
  /** Brand config for styling */
  brand: BrandConfig;
  /** Video orientation */
  orientation: 'portrait' | 'landscape';
  /** Subtitle style */
  subtitleStyle: SubtitleStyle;
  /** Default transition type between shots */
  transitionType?: TransitionType;
  /** Background music URL */
  backgroundMusicUrl?: string;
  /** Background music volume (0-1) */
  backgroundMusicVolume?: number;
}

// ─── Render Options ──────────────────────────────────────────────────────────

export type CompositionId = 'EditorComposition';

export interface OutputOptions {
  orientation: 'portrait' | 'landscape';
  outputId: string;
}

// ─── Avatar Position ─────────────────────────────────────────────────────────

export type AvatarPosition =
  | 'bottom_right'
  | 'bottom_left'
  | 'top_right'
  | 'top_left';

// ─── Cursor Animation ────────────────────────────────────────────────────────

export interface CursorTarget {
  x: number;
  y: number;
  clickDelay?: number;
}
