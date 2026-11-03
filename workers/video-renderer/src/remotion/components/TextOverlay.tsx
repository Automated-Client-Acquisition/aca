/**
 * TextOverlay — Big text overlays for hook cards, stat callouts, quote highlights.
 *
 * Renders large animated text on top of the composition.
 * Animates entrance with spring physics.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { AbsoluteFill, useVideoConfig, interpolate, spring } from 'remotion';
import type { TextStyle, BrandConfig } from '../types.js';

interface TextOverlayProps {
  text: string;
  style: TextStyle;
  brand: BrandConfig;
  frame: number;
  fps: number;
}

export const TextOverlay: React.FC<TextOverlayProps> = ({
  text,
  style,
  brand,
  frame,
  fps,
}) => {
  const { width, height } = useVideoConfig();

  // Entry animation
  const entryProgress = spring({
    frame,
    fps,
    config: {
      damping: 14,
      stiffness: 150,
      mass: 0.7,
    },
  });

  // Exit animation (start fading out at 80% of shot)
  const exitOpacity = interpolate(frame, [0, fps * 0.5, fps * 3, fps * 3.5], [0, 1, 1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });

  const presetStyle = getOverlayPreset(style, brand, width);

  const scale = interpolate(entryProgress, [0, 1], [0.6, 1]);
  const translateY = interpolate(entryProgress, [0, 1], [30, 0]);
  const opacity = Math.min(entryProgress, exitOpacity);

  return (
    <AbsoluteFill
      style={{
        display: 'flex',
        alignItems: presetStyle.verticalAlign,
        justifyContent: 'center',
        padding: presetStyle.padding,
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          transform: `scale(${scale}) translateY(${translateY}px)`,
          opacity,
          textAlign: 'center',
          maxWidth: '90%',
        }}
      >
        {/* Background pill/card if configured */}
        {presetStyle.hasBackground && (
          <div
            style={{
              position: 'absolute',
              inset: '-20px -40px',
              backgroundColor: presetStyle.bgColor,
              borderRadius: presetStyle.bgRadius,
              zIndex: -1,
            }}
          />
        )}

        <div
          style={{
            position: 'relative',
            fontSize: presetStyle.fontSize,
            fontWeight: presetStyle.fontWeight,
            color: presetStyle.color,
            fontFamily: brand.font_family || 'Inter, sans-serif',
            lineHeight: presetStyle.lineHeight,
            letterSpacing: presetStyle.letterSpacing,
            textShadow: presetStyle.textShadow,
            textTransform: presetStyle.textTransform as React.CSSProperties['textTransform'],
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};

// ─── Style Presets ───────────────────────────────────────────────────────────

interface OverlayPreset {
  fontSize: number;
  fontWeight: number;
  color: string;
  lineHeight: number;
  letterSpacing: number;
  textShadow: string;
  textTransform: string;
  verticalAlign: string;
  padding: string;
  hasBackground: boolean;
  bgColor: string;
  bgRadius: number;
}

function getOverlayPreset(
  style: TextStyle,
  brand: BrandConfig,
  viewportWidth: number,
): OverlayPreset {
  switch (style) {
    case 'hook_dramatic':
      return {
        fontSize: Math.round(viewportWidth * 0.055),
        fontWeight: 900,
        color: '#FFFFFF',
        lineHeight: 1.15,
        letterSpacing: -1,
        textShadow: '0 4px 30px rgba(0, 0, 0, 0.9), 0 2px 10px rgba(0, 0, 0, 0.5)',
        textTransform: 'uppercase',
        verticalAlign: 'flex-start',
        padding: '100px 50px 0',
        hasBackground: true,
        bgColor: 'rgba(0, 0, 0, 0.55)',
        bgRadius: 16,
      };
    case 'stat_callout':
      return {
        fontSize: Math.round(viewportWidth * 0.07),
        fontWeight: 800,
        color: brand.accent_color,
        lineHeight: 1.2,
        letterSpacing: -2,
        textShadow: '0 4px 20px rgba(0, 0, 0, 0.8)',
        textTransform: 'none',
        verticalAlign: 'flex-start',
        padding: '100px 50px 0',
        hasBackground: true,
        bgColor: 'rgba(0, 0, 0, 0.7)',
        bgRadius: 20,
      };
    case 'quote_highlight':
      return {
        fontSize: Math.round(viewportWidth * 0.038),
        fontWeight: 600,
        color: '#FFFFFF',
        lineHeight: 1.5,
        letterSpacing: 0,
        textShadow: '0 2px 12px rgba(0, 0, 0, 0.7)',
        textTransform: 'none',
        verticalAlign: 'flex-end',
        padding: '0 50px 300px 50px',
        hasBackground: true,
        bgColor: 'rgba(0, 0, 0, 0.6)',
        bgRadius: 16,
      };
    default:
      return {
        fontSize: Math.round(viewportWidth * 0.05),
        fontWeight: 800,
        color: '#FFFFFF',
        lineHeight: 1.2,
        letterSpacing: -1,
        textShadow: '0 4px 20px rgba(0, 0, 0, 0.8)',
        textTransform: 'none',
        verticalAlign: 'flex-start',
        padding: '100px 50px 0',
        hasBackground: true,
        bgColor: 'rgba(0, 0, 0, 0.55)',
        bgRadius: 16,
      };
  }
}
