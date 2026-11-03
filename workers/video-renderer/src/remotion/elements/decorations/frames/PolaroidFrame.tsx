/**
 * PolaroidFrame — White rectangle with shadow and slight tilt.
 *
 * Non-looping: spring-driven entrance with rotation (-5deg to -2deg) and scale (0.8 to 1.0).
 * White background, dark shadow, wider bottom padding (like a real Polaroid).
 * Size: ~180x220px (taller than wide).
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

export const PolaroidFrame: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
}) => {
  const entranceProgress = spring({
    frame,
    fps,
    config: {
      damping: 12,
      stiffness: 100,
      mass: 0.8,
    },
    durationInFrames: Math.round(fps * 1.0),
  });

  // Rotation: -5deg -> -2deg (slight tilt remains after settle)
  const rotation = interpolate(entranceProgress, [0, 1], [-5, -2], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Scale: 0.8 -> 1.0
  const scale = interpolate(entranceProgress, [0, 1], [0.8, 1.0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Opacity entrance
  const opacity = interpolate(entranceProgress, [0, 0.3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: 180,
        height: 220,
        backgroundColor: '#ffffff',
        borderRadius: 2,
        padding: '12px 12px 36px 12px',
        boxShadow: '4px 6px 16px rgba(0, 0, 0, 0.35)',
        transform: `rotate(${rotation}deg) scale(${scale})`,
        opacity,
        display: 'flex',
        alignItems: 'stretch',
        justifyContent: 'stretch',
      }}
    >
      {/* Inner photo area */}
      <div
        style={{
          flex: 1,
          backgroundColor: '#e8e8e8',
          borderRadius: 1,
        }}
      />
    </div>
  );
};
