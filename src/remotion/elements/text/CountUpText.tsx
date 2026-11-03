/**
 * CountUpText — animated number counter.
 *
 * Extracted from StatCard's counter logic as a standalone element.
 * Animates from 0 to target value with spring physics.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig, spring, interpolate } from 'remotion';
import { SPRING_PRESETS, type SpringPreset } from '../primitives/easing';
import type { BrandConfig } from '@/remotion/presenter/types';

interface CountUpTextProps {
  /** Target number to count up to. */
  value: number;
  brand: BrandConfig;
  /** Spring preset. Default: 'gentle'. */
  preset?: SpringPreset;
  /** Delay in frames before counting starts. Default: 0. */
  delay?: number;
  /** Text prefix (e.g. '$', '+', '#'). */
  prefix?: string;
  /** Text suffix (e.g. '%', 'K', 'M', '+'). */
  suffix?: string;
  /** Number of decimal places. Default: 0. */
  decimals?: number;
  /** Font size in px. */
  fontSize?: number;
  /** Font weight. Default: 800. */
  fontWeight?: number;
  /** Additional styles. */
  style?: React.CSSProperties;
}

export const CountUpText: React.FC<CountUpTextProps> = ({
  value,
  brand,
  preset = 'gentle',
  delay = 0,
  prefix = '',
  suffix = '',
  decimals = 0,
  fontSize,
  fontWeight = 800,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const progress = spring({
    frame: Math.max(0, frame - delay),
    fps,
    config: SPRING_PRESETS[preset],
  });

  const currentValue = interpolate(progress, [0, 1], [0, value]);
  const displayValue = decimals > 0
    ? currentValue.toFixed(decimals)
    : Math.round(currentValue).toLocaleString();

  return (
    <span
      style={{
        fontFamily: brand.font_family || 'Inter, sans-serif',
        fontSize,
        fontWeight,
        color: brand.accent_color,
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {prefix}{displayValue}{suffix}
    </span>
  );
};
