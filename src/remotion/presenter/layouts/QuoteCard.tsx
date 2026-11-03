/**
 * QuoteCard layout: styled quote display with word-by-word fade-in.
 *
 * Client-side copy of workers/video-renderer/src/remotion/layouts/QuoteCard.tsx.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { interpolateStyles } from '@remotion/animation-utils';
import type { BrandConfig } from '@/remotion/presenter/types';

interface QuoteCardProps {
  quote: string;
  attribution: string;
  brand: BrandConfig;
}

export const QuoteCard: React.FC<QuoteCardProps> = ({ quote, attribution, brand }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  const quoteMarkProgress = spring({
    frame,
    fps,
    config: { damping: 20, stiffness: 100, mass: 0.6 },
  });

  const words = quote.split(/\s+/);
  const WORD_STAGGER = 2;

  const attrDelay = words.length * WORD_STAGGER + 15;
  const attrProgress = spring({
    frame: Math.max(0, frame - attrDelay),
    fps,
    config: { damping: 20, stiffness: 100, mass: 0.8 },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: '#1a1a2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 100px',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: `linear-gradient(135deg, ${brand.accent_color}15 0%, transparent 50%, ${brand.primary_color}08 100%)`,
        }}
      />

      <div style={{ zIndex: 1, maxWidth: '85%', textAlign: 'center' }}>
        <div
          style={interpolateStyles(quoteMarkProgress, [0, 1], [
            { opacity: 0, transform: 'scale(0.5) translateY(20px)' },
            { opacity: 0.7, transform: 'scale(1) translateY(0px)' },
          ])}
        >
          <span
            style={{
              fontSize: Math.round(width * 0.12),
              lineHeight: '0.6',
              color: brand.accent_color,
              fontFamily: 'Georgia, serif',
              display: 'block',
              marginBottom: 30,
            }}
          >
            {'\u201C'}
          </span>
        </div>

        <div
          style={{
            fontSize: Math.round(width * 0.042),
            fontWeight: 400,
            color: '#FFFFFF',
            fontFamily: brand.font_family || 'Inter, sans-serif',
            lineHeight: 1.6,
            letterSpacing: 0.3,
          }}
        >
          {words.map((word, i) => {
            const wordStart = i * WORD_STAGGER + 5;
            const wordOpacity = interpolate(frame, [wordStart, wordStart + 6], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
            const wordTranslateY = interpolate(frame, [wordStart, wordStart + 6], [8, 0], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });

            return (
              <span
                key={i}
                style={{
                  opacity: wordOpacity,
                  transform: `translateY(${wordTranslateY}px)`,
                  display: 'inline-block',
                  marginRight: '0.3em',
                }}
              >
                {word}
              </span>
            );
          })}
        </div>

        <div
          style={{
            fontSize: Math.round(width * 0.08),
            lineHeight: '0.6',
            color: brand.accent_color,
            fontFamily: 'Georgia, serif',
            opacity: 0.5,
            marginTop: 20,
          }}
        >
          {'\u201D'}
        </div>

        {attribution && (
          <div
            style={{
              fontSize: Math.round(width * 0.025),
              fontWeight: 500,
              color: brand.accent_color,
              fontFamily: brand.font_family || 'Inter, sans-serif',
              marginTop: 40,
              opacity: interpolate(attrProgress, [0, 1], [0, 0.8]),
              transform: `translateY(${interpolate(attrProgress, [0, 1], [15, 0])}px)`,
              letterSpacing: 1.5,
              textTransform: 'uppercase',
            }}
          >
            {'\u2014 '}{attribution}
          </div>
        )}
      </div>
    </AbsoluteFill>
  );
};
