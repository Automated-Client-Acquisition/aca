/**
 * ThumbsUp — Thumbs up emoji with bounce entrance animation.
 *
 * Non-looping: spring-driven bounce up from below with a slight rock rotation.
 * Renders emoji text at 48px. Base size ~48px.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

export const ThumbsUp: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
}) => {
  // Bounce up entrance via spring
  const entranceSpring = spring({
    frame,
    fps,
    config: {
      damping: 10,
      stiffness: 180,
      mass: 0.5,
    },
    durationInFrames: Math.round(fps * 0.7),
  });

  // Translate from 30px below to 0
  const translateY = interpolate(entranceSpring, [0, 1], [30, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Slight rock rotation during entrance: -10deg to 0deg
  const rotation = interpolate(entranceSpring, [0, 0.5, 1], [-10, 4, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  // Fade in alongside the entrance
  const opacity = interpolate(entranceSpring, [0, 0.3], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  return (
    <div
      style={{
        width: 48,
        height: 48,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transform: `translateY(${translateY}px) rotate(${rotation}deg)`,
        opacity,
        fontSize: 40,
        lineHeight: 1,
      }}
    >
      👍
    </div>
  );
};
