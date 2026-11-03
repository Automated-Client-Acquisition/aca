/**
 * TextCard layout: full-screen text card for hooks, stats, and quotes.
 *
 * Client-side copy of workers/video-renderer/src/remotion/layouts/TextCard.tsx.
 */

import React from 'react';
import { AbsoluteFill, useVideoConfig, interpolate, useCurrentFrame, spring } from 'remotion';
import { interpolateStyles, makeTransform, translateY, scale } from '@remotion/animation-utils';
import type { BrandConfig, TextStyle } from '@/remotion/presenter/types';

interface TextCardProps {
  text: string;
  textStyle: TextStyle;
  brand: BrandConfig;
}

export const TextCard: React.FC<TextCardProps> = ({ text, textStyle, brand }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const entryProgress = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });

  const entryStyles = interpolateStyles(entryProgress, [0, 1], [
    { opacity: 0, transform: makeTransform([translateY(20), scale(0.7)]) },
    { opacity: 1, transform: makeTransform([translateY(0), scale(1)]) },
  ]);

  const styles = getTextCardStyles(textStyle, brand, width, height);

  return (
    <AbsoluteFill
      style={{
        backgroundColor: styles.backgroundColor,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 80px',
      }}
    >
      {styles.hasGradient && (
        <div style={{ position: 'absolute', inset: 0, background: styles.gradient }} />
      )}

      <div style={{ ...entryStyles, textAlign: 'center', zIndex: 1, maxWidth: '90%' }}>
        {textStyle === 'quote_highlight' && (
          <div style={{ fontSize: 120, lineHeight: '0.8', color: brand.accent_color, fontFamily: 'Georgia, serif', marginBottom: 20, opacity: 0.6 }}>
            {'\u201C'}
          </div>
        )}

        <div
          style={{
            fontSize: styles.fontSize,
            fontWeight: styles.fontWeight,
            color: styles.textColor,
            fontFamily: brand.font_family || 'Inter, sans-serif',
            lineHeight: styles.lineHeight,
            letterSpacing: styles.letterSpacing,
            textTransform: styles.textTransform as React.CSSProperties['textTransform'],
          }}
        >
          {text}
        </div>

        {textStyle === 'stat_callout' && (
          <div
            style={{
              width: interpolate(entryProgress, [0, 1], [0, 200]),
              height: 4,
              backgroundColor: brand.accent_color,
              margin: '30px auto 0',
              borderRadius: 2,
            }}
          />
        )}
      </div>
    </AbsoluteFill>
  );
};

interface TextCardStylePreset {
  backgroundColor: string;
  textColor: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textTransform: string;
  hasGradient: boolean;
  gradient: string;
}

function getTextCardStyles(style: TextStyle, brand: BrandConfig, width: number, _height: number): TextCardStylePreset {
  switch (style) {
    case 'hook_dramatic':
      return {
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
        fontSize: Math.round(width * 0.065),
        fontWeight: 900,
        lineHeight: 1.1,
        letterSpacing: -1,
        textTransform: 'uppercase',
        hasGradient: true,
        gradient: `radial-gradient(ellipse at center, ${brand.accent_color}22 0%, transparent 70%)`,
      };
    case 'stat_callout':
      return {
        backgroundColor: brand.primary_color,
        textColor: '#FFFFFF',
        fontSize: Math.round(width * 0.08),
        fontWeight: 800,
        lineHeight: 1.2,
        letterSpacing: -2,
        textTransform: 'none',
        hasGradient: false,
        gradient: '',
      };
    case 'quote_highlight':
      return {
        backgroundColor: '#1a1a2e',
        textColor: '#FFFFFF',
        fontSize: Math.round(width * 0.045),
        fontWeight: 500,
        lineHeight: 1.5,
        letterSpacing: 0,
        textTransform: 'none',
        hasGradient: true,
        gradient: `linear-gradient(135deg, ${brand.accent_color}15 0%, transparent 50%)`,
      };
    default:
      return {
        backgroundColor: '#000000',
        textColor: '#FFFFFF',
        fontSize: Math.round(width * 0.06),
        fontWeight: 800,
        lineHeight: 1.2,
        letterSpacing: -1,
        textTransform: 'none',
        hasGradient: false,
        gradient: '',
      };
  }
}
