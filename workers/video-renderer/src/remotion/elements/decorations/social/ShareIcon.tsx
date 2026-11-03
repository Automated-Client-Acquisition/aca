/**
 * ShareIcon — Share/forward arrow with spring slide-in animation.
 *
 * Non-looping: slides in from the left and scales up using a spring.
 * SVG: three connected dots forming a share icon.
 * Uses brand.accent_color. Base size ~48px.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types.js';

export const ShareIcon: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const entranceSpring = spring({
    frame,
    fps,
    config: {
      damping: 12,
      stiffness: 160,
      mass: 0.6,
    },
    durationInFrames: Math.round(fps * 0.6),
  });

  // Slide in from left
  const translateX = interpolate(entranceSpring, [0, 1], [-24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Scale up from small
  const scale = interpolate(entranceSpring, [0, 1], [0.3, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const opacity = interpolate(entranceSpring, [0, 0.25], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const color = brand.accent_color;

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `translateX(${translateX}px) scale(${scale})`,
        opacity,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        {/* Top-right node */}
        <circle cx={34} cy={12} r={5} fill={color} />
        {/* Middle-left node */}
        <circle cx={14} cy={24} r={5} fill={color} />
        {/* Bottom-right node */}
        <circle cx={34} cy={36} r={5} fill={color} />
        {/* Connecting lines */}
        <line
          x1={18}
          y1={22}
          x2={30}
          y2={14}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
        />
        <line
          x1={18}
          y1={26}
          x2={30}
          y2={34}
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
};
