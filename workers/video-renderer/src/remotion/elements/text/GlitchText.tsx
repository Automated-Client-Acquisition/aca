/**
 * GlitchText — random character scramble that resolves to final text.
 *
 * Each character cycles through random characters before settling.
 * Optional RGB split effect for extra digital glitch aesthetic.
 */

import React from 'react';
import { useCurrentFrame } from 'remotion';
import type { BrandConfig } from '../../types.js';

interface GlitchTextProps {
  text: string;
  brand: BrandConfig;
  /** Frames per character to settle. Default: 2. */
  settleDelay?: number;
  /** Enable RGB color split layers. Default: false. */
  rgbSplit?: boolean;
  /** Font size in px. */
  fontSize?: number;
  /** Font weight. Default: 800. */
  fontWeight?: number;
  /** Additional styles. */
  style?: React.CSSProperties;
}

const CHARSET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%&*<>{}[]';

/**
 * Deterministic pseudo-random character from charset.
 */
function randomChar(charIndex: number, frame: number): string {
  const hash = ((charIndex * 2654435761 + frame * 1597334677) >>> 0) % CHARSET.length;
  return CHARSET[hash];
}

export const GlitchText: React.FC<GlitchTextProps> = ({
  text,
  brand,
  settleDelay = 2,
  rgbSplit = false,
  fontSize,
  fontWeight = 800,
  style,
}) => {
  const frame = useCurrentFrame();

  const chars = text.split('').map((realChar, i) => {
    if (realChar === ' ') return ' ';
    const settleFrame = i * settleDelay + 4; // +4 frames initial scramble
    if (frame >= settleFrame) return realChar;
    return randomChar(i, frame);
  });

  const glitchedText = chars.join('');

  const baseStyle: React.CSSProperties = {
    fontFamily: brand.font_family || 'Inter, sans-serif',
    fontSize,
    fontWeight,
    color: brand.text_color,
    lineHeight: 1.2,
    letterSpacing: 1,
    ...style,
  };

  if (!rgbSplit) {
    return <div style={baseStyle}>{glitchedText}</div>;
  }

  // RGB split: 3 layers with offset and blend mode
  return (
    <div style={{ position: 'relative' }}>
      {/* Cyan layer */}
      <div
        style={{
          ...baseStyle,
          color: '#00FFFF',
          position: 'absolute',
          transform: `translateX(${frame < text.length * settleDelay ? -2 : 0}px)`,
          mixBlendMode: 'screen',
          opacity: 0.8,
        }}
      >
        {glitchedText}
      </div>
      {/* Magenta layer */}
      <div
        style={{
          ...baseStyle,
          color: '#FF00FF',
          position: 'absolute',
          transform: `translateX(${frame < text.length * settleDelay ? 2 : 0}px)`,
          mixBlendMode: 'screen',
          opacity: 0.8,
        }}
      >
        {glitchedText}
      </div>
      {/* White layer (primary) */}
      <div style={{ ...baseStyle, position: 'relative' }}>
        {glitchedText}
      </div>
    </div>
  );
};
