/**
 * NewBadge — Rounded badge with "NEW" text and shine sweep.
 *
 * Uses brand.accent_color as background.
 * A white diagonal gradient sweeps across the badge via translateX animation.
 * CSS overflow hidden clips the shine effect.
 */

import React from 'react';
import { spring, interpolate } from 'remotion';
import type { DecorationComponentProps } from '../types';

const SWEEP_DURATION_FRAMES = 60;

export const NewBadge: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
}) => {
  const bgColor = brand.accent_color || '#F59E0B';

  // ── Entrance: spring scale 0 -> 1 ──
  const entranceScale = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 120, mass: 0.8 },
  });

  // ── Shine sweep: loops every SWEEP_DURATION_FRAMES ──
  const loopFrame = frame % SWEEP_DURATION_FRAMES;
  const sweepProgress = interpolate(loopFrame, [0, SWEEP_DURATION_FRAMES], [0, 1]);
  // Translate from -150% to +150% of badge width
  const shineTranslateX = interpolate(sweepProgress, [0, 1], [-150, 150]);

  return (
    <div
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        backgroundColor: bgColor,
        borderRadius: 8,
        padding: '8px 16px',
        transform: `scale(${entranceScale})`,
        transformOrigin: 'center center',
        overflow: 'hidden',
        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
      }}
    >
      {/* Shine sweep overlay */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          background: 'linear-gradient(105deg, transparent 40%, rgba(255,255,255,0.5) 50%, transparent 60%)',
          transform: `translateX(${shineTranslateX}%)`,
          pointerEvents: 'none',
        }}
      />
      <span
        style={{
          color: '#FFFFFF',
          fontSize: 18,
          fontWeight: 800,
          letterSpacing: 2,
          fontFamily: 'Arial, Helvetica, sans-serif',
          lineHeight: 1,
          position: 'relative',
          zIndex: 1,
        }}
      >
        NEW
      </span>
    </div>
  );
};
