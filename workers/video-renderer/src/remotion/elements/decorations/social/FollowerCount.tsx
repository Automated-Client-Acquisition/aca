/**
 * FollowerCount — "+1K" counter with scale-up entrance, upward float, and fade out.
 *
 * Non-looping: scales up from 0, then gently floats upward while fading out.
 * Green (#22C55E) bold text. Base size ~48px.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

export const FollowerCount: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
}) => {
  const totalDuration = fps * 2; // 2 seconds total animation

  // Phase 1: Scale up entrance (first ~0.4s)
  const entranceSpring = spring({
    frame,
    fps,
    config: {
      damping: 10,
      stiffness: 200,
      mass: 0.5,
    },
    durationInFrames: Math.round(fps * 0.4),
  });

  const scale = interpolate(entranceSpring, [0, 0.8, 1], [0, 1.15, 1.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Phase 2: Gentle upward float after entrance settles
  const floatStart = Math.round(fps * 0.5);
  const translateY = interpolate(
    frame,
    [0, floatStart, totalDuration],
    [0, 0, -20],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  // Phase 3: Fade out in the second half
  const fadeOutStart = Math.round(fps * 1.0);
  const opacity = interpolate(
    frame,
    [0, Math.round(fps * 0.1), fadeOutStart, totalDuration],
    [0, 1, 1, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const color = '#22C55E';

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${scale}) translateY(${translateY}px)`,
        opacity,
      }}
    >
      <span
        style={{
          color,
          fontSize: 22,
          fontWeight: 800,
          fontFamily: 'system-ui, -apple-system, sans-serif',
          lineHeight: 1,
          whiteSpace: 'nowrap',
        }}
      >
        +1K
      </span>
    </div>
  );
};
