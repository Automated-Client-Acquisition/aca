/**
 * SceneSequence — Wrapper for storyboard scenes with camera moves.
 *
 * Each scene is an image animated with the specified camera move,
 * wrapped in CameraMotionBlur for cinematic film-camera blur,
 * plus a cinematic overlay (vignette + grain) and a smooth
 * fade-in/scale-in intro animation for polish.
 *
 * Used inside the StoryboardVideo composition's TransitionSeries.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, Easing } from 'remotion';
import { CameraMotionBlur } from '@remotion/motion-blur';
import { ScreenshotLayer } from './ScreenshotLayer.js';
import { CinematicOverlay } from './CinematicOverlay.js';
import type { SceneData, CameraMoveType } from '../types.js';

interface SceneSequenceProps {
  scene: SceneData;
}

/**
 * Determine how many motion blur samples to use based on camera move type.
 * Fast moves get more samples for smoother blur; static/slow gets fewer to save render time.
 */
function getMotionBlurSamples(moveType: CameraMoveType): number {
  switch (moveType) {
    case 'shake':
    case 'punch_zoom':
    case 'snap_to':
      return 8;  // Fast moves — more samples for smoother blur
    case 'pan_left':
    case 'pan_right':
    case 'pan_down':
    case 'zoom_out_reveal':
      return 6;  // Medium moves
    case 'ken_burns_slow':
    case 'tilt_3d':
      return 4;  // Slow moves — lighter blur
    case 'hold':
    default:
      return 0;  // Static — no blur needed
  }
}

export const SceneSequence: React.FC<SceneSequenceProps> = ({ scene }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Scene intro animation — fade in + subtle scale over first 8 frames (~0.27s at 30fps)
  const introFrames = 8;
  const introProgress = Math.min(frame / introFrames, 1);
  const introEased = Easing.out(Easing.cubic)(introProgress);

  const introOpacity = interpolate(introEased, [0, 1], [0, 1], {
    extrapolateRight: 'clamp',
  });

  const introScale = interpolate(introEased, [0, 1], [1.02, 1.0], {
    extrapolateRight: 'clamp',
  });

  const motionBlurSamples = getMotionBlurSamples(scene.cameraMove.move);

  const screenshotContent = (
    <ScreenshotLayer
      src={scene.imageUrl}
      camera={scene.cameraMove}
      frame={frame}
      fps={fps}
      shotDuration={scene.durationSeconds}
    />
  );

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      <AbsoluteFill
        style={{
          opacity: introOpacity,
          transform: `scale(${introScale})`,
        }}
      >
        {motionBlurSamples > 0 ? (
          <CameraMotionBlur samples={motionBlurSamples} shutterAngle={180}>
            {screenshotContent}
          </CameraMotionBlur>
        ) : (
          screenshotContent
        )}
      </AbsoluteFill>

      {/* Cinematic overlay: vignette + grain + letterbox */}
      <CinematicOverlay vignetteIntensity={0.3} grainIntensity={0.035} />
    </AbsoluteFill>
  );
};
