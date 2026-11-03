/**
 * GradientTitle layout: full-screen title with animated gradient background.
 *
 * Large centered title text, animated gradient background that shifts hue,
 * optional subtitle with delayed entry, and text shadow for readability.
 * Uses makeTransform from @remotion/animation-utils.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import { makeTransform, translateY, scale } from '@remotion/animation-utils';
import { AnimatedText } from '../elements/text/AnimatedText.js';
import type { BrandConfig, TextAnimationType } from '../types.js';

interface GradientTitleProps {
  title: string;
  subtitle?: string;
  brand: BrandConfig;
  textAnimation?: TextAnimationType | null;
  transparentBackground?: boolean;
}

export const GradientTitle: React.FC<GradientTitleProps> = ({
  title,
  subtitle,
  brand,
  textAnimation,
  transparentBackground,
}) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Title entry spring
  const titleProgress = spring({
    frame,
    fps,
    config: {
      damping: 18,
      stiffness: 100,
      mass: 0.8,
    },
  });

  const titleScale = interpolate(titleProgress, [0, 1], [0.85, 1]);
  const titleTranslateYVal = interpolate(titleProgress, [0, 1], [40, 0]);
  const titleOpacity = interpolate(titleProgress, [0, 1], [0, 1]);

  // Subtitle entry (delayed)
  const subtitleProgress = spring({
    frame: Math.max(0, frame - 15),
    fps,
    config: {
      damping: 20,
      stiffness: 120,
      mass: 0.6,
    },
  });

  const subtitleTranslateY = interpolate(subtitleProgress, [0, 1], [25, 0]);
  const subtitleOpacity = interpolate(subtitleProgress, [0, 1], [0, 1]);

  // Animated gradient hue shift
  const hueShift = interpolate(frame, [0, 180], [0, 40], {
    extrapolateRight: 'clamp',
  });

  // Gradient position animation
  const gradientX = interpolate(frame, [0, 120], [30, 70], {
    extrapolateRight: 'clamp',
  });
  const gradientY = interpolate(frame, [0, 120], [20, 60], {
    extrapolateRight: 'clamp',
  });

  // Try animated text — returns null for spring_fade/undefined
  const animatedContent = textAnimation ? (
    <AnimatedText
      text={title}
      brand={brand}
      animation={textAnimation}
      fontSize={Math.round(width * 0.075)}
      fontWeight={900}
      color={brand.text_color || '#FFFFFF'}
      style={{
        fontFamily: brand.font_family || 'Inter, sans-serif',
        lineHeight: 1.1,
        letterSpacing: -2,
        textShadow: `0 4px 30px rgba(0,0,0,0.5), 0 0 80px ${brand.accent_color}30`,
      }}
    />
  ) : null;

  return (
    <AbsoluteFill
      style={{
        backgroundColor: transparentBackground ? 'transparent' : '#000000',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        padding: '60px 100px',
      }}
    >
      {/* Animated gradient background — suppress when shot-level background is active */}
      {!transparentBackground && (
        <>
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `radial-gradient(ellipse at ${gradientX}% ${gradientY}%, ${brand.accent_color}50 0%, ${brand.primary_color}25 35%, transparent 70%)`,
              filter: `hue-rotate(${hueShift}deg)`,
            }}
          />

          {/* Secondary gradient layer for depth */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: `linear-gradient(${135 + hueShift * 0.5}deg, ${brand.accent_color}10 0%, transparent 40%, ${brand.primary_color}10 100%)`,
            }}
          />
        </>
      )}

      {/* Title */}
      <div
        style={{
          opacity: titleOpacity,
          transform: makeTransform([translateY(titleTranslateYVal), scale(titleScale)]),
          zIndex: 1,
          textAlign: 'center',
          maxWidth: '90%',
        }}
      >
        {animatedContent || (
          <div
            style={{
              fontSize: Math.round(width * 0.075),
              fontWeight: 900,
              color: brand.text_color || '#FFFFFF',
              fontFamily: brand.font_family || 'Inter, sans-serif',
              lineHeight: 1.1,
              letterSpacing: -2,
              textShadow: `0 4px 30px rgba(0,0,0,0.5), 0 0 80px ${brand.accent_color}30`,
            }}
          >
            {title}
          </div>
        )}
      </div>

      {/* Subtitle */}
      {subtitle && (
        <div
          style={{
            opacity: subtitleOpacity,
            transform: `translateY(${subtitleTranslateY}px)`,
            zIndex: 1,
            textAlign: 'center',
            marginTop: 30,
            maxWidth: '75%',
          }}
        >
          <div
            style={{
              fontSize: Math.round(width * 0.032),
              fontWeight: 400,
              color: brand.text_color || '#FFFFFF',
              fontFamily: brand.font_family || 'Inter, sans-serif',
              lineHeight: 1.5,
              opacity: 0.8,
              textShadow: '0 2px 15px rgba(0,0,0,0.4)',
            }}
          >
            {subtitle}
          </div>
        </div>
      )}
    </AbsoluteFill>
  );
};
