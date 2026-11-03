/**
 * PointingHand — An animated pointing hand with gentle side-to-side motion.
 *
 * Looping: continuous sinusoidal oscillation on the X axis.
 * Rendered as SVG for consistent cross-platform rendering.
 * Uses brand.accent_color for theming. Base size ~48px.
 */

import React from 'react';
import type { DecorationComponentProps } from '../types.js';

export const PointingHand: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const color = brand.accent_color;

  // Continuous sinusoidal motion: completes one cycle per second
  const frequency = (2 * Math.PI) / fps;
  const translateX = Math.sin(frame * frequency) * 6; // +/- 6px sway

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `translateX(${translateX}px)`,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        {/* Hand body / palm */}
        <rect
          x={8}
          y={18}
          width={16}
          height={16}
          rx={4}
          fill={color}
          opacity={0.9}
        />
        {/* Pointing finger */}
        <rect
          x={24}
          y={22}
          width={16}
          height={8}
          rx={4}
          fill={color}
        />
        {/* Finger tip / arrow indicator */}
        <polygon
          points="40,20 46,26 40,32"
          fill={color}
        />
        {/* Thumb */}
        <rect
          x={12}
          y={14}
          width={8}
          height={6}
          rx={3}
          fill={color}
          opacity={0.85}
        />
      </svg>
    </div>
  );
};
