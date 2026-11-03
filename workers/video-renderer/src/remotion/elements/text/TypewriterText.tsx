/**
 * TypewriterText — character-by-character reveal with blinking cursor.
 *
 * Renders text as if being typed in real-time.
 */

import React from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import type { BrandConfig } from '../../types.js';

interface TypewriterTextProps {
  text: string;
  brand: BrandConfig;
  /** Characters revealed per second. Default: 20. */
  charsPerSecond?: number;
  /** Show blinking cursor. Default: true. */
  showCursor?: boolean;
  /** Cursor color. Defaults to brand.accent_color. */
  cursorColor?: string;
  /** Font size in px. */
  fontSize?: number;
  /** Font weight. Default: 700. */
  fontWeight?: number;
  /** Additional styles for the text container. */
  style?: React.CSSProperties;
}

export const TypewriterText: React.FC<TypewriterTextProps> = ({
  text,
  brand,
  charsPerSecond = 20,
  showCursor = true,
  cursorColor,
  fontSize,
  fontWeight = 700,
  style,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const totalChars = text.length;
  const totalFrames = Math.ceil((totalChars / charsPerSecond) * fps);

  const visibleChars = Math.round(
    interpolate(frame, [0, totalFrames], [0, totalChars], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    }),
  );

  const visibleText = text.substring(0, visibleChars);

  // Cursor blinks every 15 frames (on for 15, off for 15)
  const cursorVisible = showCursor && frame % 30 < 15;
  // Always show cursor while typing
  const showCursorNow = showCursor && (visibleChars < totalChars || cursorVisible);

  return (
    <div
      style={{
        fontFamily: brand.font_family || 'Inter, sans-serif',
        fontSize: fontSize,
        fontWeight,
        color: brand.text_color,
        lineHeight: 1.3,
        ...style,
      }}
    >
      {visibleText}
      {showCursorNow && (
        <span
          style={{
            display: 'inline-block',
            width: fontSize ? fontSize * 0.06 : 3,
            height: fontSize ? fontSize * 0.9 : '0.9em',
            backgroundColor: cursorColor || brand.accent_color,
            marginLeft: 2,
            verticalAlign: 'text-bottom',
          }}
        />
      )}
    </div>
  );
};
