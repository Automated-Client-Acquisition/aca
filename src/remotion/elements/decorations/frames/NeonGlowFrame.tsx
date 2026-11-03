/**
 * NeonGlowFrame — Rounded rectangle with animated neon glow effect.
 *
 * Looping: box-shadow spread oscillates using sin wave.
 * Uses brand.accent_color for glow color.
 * Default size 200x160px (configurable via config.width / config.height).
 */

import React from 'react';
import type { DecorationComponentProps } from '../types';

export const NeonGlowFrame: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
  config,
}) => {
  const frameWidth = (config?.width as number) ?? 200;
  const frameHeight = (config?.height as number) ?? 160;
  const color = brand.accent_color;

  // Looping glow intensity oscillation — 1.5 second cycle
  const cycleDuration = fps * 1.5;
  const progress = (frame % cycleDuration) / cycleDuration;
  const glowIntensity = Math.sin(progress * Math.PI * 2);

  // Map -1..1 to spread range 4..16
  const spread = 10 + 6 * glowIntensity;
  // Map -1..1 to blur range 8..24
  const blur = 16 + 8 * glowIntensity;
  // Opacity oscillates for breathing effect
  const glowOpacity = 0.5 + 0.3 * glowIntensity;

  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        borderRadius: 12,
        border: `2px solid ${color}`,
        backgroundColor: 'rgba(0, 0, 0, 0.3)',
        boxShadow: [
          `0 0 ${blur}px ${spread}px rgba(${hexToRgb(color)}, ${glowOpacity})`,
          `inset 0 0 ${blur * 0.5}px ${spread * 0.3}px rgba(${hexToRgb(color)}, ${glowOpacity * 0.3})`,
        ].join(', '),
      }}
    />
  );
};

/** Convert hex color to comma-separated RGB string for use in rgba(). */
function hexToRgb(hex: string): string {
  const clean = hex.replace('#', '');
  const num = parseInt(clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean,
    16,
  );
  return `${(num >> 16) & 255}, ${(num >> 8) & 255}, ${num & 255}`;
}
