/**
 * SubscribeBadge — Red rounded rectangle with "SUBSCRIBE" text.
 *
 * Entrance: spring scale from 0 to 1.
 * Looping: gentle scale pulse (1.0 -> 1.05 -> 1.0) using modulo spring.
 * White text on red (#FF0000) background.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

const PULSE_DURATION_FRAMES = 40;

export const SubscribeBadge: React.FC<DecorationComponentProps> = ({
  frame,
  fps,
}) => {
  // ── Entrance: spring scale 0 -> 1 ──
  const entranceScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 120, mass: 0.8 },
  });

  // ── Looping pulse: 1.0 -> 1.05 -> 1.0 ──
  const loopFrame = frame % PULSE_DURATION_FRAMES;
  const pulseSpring = spring({
    frame: loopFrame,
    fps,
    config: { damping: 10, stiffness: 80, mass: 0.5 },
    durationInFrames: PULSE_DURATION_FRAMES,
  });
  const pulseScale = interpolate(pulseSpring, [0, 1], [1.0, 1.05]);

  const combinedScale = entranceScale * pulseScale;

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: '#FF0000',
        borderRadius: 6,
        padding: '8px 18px',
        transform: `scale(${combinedScale})`,
        transformOrigin: 'center center',
        boxShadow: '0 2px 8px rgba(255, 0, 0, 0.4)',
      }}
    >
      <span
        style={{
          color: '#FFFFFF',
          fontSize: 16,
          fontWeight: 700,
          letterSpacing: 1.2,
          fontFamily: 'Arial, Helvetica, sans-serif',
          lineHeight: 1,
          textTransform: 'uppercase',
        }}
      >
        SUBSCRIBE
      </span>
    </div>
  );
};
