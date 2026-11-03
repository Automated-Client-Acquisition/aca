/**
 * LikeHeart — A heart icon with pop/scale entrance animation.
 *
 * Non-looping: spring scale 0 -> 1.2 -> 1.0 with a slight rotation wiggle.
 * Uses red (#EF4444). Base size ~48px.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

export const LikeHeart: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
}) => {
  // Bouncy pop entrance: scale from 0 to overshoot then settle
  const scaleSpring = spring({
    frame,
    fps,
    config: {
      damping: 8,
      stiffness: 200,
      mass: 0.6,
    },
    durationInFrames: Math.round(fps * 0.8),
  });

  // Map spring 0->1 through an overshoot curve: 0 -> 1.2 -> 1.0
  const scale = interpolate(scaleSpring, [0, 0.8, 1], [0, 1.2, 1.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Slight rotation wiggle during the entrance
  const rotation = interpolate(
    scaleSpring,
    [0, 0.3, 0.6, 0.85, 1],
    [0, -12, 10, -4, 0],
    { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
  );

  const color = '#EF4444';

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `scale(${scale}) rotate(${rotation}deg)`,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        <path
          d="M24 42s-16-9.2-16-21C8 14.4 12.4 10 18 10c3.2 0 5.6 1.6 6 2 .4-.4 2.8-2 6-2 5.6 0 10 4.4 10 11 0 11.8-16 21-16 21z"
          fill={color}
        />
      </svg>
    </div>
  );
};
