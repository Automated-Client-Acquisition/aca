/**
 * ShotPreviewComposition — Single-shot Remotion composition for inline preview.
 *
 * Simplified version of workers/video-renderer/src/remotion/components/ShotRenderer.tsx.
 * Renders just the layout layer for a single shot — no captions, highlights,
 * text overlays, sound effects, or motion blur (those require full composition context).
 *
 * Used by @remotion/player in PresenterStageViewer and MultiStageDetailPanel
 * to let users preview individual shots inline.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig } from 'remotion';
import { TextCard } from '@/remotion/presenter/layouts/TextCard';
import { StatCard } from '@/remotion/presenter/layouts/StatCard';
import { QuoteCard } from '@/remotion/presenter/layouts/QuoteCard';
import { ListReveal } from '@/remotion/presenter/layouts/ListReveal';
import { GradientTitle } from '@/remotion/presenter/layouts/GradientTitle';
import { ScreenshotFull } from '@/remotion/presenter/layouts/ScreenshotFull';
import { ParticleField } from '@/remotion/elements/backgrounds/ParticleField';
import { MeshGradient } from '@/remotion/elements/backgrounds/MeshGradient';
import { GradientOrb } from '@/remotion/elements/backgrounds/GradientOrb';
import { Vignette } from '@/remotion/elements/overlays/Vignette';
import { FilmGrain } from '@/remotion/elements/overlays/FilmGrain';
import { CinematicBars } from '@/remotion/elements/overlays/CinematicBars';
import { DecorationLayer } from '@/remotion/elements/decorations/DecorationLayer';
import { Img, Video } from 'remotion';
import type { Shot, ScreenshotData, BrandConfig, BackgroundConfig } from '@/remotion/presenter/types';

export interface ShotPreviewProps {
  shot: Shot;
  screenshots: ScreenshotData[];
  brand: BrandConfig;
  sourceVideoUrl?: string | null;
}

/**
 * Downgrade avatar-dependent layouts when no avatar video is available.
 * At the director stage, voice_avatar hasn't run yet so there's no avatar.
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

function renderLayout(
  shot: Shot,
  screenshot: ScreenshotData | null,
  frame: number,
  fps: number,
  brand: BrandConfig,
  sourceVideoUrl?: string | null,
): React.ReactElement {
  const effectiveLayout = downgradeLayout(shot.layout);

  switch (effectiveLayout) {
    case 'screenshot_fullscreen':
      return (
        <ScreenshotFull
          screenshot={screenshot}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shot.duration}
          brand={brand}
        />
      );

    case 'text_card':
      return (
        <TextCard
          text={shot.text_overlay || shot.narration}
          textStyle={shot.text_style || 'hook_dramatic'}
          brand={brand}
        />
      );

    case 'stat_card':
      return (
        <StatCard
          value={shot.stat_value ?? shot.text_overlay ?? '0'}
          label={shot.stat_label ?? ''}
          brand={brand}
        />
      );

    case 'quote_card':
      return (
        <QuoteCard
          quote={shot.quote_text ?? shot.text_overlay ?? shot.narration}
          attribution={shot.quote_attribution ?? ''}
          brand={brand}
        />
      );

    case 'list_reveal':
      return (
        <ListReveal
          items={shot.list_items ?? (shot.text_overlay ? shot.text_overlay.split('\n') : [shot.narration])}
          title={shot.list_title}
          brand={brand}
        />
      );

    case 'gradient_title':
      return (
        <GradientTitle
          title={shot.text_overlay || shot.narration}
          subtitle={shot.subtitle}
          brand={brand}
        />
      );

    case 'scene_image':
      return shot.scene_image_url ? (
        <AbsoluteFill>
          <ScreenshotFull
            screenshot={{ url: shot.scene_image_url, scroll_y: 0, viewport_height: 1080 }}
            cameraMove={shot.camera}
            frame={frame}
            fps={fps}
            shotDuration={shot.duration}
            brand={brand}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ backgroundColor: brand.background_color, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: brand.text_color, opacity: 0.5, fontSize: 24 }}>Image pending</div>
        </AbsoluteFill>
      );

    case 'video_clip':
      return sourceVideoUrl ? (
        <AbsoluteFill>
          <Video
            src={sourceVideoUrl}
            startFrom={Math.round((shot.source_start ?? 0) * fps)}
            playbackRate={shot.speed ?? 1}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        </AbsoluteFill>
      ) : (
        <AbsoluteFill style={{ backgroundColor: '#1a1a2e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ color: '#fff', opacity: 0.5, fontSize: 24 }}>Video clip</div>
        </AbsoluteFill>
      );

    default:
      // Fallback to screenshot fullscreen
      return (
        <ScreenshotFull
          screenshot={screenshot}
          cameraMove={shot.camera}
          frame={frame}
          fps={fps}
          shotDuration={shot.duration}
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

export const ShotPreviewComposition: React.FC<ShotPreviewProps> = ({
  shot,
  screenshots,
  brand,
  sourceVideoUrl,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const screenshot =
    shot.screenshot_index != null ? screenshots[shot.screenshot_index] ?? null : null;

  const overlay = shot.overlay_config;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Background element (opt-in per shot) */}
      {renderBackground(shot.background, brand)}

      {/* Layout content */}
      {renderLayout(shot, screenshot, frame, fps, brand, sourceVideoUrl)}

      {/* Decoration stickers (opt-in per shot) */}
      {shot.decorations && shot.decorations.length > 0 && (
        <DecorationLayer
          decorations={shot.decorations}
          brand={brand}
          shotDurationFrames={Math.round(shot.duration * fps)}
        />
      )}

      {/* Cinematic overlays (opt-in per shot) */}
      {overlay?.vignette && (
        <Vignette intensity={overlay.vignette_intensity} />
      )}
      {overlay?.grain && (
        <FilmGrain intensity={overlay.grain_intensity} />
      )}
      {overlay?.letterbox && (
        <CinematicBars />
      )}
    </AbsoluteFill>
  );
};
