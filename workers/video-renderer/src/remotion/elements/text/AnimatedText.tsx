/**
 * AnimatedText — dispatcher for text animation types.
 *
 * Each text layout replaces its raw text rendering with this component.
 * Dispatches to TypewriterText, GlitchText, etc. based on the
 * `animation` prop. Returns null for 'spring_fade' or undefined,
 * letting the calling layout fall back to its existing animation.
 */

import React from 'react';
import { TypewriterText } from './TypewriterText.js';
import { GlitchText } from './GlitchText.js';
import { GradientText } from './GradientText.js';
import { WaveText } from './WaveText.js';
import { BounceText } from './BounceText.js';
import type { BrandConfig, TextAnimationType } from '../../types.js';

interface AnimatedTextProps {
  text: string;
  brand: BrandConfig;
  animation?: TextAnimationType | null;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  style?: React.CSSProperties;
}

export const AnimatedText: React.FC<AnimatedTextProps> = ({
  text,
  brand,
  animation,
  fontSize,
  fontWeight = 700,
  color,
  style,
}) => {
  const textStyle: React.CSSProperties = {
    color: color || brand.text_color,
    ...style,
  };

  switch (animation) {
    case 'typewriter':
      return (
        <TypewriterText
          text={text}
          brand={brand}
          fontSize={fontSize}
          fontWeight={fontWeight}
          style={textStyle}
        />
      );
    case 'glitch':
      return (
        <GlitchText
          text={text}
          brand={brand}
          fontSize={fontSize}
          fontWeight={fontWeight}
          style={textStyle}
        />
      );
    case 'gradient_sweep':
      return (
        <GradientText
          text={text}
          brand={brand}
          fontSize={fontSize}
          fontWeight={fontWeight}
          style={textStyle}
        />
      );
    case 'wave':
      return (
        <WaveText
          text={text}
          brand={brand}
          fontSize={fontSize}
          fontWeight={fontWeight}
          style={textStyle}
        />
      );
    case 'bounce':
      return (
        <BounceText
          text={text}
          brand={brand}
          fontSize={fontSize}
          fontWeight={fontWeight}
          style={textStyle}
        />
      );
    case 'spring_fade':
    default:
      // Return null — the layout will use its own existing spring entrance.
      return null;
  }
};
