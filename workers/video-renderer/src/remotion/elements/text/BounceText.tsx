/**
 * BounceText — per-character spring bounce entrance with stagger.
 *
 * Each character bounces in from below with a staggered delay,
 * creating a playful wave entrance effect.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { SPRING_PRESETS, type SpringPreset } from './easing.js';
import type { BrandConfig } from '../../types.js';

interface BounceTextProps {
  text: string;
  brand: BrandConfig;
  /** Frames between each character's entrance. Default: 2. */
  staggerDelay?: number;
  /** Spring preset. Default: 'bouncy'. */
  preset?: SpringPreset;
  /** Font size in px. */
  fontSize?: number;
  /** Font weight. Default: 800. */
  fontWeight?: number;
  /** Additional styles. */
  style?: React.CSSProperties;
}

export const BounceText: React.FC<BounceTextProps> = ({
  text,
  brand,
  staggerDelay = 2,
  preset = 'bouncy',
  fontSize,
  fontWeight = 800,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

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
        const delay = i * staggerDelay;
        const progress = spring({
          frame: Math.max(0, frame - delay),
          fps,
          config: SPRING_PRESETS[preset],
        });

        const translateYVal = interpolate(progress, [0, 1], [40, 0]);
        const scaleVal = interpolate(progress, [0, 1], [0.3, 1]);
        const opacity = interpolate(progress, [0, 0.3], [0, 1], {
          extrapolateRight: 'clamp',
        });

        return (
          <span
            key={i}
            style={{
              display: 'inline-block',
              transform: `translateY(${translateYVal}px) scale(${scaleVal})`,
              opacity,
              willChange: 'transform',
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
