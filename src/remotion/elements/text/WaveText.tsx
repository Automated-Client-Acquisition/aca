/**
 * WaveText — per-character sine wave motion.
 *
 * Each character oscillates vertically creating a wave ripple effect.
 */

import React from 'react';
import { useCurrentFrame } from 'remotion';
import type { BrandConfig } from '@/remotion/presenter/types';

interface WaveTextProps {
  text: string;
  brand: BrandConfig;
  /** Wave speed. Default: 0.15. */
  speed?: number;
  /** Wave amplitude in px. Default: 10. */
  amplitude?: number;
  /** Wave spread between characters. Default: 0.5. */
  spread?: number;
  /** Font size in px. */
  fontSize?: number;
  /** Font weight. Default: 700. */
  fontWeight?: number;
  /** Additional styles. */
  style?: React.CSSProperties;
}

export const WaveText: React.FC<WaveTextProps> = ({
  text,
  brand,
  speed = 0.15,
  amplitude = 10,
  spread = 0.5,
  fontSize,
  fontWeight = 700,
  style,
}) => {
  const frame = useCurrentFrame();

  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'center',
        fontFamily: brand.font_family || 'Inter, sans-serif',
        fontSize,
        fontWeight,
        color: brand.text_color,
        lineHeight: 1.2,
        ...style,
      }}
    >
      {text.split('').map((char, i) => {
        const offsetY = Math.sin(frame * speed + i * spread) * amplitude;

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translateY(${offsetY}px)`,
              willChange: 'transform',
              // Preserve spaces
              whiteSpace: char === ' ' ? 'pre' : undefined,
            }}
          >
            {char}
          </span>
        );
      })}
    </div>
  );
};
