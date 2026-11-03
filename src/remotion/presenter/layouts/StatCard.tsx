/**
 * StatCard layout: animated statistics display.
 *
 * Client-side copy of workers/video-renderer/src/remotion/layouts/StatCard.tsx.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import type { BrandConfig } from '@/remotion/presenter/types';

interface StatCardProps {
  value: number | string;
  label: string;
  brand: BrandConfig;
}

export const StatCard: React.FC<StatCardProps> = ({ value, label, brand }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const counterProgress = spring({
    frame,
    fps,
    config: { damping: 30, stiffness: 80, mass: 0.8 },
  });

  const numericValue = typeof value === 'number' ? value : parseFloat(value as string);
  const isNumeric = !isNaN(numericValue);
  const displayValue = isNumeric
    ? Math.round(interpolate(counterProgress, [0, 1], [0, numericValue]))
    : value;

  const formattedValue =
    typeof displayValue === 'number'
      ? displayValue.toLocaleString()
      : displayValue;

  const labelProgress = spring({
    frame: Math.max(0, frame - 10),
    fps,
    config: { damping: 20, stiffness: 100, mass: 0.6 },
  });

  const labelOpacity = interpolate(labelProgress, [0, 1], [0, 1]);
  const labelTranslateY = interpolate(labelProgress, [0, 1], [30, 0]);

  const gradientShift = interpolate(frame, [0, 120], [0, 30], { extrapolateRight: 'clamp' });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#000000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `radial-gradient(ellipse at ${50 + gradientShift}% ${50 - gradientShift * 0.5}%, ${brand.accent_color}30 0%, ${brand.primary_color}10 40%, transparent 70%)`,
        }}
      />

      <div
        style={{
          fontSize: Math.round(width * 0.14),
          fontWeight: 900,
          color: brand.accent_color,
          fontFamily: brand.font_family || 'Inter, sans-serif',
          lineHeight: 1.1,
          zIndex: 1,
          letterSpacing: -3,
          textShadow: `0 0 60px ${brand.accent_color}40`,
        }}
      >
        {formattedValue}
      </div>

      <div
        style={{
          width: interpolate(counterProgress, [0, 1], [0, Math.round(width * 0.2)]),
          height: 4,
          backgroundColor: brand.accent_color,
          marginTop: 24,
          marginBottom: 24,
          borderRadius: 2,
          opacity: 0.6,
          zIndex: 1,
        }}
      />

      <div
        style={{
          fontSize: Math.round(width * 0.04),
          fontWeight: 500,
          color: brand.text_color || '#FFFFFF',
          fontFamily: brand.font_family || 'Inter, sans-serif',
          opacity: labelOpacity,
          transform: `translateY(${labelTranslateY}px)`,
          zIndex: 1,
          letterSpacing: 2,
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
    </AbsoluteFill>
  );
};
