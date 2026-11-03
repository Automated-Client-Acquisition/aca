/**
 * RoundedFrame — Rounded corner frame with animated border-color hue rotation.
 *
 * Looping: border color sweeps through hues via HSL rotation.
 * Default size 200x150px (configurable via config.width / config.height).
 * border-radius 16px, border 3px solid, subtle glow matching border color.
 */

import React from 'react';
import type { DecorationComponentProps } from '../types';

export const RoundedFrame: React.FC<DecorationComponentProps> = ({
  brand,
  frame,
  fps,
  config,
}) => {
  const frameWidth = (config?.width as number) ?? 200;
  const frameHeight = (config?.height as number) ?? 150;

  // Looping hue rotation — full 360deg cycle over 3 seconds
  const cycleDuration = fps * 3;
  const progress = (frame % cycleDuration) / cycleDuration;
  const hue = Math.round(progress * 360);

  // Base hue derived from brand accent, shifted by animated offset
  const baseHue = hexToHue(brand.accent_color);
  const animatedHue = (baseHue + hue) % 360;

  const borderColor = `hsl(${animatedHue}, 80%, 55%)`;
  const glowColor = `hsla(${animatedHue}, 80%, 55%, 0.35)`;

  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        borderRadius: 16,
        border: `3px solid ${borderColor}`,
        backgroundColor: 'transparent',
        boxShadow: `0 0 12px 4px ${glowColor}`,
      }}
    />
  );
};

/** Extract approximate hue (0-360) from a hex color. */
function hexToHue(hex: string): number {
  const clean = hex.replace('#', '');
  const expanded = clean.length === 3
    ? clean.split('').map(c => c + c).join('')
    : clean;
  const num = parseInt(expanded, 16);
  const r = ((num >> 16) & 255) / 255;
  const g = ((num >> 8) & 255) / 255;
  const b = (num & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  if (delta === 0) return 0;

  let hue = 0;
  if (max === r) {
    hue = ((g - b) / delta) % 6;
  } else if (max === g) {
    hue = (b - r) / delta + 2;
  } else {
    hue = (r - g) / delta + 4;
  }

  hue = Math.round(hue * 60);
  if (hue < 0) hue += 360;
  return hue;
}
