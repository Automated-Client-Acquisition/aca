/**
 * ShotRenderer — Single shot renderer with layout selection.
 *
 * Composes a complete shot by selecting the correct layout
 * and layering highlights, text overlays, captions, cursor
 * animations, and sound effects on top.
 *
 * Wraps screenshot-bearing layouts in CameraMotionBlur for
 * cinematic film-camera motion blur on fast camera moves.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { AbsoluteFill, Audio, useCurrentFrame, useVideoConfig } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { AvatarPip } from '../layouts/AvatarPip.js';
import { SplitScreen } from '../layouts/SplitScreen.js';
import { AvatarFullscreen } from '../layouts/AvatarFullscreen.js';
import { ScreenshotFull } from '../layouts/ScreenshotFull.js';
import { TextCard } from '../layouts/TextCard.js';
import { StatCard } from '../layouts/StatCard.js';
import { QuoteCard } from '../layouts/QuoteCard.js';
import { ListReveal } from '../layouts/ListReveal.js';
import { GradientTitle } from '../layouts/GradientTitle.js';
import { BRollCutaway } from '../layouts/BRollCutaway.js';
import { SceneImageShot } from '../layouts/SceneImageShot.js';
import { VideoClipShot } from '../layouts/VideoClipShot.js';
import { HighlightLayer } from './HighlightLayer.js';
import { TextOverlay } from './TextOverlay.js';
import { CaptionLayer } from './CaptionLayer.js';
import { CursorAnimation } from './CursorAnimation.js';
import { SoundEffect } from './AudioMixer.js';
import { ParticleField } from '../elements/backgrounds/ParticleField.js';
import { MeshGradient } from '../elements/backgrounds/MeshGradient.js';
import { GradientOrb } from '../elements/backgrounds/GradientOrb.js';
import { Vignette } from '../elements/overlays/Vignette.js';
import { FilmGrain } from '../elements/overlays/FilmGrain.js';
import { CinematicBars } from '../elements/overlays/CinematicBars.js';
import { DecorationLayer } from '../elements/decorations/DecorationLayer.js';
import type {
  Shot,
  ScreenshotData,
  WordTimestamp,
  BrandConfig,
  BackgroundConfig,
  ElementBounds,
  CameraMoveType,
  SubtitleStyle,
} from '../types.js';

interface ShotRendererProps {
  shot: Shot;
  screenshots: ScreenshotData[];
  avatarVideoUrl: string | null;
  sourceVideoUrl?: string | null; // For video_clip layout — source video URL
  wordTimestamps: WordTimestamp[];
  brand: BrandConfig;
  globalTimeOffset: number; // In frames — where this shot starts in the global timeline
  fps: number;
  /** Default caption style from composition-level subtitleStyle. Per-shot caption_style overrides this. */
  defaultSubtitleStyle?: SubtitleStyle;
}

/**
 * Determine motion blur samples for presenter shots.
 * Returns 0 for layouts that don't have screenshot camera moves (text_card, avatar_fullscreen).
 */
function getPresenterMotionBlurSamples(layout: string, moveType: CameraMoveType): number {
  // No motion blur for layouts without screenshot camera animation
  if (
    layout === 'text_card' ||
    layout === 'avatar_fullscreen' ||
    layout === 'stat_card' ||
    layout === 'quote_card' ||
    layout === 'list_reveal' ||
    layout === 'gradient_title' ||
    layout === 'video_clip'
  ) return 0;

  switch (moveType) {
    case 'shake':
    case 'punch_zoom':
    case 'snap_to':
      return 6;
    case 'pan_left':
    case 'pan_right':
    case 'pan_down':
    case 'zoom_out_reveal':
      return 4;
    case 'ken_burns_slow':
    case 'tilt_3d':
      return 3;
    case 'hold':
    default:
      return 0;
  }
}

export const ShotRenderer: React.FC<ShotRendererProps> = ({
  shot,
  screenshots,
  avatarVideoUrl,
  sourceVideoUrl,
  wordTimestamps,
  brand,
  globalTimeOffset,
  fps,
  defaultSubtitleStyle,
}) => {
  const frame = useCurrentFrame();
  const { width, height } = useVideoConfig();

  // Get the screenshot for this shot (if any)
  const screenshot =
    shot.screenshot_index != null ? screenshots[shot.screenshot_index] ?? null : null;

  // Compute visible words for this shot's time window
  const shotStartTime = globalTimeOffset / fps;
  const shotEndTime = shotStartTime + shot.duration;
  const visibleWords = wordTimestamps.filter(
    (w) => w.start >= shotStartTime && w.start < shotEndTime,
  );

  // Resolve element bounds for highlights
  const highlightBounds = shot.highlight
    ? getElementBounds(screenshot, shot.highlight.target_element)
    : null;

  // Motion blur for camera-animated layouts
  const motionBlurSamples = getPresenterMotionBlurSamples(shot.layout, shot.camera.move);

  // Determine if a dynamic background element replaces layout's built-in bg
  const hasBackground = !!shot.background
    && shot.background.type !== 'solid'
    && shot.background.type !== 'gradient';

  const layoutContent = renderLayout(
    shot,
    screenshot,
    avatarVideoUrl,
    sourceVideoUrl || null,
    globalTimeOffset,
    frame,
    fps,
    brand,
    hasBackground,
  );

  // Text-centric layouts render their own content — don't layer TextOverlay or captions on top.
  const TEXT_LAYOUTS = new Set(['text_card', 'stat_card', 'quote_card', 'list_reveal', 'gradient_title']);
  const effectiveLayout = !avatarVideoUrl ? downgradeLayout(shot.layout) : shot.layout;
  const isTextCard = TEXT_LAYOUTS.has(effectiveLayout);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Background element (opt-in per shot) */}
      {renderBackground(shot.background, brand)}

      {/* Layout layer — optionally wrapped in motion blur */}
      {motionBlurSamples > 0 ? (
        <CameraMotionBlur samples={motionBlurSamples} shutterAngle={180}>
          {layoutContent}
        </CameraMotionBlur>
      ) : (
        layoutContent
      )}

      {/* Highlight overlay */}
      {shot.highlight && highlightBounds && (
        <AbsoluteFill style={{ zIndex: 10 }}>
          {shot.highlight.type === 'fake_cursor_click' ? (
            <CursorAnimation targetBounds={highlightBounds} />
          ) : (
            <HighlightLayer
              type={shot.highlight.type}
              targetBounds={highlightBounds}
              cameraMove={shot.camera}
              frame={frame}
              fps={fps}
            />
          )}
        </AbsoluteFill>
      )}

      {/* Decoration stickers (opt-in per shot) */}
      {shot.decorations && shot.decorations.length > 0 && (
        <AbsoluteFill style={{ zIndex: 15 }}>
          <DecorationLayer
            decorations={shot.decorations}
            brand={brand}
            shotDurationFrames={Math.round(shot.duration * fps)}
          />
        </AbsoluteFill>
      )}

      {/* Text overlay (hooks, stats, quotes) — skip for text_card to avoid duplication */}
      {shot.text_overlay && !isTextCard && (
        <AbsoluteFill style={{ zIndex: 20 }}>
          <TextOverlay
            text={shot.text_overlay}
            style={shot.text_style || 'hook_dramatic'}
            brand={brand}
            frame={frame}
            fps={fps}
          />
        </AbsoluteFill>
      )}

      {/* Animated captions — suppress on text_card to avoid overlap with layout text */}
      {!isTextCard && (
        <AbsoluteFill style={{ zIndex: 30 }}>
          <CaptionLayer
            words={visibleWords}
            style={(shot.caption_style || defaultSubtitleStyle || 'bounce_pop') as any}
            brand={brand}
            fps={fps}
            {...({ emphasis: shot.caption_emphasis || [], frame, shotStartTime } as any)}
          />
        </AbsoluteFill>
      )}

      {/* Cinematic overlays (opt-in per shot) — above all content */}
      {shot.overlay_config?.vignette && (
        <AbsoluteFill style={{ zIndex: 40 }}>
          <Vignette intensity={shot.overlay_config.vignette_intensity} />
        </AbsoluteFill>
      )}
      {shot.overlay_config?.grain && (
        <AbsoluteFill style={{ zIndex: 41 }}>
          <FilmGrain intensity={shot.overlay_config.grain_intensity} />
        </AbsoluteFill>
      )}
      {shot.overlay_config?.letterbox && (
        <AbsoluteFill style={{ zIndex: 42 }}>
          <CinematicBars />
        </AbsoluteFill>
      )}

      {/* Sound effect */}
      {shot.sound_effect && (
        <SoundEffect type={shot.sound_effect} volume={0.6} />
      )}
    </AbsoluteFill>
  );
};

// ─── Layout Rendering ────────────────────────────────────────────────────────

function renderLayout(
  shot: Shot,
  screenshot: ScreenshotData | null,
  avatarVideoUrl: string | null,
  sourceVideoUrl: string | null,
  globalTimeOffset: number,
  frame: number,
  fps: number,
  brand: BrandConfig,
  hasBackground: boolean,
): React.ReactElement {
  const shotDuration = shot.duration;

  // When no avatar video is available, downgrade avatar-dependent layouts
  const effectiveLayout = !avatarVideoUrl ? downgradeLayout(shot.layout) : shot.layout;

  switch (effectiveLayout) {
    case 'avatar_pip':
      return (
        <AvatarPip
          screenshot={screenshot}
          avatarVideoUrl={avatarVideoUrl || ''}
          avatarTimeOffset={globalTimeOffset}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shotDuration}
          brand={brand}
        />
      );

    case 'split_left':
    case 'split_right':
      return (
        <SplitScreen
          screenshot={screenshot}
          avatarVideoUrl={avatarVideoUrl || ''}
          avatarTimeOffset={globalTimeOffset}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shotDuration}
          brand={brand}
          direction={effectiveLayout}
        />
      );

    case 'avatar_fullscreen':
      return (
        <AvatarFullscreen
          avatarVideoUrl={avatarVideoUrl || ''}
          avatarTimeOffset={globalTimeOffset}
          brand={brand}
        />
      );

    case 'screenshot_fullscreen':
      return (
        <ScreenshotFull
          screenshot={screenshot}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shotDuration}
          brand={brand}
        />
      );

    case 'text_card':
      return (
        <TextCard
          text={shot.text_overlay || shot.narration}
          textStyle={shot.text_style || 'hook_dramatic'}
          brand={brand}
          textAnimation={shot.text_animation}
          transparentBackground={hasBackground}
        />
      );

    case 'stat_card':
      return (
        <StatCard
          value={shot.stat_value ?? shot.text_overlay ?? '0'}
          label={shot.stat_label ?? ''}
          brand={brand}
          transparentBackground={hasBackground}
        />
      );

    case 'quote_card':
      return (
        <QuoteCard
          quote={shot.quote_text ?? shot.text_overlay ?? shot.narration}
          attribution={shot.quote_attribution ?? ''}
          brand={brand}
          textAnimation={shot.text_animation}
          transparentBackground={hasBackground}
        />
      );

    case 'list_reveal':
      return (
        <ListReveal
          items={shot.list_items ?? (shot.text_overlay ? shot.text_overlay.split('\n') : [shot.narration])}
          title={shot.list_title}
          brand={brand}
          transparentBackground={hasBackground}
        />
      );

    case 'gradient_title':
      return (
        <GradientTitle
          title={shot.text_overlay || shot.narration}
          subtitle={shot.subtitle}
          brand={brand}
          textAnimation={shot.text_animation}
          transparentBackground={hasBackground}
        />
      );

    case 'broll_cutaway':
      return (
        <BRollCutaway
          src={shot.broll_src ?? ''}
          type={shot.broll_type ?? 'image'}
          label={shot.broll_label}
          brand={brand}
        />
      );

    case 'scene_image':
      return (
        <SceneImageShot
          imageUrl={shot.scene_image_url ?? null}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shotDuration}
          brand={brand}
        />
      );

    case 'video_clip':
      return (
        <VideoClipShot
          sourceVideoUrl={sourceVideoUrl ?? ''}
          sourceStart={shot.source_start ?? 0}
          sourceEnd={shot.source_end ?? 0}
          speed={shot.speed ?? 1}
          brand={brand}
        />
      );

    default:
      // Fallback to screenshot fullscreen when no avatar
      return (
        <ScreenshotFull
          screenshot={screenshot}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shotDuration}
          brand={brand}
        />
      );
  }
}

// ─── Background Renderer ──────────────────────────────────────────────────────

function renderBackground(
  config: BackgroundConfig | undefined,
  brand: BrandConfig,
): React.ReactNode {
  if (!config) return null;

  switch (config.type) {
    case 'particles':
      return <ParticleField brand={brand} intensity={config.intensity} />;
    case 'mesh_gradient':
      return <MeshGradient brand={brand} intensity={config.intensity} />;
    case 'gradient_orbs':
      return <GradientOrb brand={brand} />;
    default:
      return null; // 'solid' and 'gradient' handled by layout
  }
}

/**
 * Downgrade avatar-dependent layouts when no avatar video is available.
 * All avatar layouts get converted to screenshot_fullscreen since there's
 * no avatar video to display.
 */
function downgradeLayout(layout: string): string {
  switch (layout) {
    case 'avatar_fullscreen':
    case 'avatar_pip':
    case 'split_left':
    case 'split_right':
      return 'screenshot_fullscreen';
    default:
      return layout;
  }
}

// ─── Element Bounds Resolution ───────────────────────────────────────────────

/**
 * Look up element bounds from the screenshot's element list.
 * Returns null if the element is not found.
 */
function getElementBounds(
  screenshot: ScreenshotData | null,
  targetElement: string,
): ElementBounds | null {
  if (!screenshot || !screenshot.elements) return null;

  const element = screenshot.elements.find(
    (el) => el.selector === targetElement,
  );

  return element?.bounds ?? null;
}
