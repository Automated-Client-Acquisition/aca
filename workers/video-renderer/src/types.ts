export type ResolutionPreset = '720p' | '1080p' | '4k';
export type FpsPreset = 24 | 30 | 60;

/** Input data for the Remotion video renderer */
export interface RenderInput {
  output_id: string;
  organization_id: string;
  clips: ClipData[];
  audio_url?: string;
  word_timestamps?: WordTimestamp[];
  aspect_ratio: 'portrait' | 'landscape' | 'square';
  resolution?: ResolutionPreset;
  fps?: FpsPreset;
  caption_style?: CaptionStyleId;
  brand?: BrandConfig;
  background_music_url?: string;
  background_music_volume?: number;
  sound_effects?: SoundEffectInput[];
  /** Arbitrary Remotion composition code (JSX/TSX string) */
  remotion_code?: string;
  /** Supabase config for storage upload */
  supabase_url: string;
  supabase_key: string;
  encryption_key?: string;
}

export interface ClipData {
  scene_number: number;
  media_type: 'video' | 'image' | 'color';
  /** Video/image URL, or CSS color string for color scenes */
  url: string;
  duration?: number;
  /** Text overlay for the scene */
  text?: {
    content: string;
    position: 'top' | 'center' | 'bottom';
    fontSize: number;
    color: string;
    backgroundColor?: string;
  };
  /** Transition type when entering this clip */
  transition?: 'fade' | 'slide' | 'wipe' | 'none';
}

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

export interface SoundEffectInput {
  url: string;
  timestamp: number;
  duration: number;
  volume: number;
}

/** Caption style presets — matches Revid quality */
export type CaptionStyleId =
  | 'hormozi'        // Big bold, center, yellow highlight on active word
  | 'tiktok_bounce'  // Bouncing words, bottom third, white + highlight
  | 'karaoke'        // Color fill progression left-to-right
  | 'bold_punch'     // Large uppercase, scale-in active word
  | 'minimal'        // Clean white, no animation
  | 'boxed'          // Active word in colored box
  | 'none';          // No captions

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

export interface VideoResolution {
  width: number;
  height: number;
  fps: number;
}

const RESOLUTION_SCALES: Record<ResolutionPreset, number> = {
  '720p': 720 / 1080,
  '1080p': 1,
  '4k': 3840 / 1920,
};

export function getResolution(
  aspectRatio: string,
  resolutionPreset?: ResolutionPreset,
  fpsOverride?: FpsPreset,
): VideoResolution {
  let width: number;
  let height: number;
  switch (aspectRatio) {
    case 'portrait': case '9:16': width = 1080; height = 1920; break;
    case 'square': case '1:1': width = 1080; height = 1080; break;
    case 'landscape': case '16:9': default: width = 1920; height = 1080; break;
  }

  if (resolutionPreset && resolutionPreset !== '1080p') {
    const scale = RESOLUTION_SCALES[resolutionPreset];
    width = Math.round(width * scale);
    height = Math.round(height * scale);
    width = width % 2 === 0 ? width : width + 1;
    height = height % 2 === 0 ? height : height + 1;
  }

  return { width, height, fps: fpsOverride ?? 30 };
}

/**
 * Parse metadata comments from remotion_code (same logic as frontend useDynamicComposition).
 * Supports: // @duration 5s, // @fps 30, // @width 1080, // @height 1920, // @aspect portrait
 */
export function parseRemotionCodeMeta(code: string): Partial<{ durationInFrames: number; fps: number; width: number; height: number }> {
  const meta: Partial<{ durationInFrames: number; fps: number; width: number; height: number }> = {};
  const lines = code.split('\n').slice(0, 20);

  for (const line of lines) {
    const trimmed = line.trim();
    const durationMatch = trimmed.match(/\/\/\s*@duration\s+(\d+(?:\.\d+)?)(s|frames?)?/i);
    if (durationMatch) {
      const val = parseFloat(durationMatch[1]);
      const unit = durationMatch[2]?.toLowerCase();
      const fps = meta.fps ?? 30;
      meta.durationInFrames = unit === 's' || !unit ? Math.round(val * fps) : Math.round(val);
    }
    const fpsMatch = trimmed.match(/\/\/\s*@fps\s+(\d+)/i);
    if (fpsMatch) meta.fps = parseInt(fpsMatch[1]);
    const widthMatch = trimmed.match(/\/\/\s*@width\s+(\d+)/i);
    if (widthMatch) meta.width = parseInt(widthMatch[1]);
    const heightMatch = trimmed.match(/\/\/\s*@height\s+(\d+)/i);
    if (heightMatch) meta.height = parseInt(heightMatch[1]);
    const aspectMatch = trimmed.match(/\/\/\s*@aspect\s+(portrait|landscape|square)/i);
    if (aspectMatch) {
      const aspect = aspectMatch[1].toLowerCase();
      if (aspect === 'portrait') { meta.width = 1080; meta.height = 1920; }
      else if (aspect === 'landscape') { meta.width = 1920; meta.height = 1080; }
      else if (aspect === 'square') { meta.width = 1080; meta.height = 1080; }
    }
  }

  return meta;
}
