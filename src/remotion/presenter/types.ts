/**
 * Shared types for presenter video Remotion compositions (client-side).
 *
 * Subset of workers/video-renderer/src/remotion/types.ts — kept in sync manually.
 * Only includes types needed for the single-shot preview player.
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

// ─── Text Overlay Styles ─────────────────────────────────────────────────────

export type TextStyle =
  | 'hook_dramatic'
  | 'stat_callout'
  | 'quote_highlight'
  | 'stat_card'
  | 'quote_card'
  | 'list_reveal'
  | 'gradient_title';

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
  | 'tiktok_bounce'
  | 'big_center'
  | 'karaoke'
  | 'minimal';

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

// ─── Brand Config ────────────────────────────────────────────────────────────

export interface BrandConfig {
  accent_color: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  logo_url?: string;
}

export const DEFAULT_BRAND: BrandConfig = {
  accent_color: '#D4AF37',
  primary_color: '#1a1a2e',
  background_color: '#000000',
  text_color: '#FFFFFF',
  font_family: 'Inter, sans-serif',
};

// ─── Screenshot Data ─────────────────────────────────────────────────────────

export interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotElement {
  selector: string;
  bounds: ElementBounds;
  text?: string;
  type?: string;
}

export interface ScreenshotData {
  url: string;
  narration_hint?: string;
  elements: ScreenshotElement[];
}

// ─── Word Timestamps ─────────────────────────────────────────────────────────

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
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
  scene_image_url?: string;
  source_start?: number;
  source_end?: number;
  speed?: number;
  image_prompt?: string;
  b_roll_keywords?: string[];
  screenshot_description?: string;
}
