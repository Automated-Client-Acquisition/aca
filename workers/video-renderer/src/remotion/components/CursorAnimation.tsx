/**
 * CursorAnimation — Fake cursor that moves to a target position and clicks.
 *
 * Renders an animated mouse cursor that travels to a target element
 * and performs a visual click with a ripple effect.
 * Used for the 'fake_cursor_click' highlight type.
 *
 * Pure React — no Node.js-specific code.
 */

import React from 'react';
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { ElementBounds } from '../types.js';

interface CursorAnimationProps {
  targetBounds: ElementBounds;
  startX?: number;
  startY?: number;
  clickAtFrame?: number;
}

export const CursorAnimation: React.FC<CursorAnimationProps> = ({
  targetBounds,
  startX,
  startY,
  clickAtFrame = 15,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Default start position: bottom-right area
  const fromX = startX ?? width * 0.8;
  const fromY = startY ?? height * 0.8;

  // Target: center of the target element
  const toX = targetBounds.x + targetBounds.width / 2;
  const toY = targetBounds.y + targetBounds.height / 2;

  // Movement phase: cursor travels to target
  const moveProgress = spring({
    frame: Math.min(frame, clickAtFrame),
    fps,
    config: {
      damping: 20,
      stiffness: 100,
      mass: 0.5,
    },
  });

  const cursorX = interpolate(moveProgress, [0, 1], [fromX, toX]);
  const cursorY = interpolate(moveProgress, [0, 1], [fromY, toY]);

  // Click phase: happens after cursor arrives
  const clickFrame = frame - clickAtFrame;
  const isClicking = clickFrame >= 0;

  // Click ripple animation
  const clickScale = isClicking
    ? interpolate(clickFrame, [0, 5, 15], [0, 1.5, 2.5], {
        extrapolateRight: 'clamp',
      })
    : 0;
  const clickOpacity = isClicking
    ? interpolate(clickFrame, [0, 5, 15], [0.6, 0.3, 0], {
        extrapolateRight: 'clamp',
      })
    : 0;

  // Cursor press animation (slight scale down on click)
  const cursorScale = isClicking
    ? interpolate(clickFrame, [0, 3, 8], [1, 0.85, 1], {
        extrapolateRight: 'clamp',
      })
    : 1;

  // Fade out cursor after click
  const cursorOpacity = interpolate(
    frame,
    [0, 5, clickAtFrame + 20, clickAtFrame + 25],
    [0, 1, 1, 0],
    { extrapolateRight: 'clamp', extrapolateLeft: 'clamp' },
  );

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {/* Click ripple */}
      {isClicking && (
        <div
          style={{
            position: 'absolute',
            left: toX - 25,
            top: toY - 25,
            width: 50,
            height: 50,
            borderRadius: '50%',
            border: '2px solid rgba(255, 255, 255, 0.8)',
            transform: `scale(${clickScale})`,
            opacity: clickOpacity,
          }}
        />
      )}

      {/* Cursor */}
      <div
        style={{
          position: 'absolute',
          left: cursorX,
          top: cursorY,
          transform: `scale(${cursorScale})`,
          opacity: cursorOpacity,
          transformOrigin: 'top left',
          filter: 'drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5))',
        }}
      >
        {/* Default cursor SVG */}
        <svg
          width="24"
          height="32"
          viewBox="0 0 24 32"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M2 2L2 26L8.5 19.5L14 28L18 26L12.5 17.5L21 17.5L2 2Z"
            fill="white"
            stroke="black"
            strokeWidth="2"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </AbsoluteFill>
  );
};
