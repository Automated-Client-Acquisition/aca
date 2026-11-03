/**
 * Editor State — Track-Based Data Model (Frontend)
 *
 * Mirrors supabase/functions/_shared/editorState.ts types.
 * Includes types and a CompositionInput → EditorState transformer for preview reconstruction.
 */

// ─── Shared Value Types ─────────────────────────────────────────────────────

export type CameraMoveType =
  | 'ken_burns_slow' | 'punch_zoom' | 'pan_left' | 'pan_right' | 'pan_down'
  | 'zoom_out_reveal' | 'shake' | 'tilt_3d' | 'snap_to' | 'hold';

export type TransitionType =
  | 'cut_hard' | 'slam_zoom' | 'slide_left' | 'slide_up' | 'fade'
  | 'snap_cut' | 'whoosh' | 'crossfade' | 'zoom';

export type SubtitleStyle =
  | 'clean_white' | 'karaoke_bold' | 'boxed_yellow' | 'bounce_pop'
  | 'cinematic_lower' | 'tiktok_bounce' | 'big_center' | 'karaoke' | 'minimal';

export type TextAnimationType =
  | 'spring_fade' | 'typewriter' | 'glitch' | 'wave' | 'bounce' | 'gradient_sweep';

export type BackgroundType =
  | 'solid' | 'gradient' | 'particles' | 'mesh_gradient' | 'gradient_orbs';

export interface BackgroundConfig {
  type: BackgroundType;
  intensity?: number;
}

export interface WordTimestamp {
  word: string;
  start: number;
  end: number;
}

export interface BrandConfig {
  accent_color: string;
  primary_color: string;
  background_color: string;
  text_color: string;
  font_family: string;
  logo_url?: string;
}

// ─── Assets ─────────────────────────────────────────────────────────────────

export interface ImageAsset {
  type: 'image';
  id: string;
  src: string;
  name: string;
  width: number;
  height: number;
}

export interface VideoAsset {
  type: 'video';
  id: string;
  src: string;
  name: string;
  durationInFrames: number;
  width: number;
  height: number;
}

export interface AudioAsset {
  type: 'audio';
  id: string;
  src: string;
  name: string;
  durationInFrames: number;
}

export interface CaptionAsset {
  type: 'caption';
  id: string;
  name: string;
  wordTimestamps: WordTimestamp[];
}

export type Asset = ImageAsset | VideoAsset | AudioAsset | CaptionAsset;

// ─── Items ──────────────────────────────────────────────────────────────────

export type BaseItem = {
  id: string;
  from: number;
  durationInFrames: number;
};

export type VideoItem = BaseItem & {
  type: 'video';
  assetId: string;
  trimStartFrames: number;
  trimEndFrames: number;
  playbackRate: number;
  volume: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ImageItem = BaseItem & {
  type: 'image';
  assetId: string;
  camera?: {
    move: CameraMoveType;
    startScale?: number;
    endScale?: number;
  };
  x: number;
  y: number;
  width: number;
  height: number;
};

export type TextItem = BaseItem & {
  type: 'text';
  text: string;
  color: string;
  fontSize: number;
  fontWeight: number;
  fontFamily?: string;
  lineHeight?: number;
  letterSpacing?: number;
  textAlign?: 'left' | 'center' | 'right';
  textStyle?: 'text_card' | 'stat_card' | 'quote_card' | 'list_reveal' | 'gradient_title';
  textAnimation?: TextAnimationType;
  statValue?: string;
  statLabel?: string;
  quoteAttribution?: string;
  listItems?: string[];
  background?: BackgroundConfig;
  transition?: { type: TransitionType; durationInFrames: number };
};

export type SolidItem = BaseItem & {
  type: 'solid';
  color: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AudioItem = BaseItem & {
  type: 'audio';
  assetId: string;
  volume: number;
  fadeInFrames: number;
  fadeOutFrames: number;
};

export type CaptionsItem = BaseItem & {
  type: 'captions';
  assetId: string;
  captionStyle: SubtitleStyle;
  highlightColor?: string;
  maxLines?: number;
};

export type OverlayItem = BaseItem & {
  type: 'overlay';
  overlayType: 'vignette' | 'grain' | 'letterbox';
  intensity: number;
};

export type Item =
  | VideoItem
  | ImageItem
  | TextItem
  | SolidItem
  | AudioItem
  | CaptionsItem
  | OverlayItem;

// ─── Tracks ─────────────────────────────────────────────────────────────────

export interface Track {
  name: string;
  items: Item[];
  muted: boolean;
  hidden: boolean;
}

// ─── Editor State ───────────────────────────────────────────────────────────

export interface EditorState {
  assets: Asset[];
  tracks: Track[];
  fps: number;
  width: number;
  height: number;
  durationInFrames: number;
  brand: BrandConfig;
}

// ─── Shot type (input from director stage) ──────────────────────────────────

export interface ShotInput {
  duration: number;
  layout: string;
  screenshot_index?: number;
  camera: { move: CameraMoveType; target_element?: string; start_scale?: number; end_scale?: number };
  narration: string;
  caption_emphasis: string[];
  caption_style?: SubtitleStyle;
  highlight?: { type: string; target_element: string };
  text_overlay?: string;
  text_style?: string;
  transition_in: TransitionType;
  sound_effect?: string;
  broll_src?: string;
  broll_type?: 'video' | 'image';
  broll_label?: string;
  stat_value?: number | string;
  stat_label?: string;
  quote_text?: string;
  quote_attribution?: string;
  list_items?: string[];
  list_title?: string;
  subtitle?: string;
  text_animation?: TextAnimationType;
  background?: BackgroundConfig;
  overlay_config?: {
    vignette?: boolean;
    vignette_intensity?: number;
    grain?: boolean;
    grain_intensity?: number;
    letterbox?: boolean;
  };
  scene_image_url?: string;
  source_start?: number;
  source_end?: number;
  speed?: number;
}

/** Props available at composition time (mirrors VideoComposeHandler output) */
export interface CompositionInput {
  shots: ShotInput[];
  screenshots: Array<{ url: string; narration_hint?: string; elements: Array<{ selector: string; bounds: { x: number; y: number; width: number; height: number } }> }>;
  sourceVideoUrl: string | null;
  sourceDurationSeconds: number;
  audioUrl: string | null;
  originalAudioUrl: string | null;
  wordTimestamps: WordTimestamp[];
  voiceMode: 'voiceover' | 'avatar' | 'keep_original' | 'none';
  avatarVideoUrl: string | null;
  brand: BrandConfig;
  orientation: 'portrait' | 'landscape';
  subtitleStyle: SubtitleStyle;
  transitionType?: TransitionType;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  soundEffects?: Array<{ url: string; timestamp: number; duration: number; volume: number }>;
}

// ─── Transformer: CompositionInput → EditorState ────────────────────────────

/**
 * Transform the legacy CompositionInput (Shot[] + audio + screenshots) into
 * the unified track-based EditorState.
 */
export function compositionInputToEditorState(input: CompositionInput): EditorState {
  let assetCounter = 0;
  let itemCounter = 0;

  function makeId(prefix: string): string {
    return `${prefix}_${++assetCounter}_${Date.now().toString(36)}`;
  }

  function makeItemId(prefix: string): string {
    return `${prefix}_${++itemCounter}_${Date.now().toString(36)}`;
  }

  const fps = 30;
  const isPortrait = input.orientation === 'portrait';
  const width = isPortrait ? 1080 : 1920;
  const height = isPortrait ? 1920 : 1080;

  const assets: Asset[] = [];
  const mainVisualItems: Item[] = [];
  const pipItems: Item[] = [];
  const voiceoverItems: Item[] = [];
  const musicItems: Item[] = [];
  const captionItems: Item[] = [];
  const overlayItems: Item[] = [];

  let currentFrame = 0;

  for (const shot of input.shots) {
    const durationInFrames = Math.round(shot.duration * fps);
    if (durationInFrames <= 0) continue;

    const layout = shot.layout;

    if (layout === 'screenshot_fullscreen' || layout === 'avatar_pip' || layout === 'split_left' || layout === 'split_right') {
      const ssIndex = shot.screenshot_index ?? 0;
      const ss = input.screenshots[ssIndex];
      if (ss?.url) {
        const assetId = makeId('img');
        assets.push({ type: 'image', id: assetId, src: ss.url, name: `screenshot_${ssIndex}`, width, height });
        mainVisualItems.push({
          type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          camera: { move: shot.camera?.move || 'hold', startScale: shot.camera?.start_scale, endScale: shot.camera?.end_scale },
          x: 0, y: 0, width, height,
        } satisfies ImageItem);
      }
    } else if (layout === 'scene_image') {
      if (shot.scene_image_url) {
        const assetId = makeId('img');
        assets.push({ type: 'image', id: assetId, src: shot.scene_image_url, name: 'scene_image', width, height });
        mainVisualItems.push({
          type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          camera: { move: shot.camera?.move || 'ken_burns_slow', startScale: shot.camera?.start_scale, endScale: shot.camera?.end_scale },
          x: 0, y: 0, width, height,
        } satisfies ImageItem);
      }
    } else if (layout === 'video_clip') {
      if (input.sourceVideoUrl) {
        let videoAssetId = assets.find(a => a.type === 'video' && a.src === input.sourceVideoUrl)?.id;
        if (!videoAssetId) {
          videoAssetId = makeId('vid');
          assets.push({ type: 'video', id: videoAssetId, src: input.sourceVideoUrl, name: 'source_video', durationInFrames: Math.round(input.sourceDurationSeconds * fps), width, height });
        }
        mainVisualItems.push({
          type: 'video', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId: videoAssetId,
          trimStartFrames: Math.round((shot.source_start || 0) * fps), trimEndFrames: Math.round((shot.source_end || shot.duration) * fps),
          playbackRate: shot.speed || 1, volume: 0, x: 0, y: 0, width, height,
        } satisfies VideoItem);
      }
    } else if (layout === 'broll_cutaway') {
      if (shot.broll_src) {
        if (shot.broll_type === 'video') {
          const assetId = makeId('vid');
          assets.push({ type: 'video', id: assetId, src: shot.broll_src, name: shot.broll_label || 'broll', durationInFrames: durationInFrames * 2, width, height });
          mainVisualItems.push({
            type: 'video', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
            trimStartFrames: 0, trimEndFrames: durationInFrames, playbackRate: 1, volume: 0, x: 0, y: 0, width, height,
          } satisfies VideoItem);
        } else {
          const assetId = makeId('img');
          assets.push({ type: 'image', id: assetId, src: shot.broll_src, name: shot.broll_label || 'broll', width, height });
          mainVisualItems.push({
            type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
            camera: { move: 'ken_burns_slow' }, x: 0, y: 0, width, height,
          } satisfies ImageItem);
        }
      }
    } else if (
      layout === 'text_card' || layout === 'stat_card' || layout === 'quote_card' ||
      layout === 'list_reveal' || layout === 'gradient_title'
    ) {
      mainVisualItems.push({
        type: 'solid', id: makeItemId('bg'), from: currentFrame, durationInFrames,
        color: input.brand.background_color, x: 0, y: 0, width, height,
      } satisfies SolidItem);

      let text = shot.text_overlay || shot.narration || '';
      if (layout === 'quote_card') text = shot.quote_text || text;

      mainVisualItems.push({
        type: 'text', id: makeItemId('txt'), from: currentFrame, durationInFrames, text,
        color: input.brand.text_color,
        fontSize: layout === 'gradient_title' ? 72 : layout === 'stat_card' ? 48 : 42,
        fontWeight: layout === 'gradient_title' || layout === 'stat_card' ? 700 : 400,
        textAlign: 'center',
        textStyle: layout as TextItem['textStyle'],
        textAnimation: shot.text_animation,
        statValue: shot.stat_value != null ? String(shot.stat_value) : undefined,
        statLabel: shot.stat_label,
        quoteAttribution: shot.quote_attribution,
        listItems: shot.list_items,
        background: shot.background,
        transition: shot.transition_in !== 'cut_hard'
          ? { type: shot.transition_in, durationInFrames: Math.round(fps * 0.5) }
          : undefined,
      } satisfies TextItem);
    } else if (layout === 'avatar_fullscreen') {
      mainVisualItems.push({
        type: 'solid', id: makeItemId('bg'), from: currentFrame, durationInFrames,
        color: input.brand.background_color, x: 0, y: 0, width, height,
      } satisfies SolidItem);
    }

    if (shot.overlay_config) {
      const oc = shot.overlay_config;
      if (oc.vignette) overlayItems.push({ type: 'overlay', id: makeItemId('ovl'), from: currentFrame, durationInFrames, overlayType: 'vignette', intensity: oc.vignette_intensity ?? 0.5 } satisfies OverlayItem);
      if (oc.grain) overlayItems.push({ type: 'overlay', id: makeItemId('ovl'), from: currentFrame, durationInFrames, overlayType: 'grain', intensity: oc.grain_intensity ?? 0.3 } satisfies OverlayItem);
      if (oc.letterbox) overlayItems.push({ type: 'overlay', id: makeItemId('ovl'), from: currentFrame, durationInFrames, overlayType: 'letterbox', intensity: 1 } satisfies OverlayItem);
    }

    currentFrame += durationInFrames;
  }

  const totalDurationInFrames = currentFrame;

  if (input.avatarVideoUrl && (input.voiceMode === 'avatar' || input.voiceMode === 'voiceover')) {
    const avatarAssetId = makeId('vid');
    assets.push({ type: 'video', id: avatarAssetId, src: input.avatarVideoUrl, name: 'avatar', durationInFrames: totalDurationInFrames, width: isPortrait ? 300 : 400, height: isPortrait ? 300 : 400 });
    const pipSize = isPortrait ? 280 : 320;
    const margin = 40;
    pipItems.push({
      type: 'video', id: makeItemId('pip'), from: 0, durationInFrames: totalDurationInFrames, assetId: avatarAssetId,
      trimStartFrames: 0, trimEndFrames: totalDurationInFrames, playbackRate: 1, volume: 0,
      x: width - pipSize - margin, y: height - pipSize - margin, width: pipSize, height: pipSize,
    } satisfies VideoItem);
  }

  const effectiveAudioUrl = input.audioUrl || input.originalAudioUrl;
  if (effectiveAudioUrl) {
    const audioAssetId = makeId('aud');
    assets.push({ type: 'audio', id: audioAssetId, src: effectiveAudioUrl, name: input.voiceMode === 'keep_original' ? 'original_audio' : 'voiceover', durationInFrames: totalDurationInFrames });
    voiceoverItems.push({
      type: 'audio', id: makeItemId('vo'), from: 0, durationInFrames: totalDurationInFrames, assetId: audioAssetId,
      volume: 1, fadeInFrames: 0, fadeOutFrames: Math.round(fps * 0.5),
    } satisfies AudioItem);
  }

  if (input.backgroundMusicUrl) {
    const musicAssetId = makeId('aud');
    assets.push({ type: 'audio', id: musicAssetId, src: input.backgroundMusicUrl, name: 'background_music', durationInFrames: totalDurationInFrames });
    musicItems.push({
      type: 'audio', id: makeItemId('mus'), from: 0, durationInFrames: totalDurationInFrames, assetId: musicAssetId,
      volume: input.backgroundMusicVolume ?? 0.1, fadeInFrames: Math.round(fps * 2), fadeOutFrames: Math.round(fps * 3),
    } satisfies AudioItem);
  }

  const sfxItems: Item[] = [];
  if (input.soundEffects?.length) {
    for (const sfx of input.soundEffects) {
      const sfxAssetId = makeId('aud');
      const sfxFrom = Math.round(sfx.timestamp * fps);
      const sfxDuration = Math.round(sfx.duration * fps);
      assets.push({ type: 'audio', id: sfxAssetId, src: sfx.url, name: 'sound_effect', durationInFrames: sfxDuration });
      sfxItems.push({
        type: 'audio', id: makeItemId('sfx'), from: sfxFrom, durationInFrames: sfxDuration, assetId: sfxAssetId,
        volume: sfx.volume ?? 0.7, fadeInFrames: 0, fadeOutFrames: 0,
      } satisfies AudioItem);
    }
  }

  if (input.wordTimestamps.length > 0) {
    const captionAssetId = makeId('cap');
    assets.push({ type: 'caption', id: captionAssetId, name: 'captions', wordTimestamps: input.wordTimestamps });
    captionItems.push({
      type: 'captions', id: makeItemId('cap'), from: 0, durationInFrames: totalDurationInFrames, assetId: captionAssetId,
      captionStyle: input.subtitleStyle,
    } satisfies CaptionsItem);
  }

  const tracks: Track[] = [
    { name: 'Main Visual', items: mainVisualItems, muted: false, hidden: false },
  ];
  if (pipItems.length > 0) tracks.push({ name: 'PiP', items: pipItems, muted: false, hidden: false });
  if (overlayItems.length > 0) tracks.push({ name: 'Overlays', items: overlayItems, muted: false, hidden: false });
  if (captionItems.length > 0) tracks.push({ name: 'Captions', items: captionItems, muted: false, hidden: false });
  if (voiceoverItems.length > 0) tracks.push({ name: 'Voiceover', items: voiceoverItems, muted: false, hidden: false });
  if (musicItems.length > 0) tracks.push({ name: 'Music', items: musicItems, muted: false, hidden: false });
  if (sfxItems.length > 0) tracks.push({ name: 'SFX', items: sfxItems, muted: false, hidden: false });

  return { assets, tracks, fps, width, height, durationInFrames: totalDurationInFrames, brand: input.brand };
}

// ─── Default Factory ────────────────────────────────────────────────────────

export function createDefaultEditorState(): EditorState {
  return {
    assets: [],
    tracks: [{ name: 'Main', items: [], muted: false, hidden: false }],
    fps: 30,
    width: 1920,
    height: 1080,
    durationInFrames: 1,
    brand: {
      accent_color: '#f59e0b',
      primary_color: '#ffffff',
      background_color: '#0a0a0a',
      text_color: '#ffffff',
      font_family: 'Inter',
    },
  };
}
