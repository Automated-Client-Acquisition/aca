/**
 * GradientText — animated gradient color sweep on text.
 *
 * Uses background-clip: text for a gradient that sweeps across the text.
 */

import React from 'react';
import { useCurrentFrame, interpolate } from 'remotion';
import type { BrandConfig } from '../../types.js';

interface GradientTextProps {
  text: string;
  brand: BrandConfig;
  /** Gradient rotation speed (frames for full 360). Default: 120. */
  speed?: number;
  /** Override gradient colors [start, end]. */
  colors?: [string, string];
  /** Font size in px. */
  fontSize?: number;
  /** Font weight. Default: 800. */
  fontWeight?: number;
  /** Additional styles. */
  style?: React.CSSProperties;
}

/**
 * Lighten a hex color by mixing with white.
 */
function lightenHex(hex: string, amount: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const lr = Math.round(r + (255 - r) * amount);
  const lg = Math.round(g + (255 - g) * amount);
  const lb = Math.round(b + (255 - b) * amount);
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
}

export const GradientText: React.FC<GradientTextProps> = ({
  text,
  brand,
  speed = 120,
  colors,
  fontSize,
  fontWeight = 800,
  style,
}) => {
  const frame = useCurrentFrame();

  const angle = interpolate(frame, [0, speed], [0, 360], {
    extrapolateRight: 'extend',
  });

  const [color1, color2] = colors || [
    brand.accent_color,
    lightenHex(brand.accent_color, 0.5),
  ];

  return (
    <div
      style={{
        fontFamily: brand.font_family || 'Inter, sans-serif',
        fontSize,
        fontWeight,
        lineHeight: 1.2,
        background: `linear-gradient(${angle}deg, ${color1}, ${color2}, ${color1})`,
        backgroundClip: 'text',
        WebkitBackgroundClip: 'text',
        color: 'transparent',
        WebkitTextFillColor: 'transparent',
        ...style,
      }}
    >
      {text}
    </div>
  );
};
