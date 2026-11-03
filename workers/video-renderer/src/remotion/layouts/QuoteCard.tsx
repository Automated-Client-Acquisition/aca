/**
 * QuoteCard layout: styled quote display with word-by-word fade-in.
 *
 * Large decorative quotation marks in accent color, quote text with
 * subtle word-by-word reveal, and attribution line below.
 * Uses interpolateStyles from @remotion/animation-utils.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { interpolateStyles } from '@remotion/animation-utils';
import { AnimatedText } from '../elements/text/AnimatedText.js';
import type { BrandConfig, TextAnimationType } from '../types.js';

interface QuoteCardProps {
  quote: string;
  attribution: string;
  brand: BrandConfig;
  textAnimation?: TextAnimationType | null;
  transparentBackground?: boolean;
}

export const QuoteCard: React.FC<QuoteCardProps> = ({
  quote,
  attribution,
  brand,
  textAnimation,
  transparentBackground,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Opening quote mark animation
  const quoteMarkProgress = spring({
    frame,
    fps,
    config: {
      damping: 20,
      stiffness: 100,
      mass: 0.6,
    },
  });

  // Word-by-word reveal
  const words = quote.split(/\s+/);
  const WORD_STAGGER = 2; // frames between each word appearing

  // Attribution fade-in (after all words revealed)
  const attrDelay = words.length * WORD_STAGGER + 15;
  const attrProgress = spring({
    frame: Math.max(0, frame - attrDelay),
    fps,
    config: {
      damping: 20,
      stiffness: 100,
      mass: 0.8,
    },
  });

  // Try animated text — returns null for spring_fade/undefined (use word-by-word)
  const useAnimated = textAnimation && textAnimation !== 'spring_fade';
  const animatedContent = useAnimated ? (
    <AnimatedText
      text={quote}
      brand={brand}
      animation={textAnimation}
      fontSize={Math.round(width * 0.042)}
      fontWeight={400}
      color="#FFFFFF"
      style={{
        fontFamily: brand.font_family || 'Inter, sans-serif',
        lineHeight: 1.6,
        letterSpacing: 0.3,
      }}
    />
  ) : null;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: transparentBackground ? 'transparent' : '#1a1a2e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '80px 100px',
      }}
    >
      {/* Subtle gradient background */}
      {!transparentBackground && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `linear-gradient(135deg, ${brand.accent_color}15 0%, transparent 50%, ${brand.primary_color}08 100%)`,
          }}
        />
      )}

      <div style={{ zIndex: 1, maxWidth: '85%', textAlign: 'center' }}>
        {/* Opening quotation mark */}
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

        {/* Quote text — animated or word-by-word reveal */}
        {animatedContent || (
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
              const wordOpacity = interpolate(
                frame,
                [wordStart, wordStart + 6],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
              );
              const wordTranslateY = interpolate(
                frame,
                [wordStart, wordStart + 6],
                [8, 0],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' },
              );

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
        )}

        {/* Closing quotation mark */}
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

        {/* Attribution */}
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
