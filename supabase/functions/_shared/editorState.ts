/**
 * Editor State — Track-Based Data Model (Server-Side Mirror)
 *
 * Identical types to src/lib/editorState.ts, self-contained for Deno edge functions.
 * Follows the Remotion Editor Starter conventions: Assets, Items, Tracks.
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

// ─── Transformer ────────────────────────────────────────────────────────────

let _assetCounter = 0;
let _itemCounter = 0;

function makeId(prefix: string): string {
  return `${prefix}_${++_assetCounter}_${Date.now().toString(36)}`;
}

function makeItemId(prefix: string): string {
  return `${prefix}_${++_itemCounter}_${Date.now().toString(36)}`;
}

/**
 * Transform legacy UnifiedVideoProps into EditorState.
 *
 * @param props — the same props object that would be passed to the UnifiedVideo composition
 */
export function compositionInputToEditorState(props: {
  shots: any[];
  screenshots: any[];
  sourceVideoUrl: string | null;
  sourceDurationSeconds: number;
  audioUrl: string | null;
  originalAudioUrl: string | null;
  wordTimestamps: WordTimestamp[];
  voiceMode: string;
  avatarVideoUrl: string | null;
  brand: BrandConfig;
  orientation: 'portrait' | 'landscape';
  subtitleStyle: string;
  transitionType?: string;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
}): EditorState {
  _assetCounter = 0;
  _itemCounter = 0;

  const fps = 30;
  const isPortrait = props.orientation === 'portrait';
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

  for (const shot of props.shots) {
    const durationInFrames = Math.round((shot.duration || 1) * fps);
    if (durationInFrames <= 0) continue;

    const layout: string = shot.layout || 'text_card';

    // --- Visual items ---
    if (layout === 'screenshot_fullscreen' || layout === 'avatar_pip' || layout === 'split_left' || layout === 'split_right') {
      const ssIndex = shot.screenshot_index ?? 0;
      const ss = props.screenshots[ssIndex];
      if (ss?.url) {
        const assetId = makeId('img');
        assets.push({ type: 'image', id: assetId, src: ss.url, name: `screenshot_${ssIndex}`, width, height });
        mainVisualItems.push({
          type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          camera: { move: shot.camera?.move || 'hold', startScale: shot.camera?.start_scale, endScale: shot.camera?.end_scale },
          x: 0, y: 0, width, height,
        } as ImageItem);
      }
    } else if (layout === 'scene_image') {
      if (shot.scene_image_url) {
        const assetId = makeId('img');
        assets.push({ type: 'image', id: assetId, src: shot.scene_image_url, name: 'scene_image', width, height });
        mainVisualItems.push({
          type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          camera: { move: shot.camera?.move || 'ken_burns_slow', startScale: shot.camera?.start_scale, endScale: shot.camera?.end_scale },
          x: 0, y: 0, width, height,
        } as ImageItem);
      }
    } else if (layout === 'video_clip') {
      if (props.sourceVideoUrl) {
        let videoAssetId = assets.find((a) => a.type === 'video' && a.src === props.sourceVideoUrl)?.id;
        if (!videoAssetId) {
          videoAssetId = makeId('vid');
          assets.push({ type: 'video', id: videoAssetId, src: props.sourceVideoUrl, name: 'source_video', durationInFrames: Math.round(props.sourceDurationSeconds * fps), width, height });
        }
        mainVisualItems.push({
          type: 'video', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId: videoAssetId,
          trimStartFrames: Math.round((shot.source_start || 0) * fps),
          trimEndFrames: Math.round((shot.source_end || shot.duration) * fps),
          playbackRate: shot.speed || 1, volume: 0, x: 0, y: 0, width, height,
        } as VideoItem);
      }
    } else if (layout === 'broll_cutaway' && shot.broll_src) {
      if (shot.broll_type === 'video') {
        const assetId = makeId('vid');
        assets.push({ type: 'video', id: assetId, src: shot.broll_src, name: shot.broll_label || 'broll', durationInFrames, width, height });
        mainVisualItems.push({
          type: 'video', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          trimStartFrames: 0, trimEndFrames: durationInFrames, playbackRate: 1, volume: 0,
          x: 0, y: 0, width, height,
        } as VideoItem);
      } else {
        const assetId = makeId('img');
        assets.push({ type: 'image', id: assetId, src: shot.broll_src, name: shot.broll_label || 'broll', width, height });
        mainVisualItems.push({
          type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          camera: { move: 'ken_burns_slow' }, x: 0, y: 0, width, height,
        } as ImageItem);
      }
    } else if (['text_card', 'stat_card', 'quote_card', 'list_reveal', 'gradient_title'].includes(layout)) {
      mainVisualItems.push({
        type: 'solid', id: makeItemId('bg'), from: currentFrame, durationInFrames,
        color: props.brand.background_color, x: 0, y: 0, width, height,
      } as SolidItem);

      let text = shot.text_overlay || shot.narration || '';
      if (layout === 'quote_card') text = shot.quote_text || text;

      mainVisualItems.push({
        type: 'text', id: makeItemId('txt'), from: currentFrame, durationInFrames, text,
        color: props.brand.text_color,
        fontSize: layout === 'gradient_title' ? 72 : layout === 'stat_card' ? 48 : 42,
        fontWeight: (layout === 'gradient_title' || layout === 'stat_card') ? 700 : 400,
        textAlign: 'center' as const,
        textStyle: layout as any,
        textAnimation: shot.text_animation,
        statValue: shot.stat_value != null ? String(shot.stat_value) : undefined,
        statLabel: shot.stat_label,
        quoteAttribution: shot.quote_attribution,
        listItems: shot.list_items,
        background: shot.background,
        transition: shot.transition_in && shot.transition_in !== 'cut_hard'
          ? { type: shot.transition_in, durationInFrames: Math.round(fps * 0.5) }
          : undefined,
      } as TextItem);
    } else if (layout === 'avatar_fullscreen') {
      mainVisualItems.push({
        type: 'solid', id: makeItemId('bg'), from: currentFrame, durationInFrames,
        color: props.brand.background_color, x: 0, y: 0, width, height,
      } as SolidItem);
    }

    // --- Overlay items ---
    if (shot.overlay_config) {
      const oc = shot.overlay_config;
      if (oc.vignette) overlayItems.push({ type: 'overlay', id: makeItemId('ovl'), from: currentFrame, durationInFrames, overlayType: 'vignette', intensity: oc.vignette_intensity ?? 0.5 } as OverlayItem);
      if (oc.grain) overlayItems.push({ type: 'overlay', id: makeItemId('ovl'), from: currentFrame, durationInFrames, overlayType: 'grain', intensity: oc.grain_intensity ?? 0.3 } as OverlayItem);
      if (oc.letterbox) overlayItems.push({ type: 'overlay', id: makeItemId('ovl'), from: currentFrame, durationInFrames, overlayType: 'letterbox', intensity: 1 } as OverlayItem);
    }

    currentFrame += durationInFrames;
  }

  const totalDurationInFrames = currentFrame;

  // Avatar PiP
  if (props.avatarVideoUrl && (props.voiceMode === 'avatar' || props.voiceMode === 'voiceover')) {
    const avatarAssetId = makeId('vid');
    const pipSize = isPortrait ? 280 : 320;
    const margin = 40;
    assets.push({ type: 'video', id: avatarAssetId, src: props.avatarVideoUrl, name: 'avatar', durationInFrames: totalDurationInFrames, width: pipSize, height: pipSize });
    pipItems.push({
      type: 'video', id: makeItemId('pip'), from: 0, durationInFrames: totalDurationInFrames, assetId: avatarAssetId,
      trimStartFrames: 0, trimEndFrames: totalDurationInFrames, playbackRate: 1, volume: 0,
      x: width - pipSize - margin, y: height - pipSize - margin, width: pipSize, height: pipSize,
    } as VideoItem);
  }

  // Voiceover audio
  const effectiveAudioUrl = props.audioUrl || props.originalAudioUrl;
  if (effectiveAudioUrl) {
    const audioAssetId = makeId('aud');
    assets.push({ type: 'audio', id: audioAssetId, src: effectiveAudioUrl, name: props.voiceMode === 'keep_original' ? 'original_audio' : 'voiceover', durationInFrames: totalDurationInFrames });
    voiceoverItems.push({
      type: 'audio', id: makeItemId('vo'), from: 0, durationInFrames: totalDurationInFrames, assetId: audioAssetId,
      volume: 1, fadeInFrames: 0, fadeOutFrames: Math.round(fps * 0.5),
    } as AudioItem);
  }

  // Background music
  if (props.backgroundMusicUrl) {
    const musicAssetId = makeId('aud');
    assets.push({ type: 'audio', id: musicAssetId, src: props.backgroundMusicUrl, name: 'background_music', durationInFrames: totalDurationInFrames });
    musicItems.push({
      type: 'audio', id: makeItemId('mus'), from: 0, durationInFrames: totalDurationInFrames, assetId: musicAssetId,
      volume: props.backgroundMusicVolume ?? 0.1, fadeInFrames: Math.round(fps * 2), fadeOutFrames: Math.round(fps * 3),
    } as AudioItem);
  }

  // Captions
  if (props.wordTimestamps.length > 0) {
    const captionAssetId = makeId('cap');
    assets.push({ type: 'caption', id: captionAssetId, name: 'captions', wordTimestamps: props.wordTimestamps });
    captionItems.push({
      type: 'captions', id: makeItemId('cap'), from: 0, durationInFrames: totalDurationInFrames, assetId: captionAssetId,
      captionStyle: (props.subtitleStyle || 'bounce_pop') as SubtitleStyle,
    } as CaptionsItem);
  }

  // Assemble tracks
  const tracks: Track[] = [
    { name: 'Main Visual', items: mainVisualItems, muted: false, hidden: false },
  ];
  if (pipItems.length > 0) tracks.push({ name: 'PiP', items: pipItems, muted: false, hidden: false });
  if (overlayItems.length > 0) tracks.push({ name: 'Overlays', items: overlayItems, muted: false, hidden: false });
  if (captionItems.length > 0) tracks.push({ name: 'Captions', items: captionItems, muted: false, hidden: false });
  if (voiceoverItems.length > 0) tracks.push({ name: 'Voiceover', items: voiceoverItems, muted: false, hidden: false });
  if (musicItems.length > 0) tracks.push({ name: 'Music', items: musicItems, muted: false, hidden: false });

  return { assets, tracks, fps, width, height, durationInFrames: totalDurationInFrames, brand: props.brand };
}

// ─── Storyboard Transformer ────────────────────────────────────────────────

/**
 * Transform storyboard pipeline output into EditorState.
 *
 * Storyboard videos are simpler: a sequence of images with camera moves,
 * a single voiceover track, optional background music, and captions.
 */
export function storyboardToEditorState(props: {
  scenes: Array<{
    imageUrl: string;
    durationSeconds: number;
    cameraMove: { move: string; start_scale?: number; end_scale?: number };
    narration?: string;
  }>;
  voiceoverUrl: string;
  wordTimestamps: WordTimestamp[];
  subtitleStyle: string;
  transitionType?: string;
  backgroundMusicUrl?: string;
  backgroundMusicVolume?: number;
  brand: BrandConfig;
  orientation?: 'portrait' | 'landscape';
}): EditorState {
  _assetCounter = 0;
  _itemCounter = 0;

  const fps = 30;
  const isPortrait = props.orientation === 'portrait';
  const width = isPortrait ? 1080 : 1920;
  const height = isPortrait ? 1920 : 1080;

  const assets: Asset[] = [];
  const mainVisualItems: Item[] = [];
  const voiceoverItems: Item[] = [];
  const musicItems: Item[] = [];
  const captionItems: Item[] = [];

  let currentFrame = 0;

  for (const scene of props.scenes) {
    const durationInFrames = Math.round(scene.durationSeconds * fps);
    if (durationInFrames <= 0) continue;

    if (scene.imageUrl) {
      const assetId = makeId('img');
      assets.push({
        type: 'image', id: assetId, src: scene.imageUrl,
        name: `scene_${assets.filter(a => a.type === 'image').length}`,
        width, height,
      });
      mainVisualItems.push({
        type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
        camera: {
          move: (scene.cameraMove?.move || 'ken_burns_slow') as CameraMoveType,
          startScale: scene.cameraMove?.start_scale,
          endScale: scene.cameraMove?.end_scale,
        },
        x: 0, y: 0, width, height,
      } as ImageItem);
    }

    currentFrame += durationInFrames;
  }

  const totalDurationInFrames = currentFrame;

  // Voiceover audio
  if (props.voiceoverUrl) {
    const audioAssetId = makeId('aud');
    assets.push({ type: 'audio', id: audioAssetId, src: props.voiceoverUrl, name: 'voiceover', durationInFrames: totalDurationInFrames });
    voiceoverItems.push({
      type: 'audio', id: makeItemId('vo'), from: 0, durationInFrames: totalDurationInFrames, assetId: audioAssetId,
      volume: 1, fadeInFrames: 0, fadeOutFrames: Math.round(fps * 0.5),
    } as AudioItem);
  }

  // Background music
  if (props.backgroundMusicUrl) {
    const musicAssetId = makeId('aud');
    assets.push({ type: 'audio', id: musicAssetId, src: props.backgroundMusicUrl, name: 'background_music', durationInFrames: totalDurationInFrames });
    musicItems.push({
      type: 'audio', id: makeItemId('mus'), from: 0, durationInFrames: totalDurationInFrames, assetId: musicAssetId,
      volume: props.backgroundMusicVolume ?? 0.10, fadeInFrames: Math.round(fps * 2), fadeOutFrames: Math.round(fps * 3),
    } as AudioItem);
  }

  // Captions
  if (props.wordTimestamps.length > 0) {
    const captionAssetId = makeId('cap');
    assets.push({ type: 'caption', id: captionAssetId, name: 'captions', wordTimestamps: props.wordTimestamps });
    captionItems.push({
      type: 'captions', id: makeItemId('cap'), from: 0, durationInFrames: totalDurationInFrames, assetId: captionAssetId,
      captionStyle: (props.subtitleStyle || 'bounce_pop') as SubtitleStyle,
    } as CaptionsItem);
  }

  const tracks: Track[] = [
    { name: 'Main Visual', items: mainVisualItems, muted: false, hidden: false },
  ];
  if (captionItems.length > 0) tracks.push({ name: 'Captions', items: captionItems, muted: false, hidden: false });
  if (voiceoverItems.length > 0) tracks.push({ name: 'Voiceover', items: voiceoverItems, muted: false, hidden: false });
  if (musicItems.length > 0) tracks.push({ name: 'Music', items: musicItems, muted: false, hidden: false });

  return { assets, tracks, fps, width, height, durationInFrames: totalDurationInFrames, brand: props.brand };
}

// ─── Remix Transformer ─────────────────────────────────────────────────────

/**
 * Transform video remix pipeline output into EditorState.
 *
 * Remix videos cut segments from a source video, optionally replace the voice,
 * and add text cards, b-roll cutaways, captions, and an avatar PiP.
 */
export function remixToEditorState(props: {
  sourceVideoUrl: string;
  sourceDurationSeconds: number;
  segments: any[];
  voiceoverUrl: string | null;
  originalAudioUrl: string | null;
  wordTimestamps: WordTimestamp[];
  voiceOption: string;
  avatarVideoUrl: string | null;
  brand: BrandConfig;
  orientation: 'portrait' | 'landscape';
  subtitleStyle: string;
}): EditorState {
  _assetCounter = 0;
  _itemCounter = 0;

  const fps = 30;
  const isPortrait = props.orientation === 'portrait';
  const width = isPortrait ? 1080 : 1920;
  const height = isPortrait ? 1920 : 1080;

  const assets: Asset[] = [];
  const mainVisualItems: Item[] = [];
  const pipItems: Item[] = [];
  const voiceoverItems: Item[] = [];
  const musicItems: Item[] = [];
  const captionItems: Item[] = [];

  // Create source video asset (shared across all video segments)
  let sourceVideoAssetId: string | null = null;
  if (props.sourceVideoUrl) {
    sourceVideoAssetId = makeId('vid');
    assets.push({
      type: 'video', id: sourceVideoAssetId, src: props.sourceVideoUrl,
      name: 'source_video', durationInFrames: Math.round(props.sourceDurationSeconds * fps),
      width, height,
    });
  }

  let currentFrame = 0;

  for (const segment of props.segments) {
    const segType: string = segment.type || 'video';

    if (segType === 'video' && sourceVideoAssetId) {
      const sourceStart = segment.source_start || 0;
      const sourceEnd = segment.source_end || sourceStart + 3;
      const speed = segment.speed || 1;
      const clipDuration = (sourceEnd - sourceStart) / speed;
      const durationInFrames = Math.round(clipDuration * fps);
      if (durationInFrames <= 0) continue;

      mainVisualItems.push({
        type: 'video', id: makeItemId('vis'), from: currentFrame, durationInFrames,
        assetId: sourceVideoAssetId,
        trimStartFrames: Math.round(sourceStart * fps),
        trimEndFrames: Math.round(sourceEnd * fps),
        playbackRate: speed,
        volume: props.voiceOption === 'keep_original' ? 1 : 0,
        x: 0, y: 0, width, height,
      } as VideoItem);

      currentFrame += durationInFrames;
    } else if (segType === 'text_card') {
      const durationInFrames = Math.round((segment.duration || 3) * fps);
      if (durationInFrames <= 0) continue;

      // Solid background
      mainVisualItems.push({
        type: 'solid', id: makeItemId('bg'), from: currentFrame, durationInFrames,
        color: props.brand.background_color, x: 0, y: 0, width, height,
      } as SolidItem);

      // Text
      mainVisualItems.push({
        type: 'text', id: makeItemId('txt'), from: currentFrame, durationInFrames,
        text: segment.card_text || segment.narration || '',
        color: props.brand.text_color, fontSize: 42, fontWeight: 400,
        textAlign: 'center' as const,
        textStyle: 'text_card' as any,
        textAnimation: 'spring_fade' as TextAnimationType,
      } as TextItem);

      currentFrame += durationInFrames;
    } else if (segType === 'b_roll' && segment.broll_src) {
      const durationInFrames = Math.round((segment.duration || 3) * fps);
      if (durationInFrames <= 0) continue;

      if (segment.broll_type === 'video') {
        const assetId = makeId('vid');
        assets.push({ type: 'video', id: assetId, src: segment.broll_src, name: segment.broll_label || 'broll', durationInFrames, width, height });
        mainVisualItems.push({
          type: 'video', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          trimStartFrames: 0, trimEndFrames: durationInFrames, playbackRate: 1, volume: 0,
          x: 0, y: 0, width, height,
        } as VideoItem);
      } else {
        const assetId = makeId('img');
        assets.push({ type: 'image', id: assetId, src: segment.broll_src, name: segment.broll_label || 'broll', width, height });
        mainVisualItems.push({
          type: 'image', id: makeItemId('vis'), from: currentFrame, durationInFrames, assetId,
          camera: { move: 'ken_burns_slow' as CameraMoveType }, x: 0, y: 0, width, height,
        } as ImageItem);
      }

      currentFrame += durationInFrames;
    }
  }

  const totalDurationInFrames = currentFrame;

  // Avatar PiP
  if (props.avatarVideoUrl && props.voiceOption === 'avatar') {
    const avatarAssetId = makeId('vid');
    const pipSize = isPortrait ? 280 : 320;
    const margin = 40;
    assets.push({ type: 'video', id: avatarAssetId, src: props.avatarVideoUrl, name: 'avatar', durationInFrames: totalDurationInFrames, width: pipSize, height: pipSize });
    pipItems.push({
      type: 'video', id: makeItemId('pip'), from: 0, durationInFrames: totalDurationInFrames, assetId: avatarAssetId,
      trimStartFrames: 0, trimEndFrames: totalDurationInFrames, playbackRate: 1, volume: 0,
      x: width - pipSize - margin, y: height - pipSize - margin, width: pipSize, height: pipSize,
    } as VideoItem);
  }

  // Voiceover audio (new voice or avatar — not keep_original, that's on the video track)
  const effectiveAudioUrl = props.voiceOption === 'keep_original' ? null : props.voiceoverUrl;
  if (effectiveAudioUrl) {
    const audioAssetId = makeId('aud');
    assets.push({ type: 'audio', id: audioAssetId, src: effectiveAudioUrl, name: 'voiceover', durationInFrames: totalDurationInFrames });
    voiceoverItems.push({
      type: 'audio', id: makeItemId('vo'), from: 0, durationInFrames: totalDurationInFrames, assetId: audioAssetId,
      volume: 1, fadeInFrames: 0, fadeOutFrames: Math.round(fps * 0.5),
    } as AudioItem);
  }

  // For keep_original with separate audio file
  if (props.voiceOption === 'keep_original' && props.originalAudioUrl) {
    const audioAssetId = makeId('aud');
    assets.push({ type: 'audio', id: audioAssetId, src: props.originalAudioUrl, name: 'original_audio', durationInFrames: totalDurationInFrames });
    voiceoverItems.push({
      type: 'audio', id: makeItemId('vo'), from: 0, durationInFrames: totalDurationInFrames, assetId: audioAssetId,
      volume: 1, fadeInFrames: 0, fadeOutFrames: Math.round(fps * 0.5),
    } as AudioItem);
  }

  // Captions
  if (props.wordTimestamps.length > 0) {
    const captionAssetId = makeId('cap');
    assets.push({ type: 'caption', id: captionAssetId, name: 'captions', wordTimestamps: props.wordTimestamps });
    captionItems.push({
      type: 'captions', id: makeItemId('cap'), from: 0, durationInFrames: totalDurationInFrames, assetId: captionAssetId,
      captionStyle: (props.subtitleStyle || 'bounce_pop') as SubtitleStyle,
    } as CaptionsItem);
  }

  const tracks: Track[] = [
    { name: 'Main Visual', items: mainVisualItems, muted: false, hidden: false },
  ];
  if (pipItems.length > 0) tracks.push({ name: 'PiP', items: pipItems, muted: false, hidden: false });
  if (captionItems.length > 0) tracks.push({ name: 'Captions', items: captionItems, muted: false, hidden: false });
  if (voiceoverItems.length > 0) tracks.push({ name: 'Voiceover', items: voiceoverItems, muted: false, hidden: false });
  if (musicItems.length > 0) tracks.push({ name: 'Music', items: musicItems, muted: false, hidden: false });

  return { assets, tracks, fps, width, height, durationInFrames: totalDurationInFrames, brand: props.brand };
}
