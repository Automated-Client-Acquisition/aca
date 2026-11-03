/**
 * CommentBubble — Speech bubble with bounce entrance and staggered dots.
 *
 * Non-looping: bubble bounces in from below using spring, then three dots
 * fade in with a stagger delay after the bubble settles.
 * Uses brand.accent_color for bubble, white for dots. Base size ~48px.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

export const CommentBubble: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  // Bubble entrance: bounce up from below
  const bubbleSpring = spring({
    frame,
    fps,
    config: {
      damping: 9,
      stiffness: 180,
      mass: 0.5,
    },
    durationInFrames: Math.round(fps * 0.6),
  });

  const translateY = interpolate(bubbleSpring, [0, 1], [24, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const scale = interpolate(bubbleSpring, [0, 1], [0.4, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const opacity = interpolate(bubbleSpring, [0, 0.2], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Dots stagger in after bubble settles (~0.4s delay from start)
  const dotDelay = Math.round(fps * 0.4);
  const dotStagger = Math.round(fps * 0.1); // 100ms between dots

  const dotOpacities = [0, 1, 2].map((i) => {
    const dotFrame = Math.max(0, frame - dotDelay - i * dotStagger);
    return interpolate(dotFrame, [0, Math.round(fps * 0.15)], [0, 1], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    });
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
        transform: `translateY(${translateY}px) scale(${scale})`,
        opacity,
      }}
    >
      <svg width={48} height={48} viewBox="0 0 48 48" fill="none">
        {/* Bubble body */}
        <rect x={4} y={6} width={40} height={28} rx={8} fill={color} />
        {/* Bubble tail */}
        <polygon points="14,34 20,34 12,42" fill={color} />
        {/* Three dots inside the bubble */}
        <circle cx={16} cy={20} r={3} fill="white" opacity={dotOpacities[0]} />
        <circle cx={24} cy={20} r={3} fill="white" opacity={dotOpacities[1]} />
        <circle cx={32} cy={20} r={3} fill="white" opacity={dotOpacities[2]} />
      </svg>
    </div>
  );
};
