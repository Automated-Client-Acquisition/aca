/**
 * BRollCutaway layout: full-frame cutaway for B-roll footage or images.
 *
 * Smooth crossfade in (6 frames) and out (6 frames) via interpolate opacity.
 * Image B-roll gets Ken Burns animation via camera move system.
 * Video B-roll uses Remotion's <Video> component.
 * Optional lower-third text overlay (label).
 */

import React from 'react';
import { AbsoluteFill, Img, Video, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { getCameraTransform } from '../animations/camera.js';
import type { BrandConfig } from '../types.js';

const CROSSFADE_FRAMES = 6;

interface BRollCutawayProps {
  src: string;
  type: 'video' | 'image';
  label?: string;
  brand: BrandConfig;
}

export const BRollCutaway: React.FC<BRollCutawayProps> = ({
  src,
  type,
  label,
  brand,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();

  // Crossfade in/out opacity
  const opacity = interpolate(
    frame,
    [0, CROSSFADE_FRAMES, durationInFrames - CROSSFADE_FRAMES, durationInFrames],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Ken Burns for images
  const progress = durationInFrames > 0 ? frame / durationInFrames : 0;
  const camera = type === 'image'
    ? getCameraTransform('ken_burns_slow', progress, frame)
    : null;

  // Lower-third label animation
  const labelOpacity = label
    ? interpolate(frame, [10, 20], [0, 1], {
        extrapolateLeft: 'clamp',
        extrapolateRight: 'clamp',
      })
    : 0;

  return (
    <AbsoluteFill style={{ backgroundColor: '#000', opacity }}>
      {/* Media content */}
      {type === 'video' ? (
        <Video
          src={src}
          crossOrigin="anonymous"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            overflow: 'hidden',
          }}
        >
          <Img
            src={src}
            crossOrigin="anonymous"
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: camera
                ? `scale(${camera.scale}) translate(${camera.x}px, ${camera.y}px)`
                : undefined,
            }}
          />
        </div>
      )}

      {/* Lower-third label */}
      {label && (
        <div
          style={{
            position: 'absolute',
            bottom: 80,
            left: 60,
            right: 60,
            opacity: labelOpacity,
            zIndex: 10,
          }}
        >
          <div
            style={{
              display: 'inline-block',
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(10px)',
              padding: '12px 24px',
              borderRadius: 8,
              borderLeft: `3px solid ${brand.accent_color}`,
            }}
          >
            <span
              style={{
                fontSize: 22,
                fontWeight: 500,
                color: brand.text_color || '#FFFFFF',
                fontFamily: brand.font_family || 'Inter, sans-serif',
              }}
            >
              {label}
            </span>
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
