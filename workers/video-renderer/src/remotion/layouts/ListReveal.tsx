/**
 * ListReveal layout: animated bullet point list with staggered reveals.
 *
 * Each item reveals one at a time with spring animation. Items slide up
 * and fade in with a check mark icon that pops in alongside.
 */

import React from 'react';
import { AbsoluteFill, useCurrentFrame, useVideoConfig, interpolate, spring } from 'remotion';
import type { BrandConfig } from '../types.js';

const STAGGER_DELAY = 8; // frames between each item

interface ListRevealProps {
  items: string[];
  title?: string;
  brand: BrandConfig;
  transparentBackground?: boolean;
}

export const ListReveal: React.FC<ListRevealProps> = ({ items, title, brand, transparentBackground }) => {
  const frame = useCurrentFrame();
  const { fps, width } = useVideoConfig();

  // Title entry animation
  const titleProgress = spring({
    frame,
    fps,
    config: {
      damping: 18,
      stiffness: 120,
      mass: 0.7,
    },
  });

  return (
    <AbsoluteFill
      style={{
        backgroundColor: transparentBackground ? 'transparent' : '#0a0a0f',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '60px 100px',
      }}
    >
      {/* Subtle accent glow */}
      {!transparentBackground && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: `radial-gradient(ellipse at 30% 20%, ${brand.accent_color}12 0%, transparent 60%)`,
          }}
        />
      )}

      <div style={{ zIndex: 1, width: '100%', maxWidth: '80%' }}>
        {/* Optional title */}
        {title && (
          <div
            style={{
              fontSize: Math.round(width * 0.05),
              fontWeight: 800,
              color: brand.text_color || '#FFFFFF',
              fontFamily: brand.font_family || 'Inter, sans-serif',
              marginBottom: 50,
              opacity: interpolate(titleProgress, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(titleProgress, [0, 1], [20, 0])}px)`,
            }}
          >
            {title}
          </div>
        )}

        {/* List items */}
        {items.map((item, i) => {
          const itemDelay = (title ? 12 : 0) + i * STAGGER_DELAY;

          const itemProgress = spring({
            frame: Math.max(0, frame - itemDelay),
            fps,
            config: {
              damping: 15,
              stiffness: 130,
              mass: 0.6,
            },
          });

          const itemOpacity = interpolate(itemProgress, [0, 1], [0, 1]);
          const itemTranslateY = interpolate(itemProgress, [0, 1], [25, 0]);

          // Check mark scale pops in slightly after the text
          const checkProgress = spring({
            frame: Math.max(0, frame - itemDelay - 2),
            fps,
            config: {
              damping: 10,
              stiffness: 200,
              mass: 0.4,
            },
          });

          const checkScale = interpolate(checkProgress, [0, 1], [0, 1]);

          return (
            <div
              key={i}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 20,
                marginBottom: 30,
                opacity: itemOpacity,
                transform: `translateY(${itemTranslateY}px)`,
              }}
            >
              {/* Check mark icon */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: '50%',
                  backgroundColor: brand.accent_color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: `scale(${checkScale})`,
                  flexShrink: 0,
                  marginTop: 4,
                }}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#000000"
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>

              {/* Item text */}
              <div
                style={{
                  fontSize: Math.round(width * 0.035),
                  fontWeight: 500,
                  color: brand.text_color || '#FFFFFF',
                  fontFamily: brand.font_family || 'Inter, sans-serif',
                  lineHeight: 1.4,
                }}
              >
                {item}
              </div>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};
