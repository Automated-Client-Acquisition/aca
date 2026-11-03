/**
 * Stagger — staggered animation wrapper for lists of children.
 *
 * Wraps each child with an incrementing delay, creating a wave entrance.
 * Replaces the manual `items.map((item, i) => { const d = i * STAGGER_DELAY; ... })`
 * pattern used in ListReveal and QuoteCard.
 */

import React from 'react';
import { FadeIn } from './FadeIn';
import { SlideIn } from './SlideIn';
import { ScaleIn } from './ScaleIn';
import type { SpringPreset } from './easing';

type AnimationType = 'fade' | 'slide_up' | 'slide_down' | 'slide_left' | 'scale';

interface StaggerProps {
  children: React.ReactNode[];
  /** Frames between each child's entrance. Default: 8. */
  staggerDelay?: number;
  /** Frames before first child starts. Default: 0. */
  initialDelay?: number;
  /** Animation type for each child. Default: 'slide_up'. */
  animation?: AnimationType;
  /** Spring preset. Default: 'smooth'. */
  preset?: SpringPreset;
}

export const Stagger: React.FC<StaggerProps> = ({
  children,
  staggerDelay = 8,
  initialDelay = 0,
  animation = 'slide_up',
  preset = 'smooth',
}) => {
  return (
    <>
      {React.Children.map(children, (child, index) => {
        const delay = initialDelay + index * staggerDelay;

        switch (animation) {
          case 'fade':
            return <FadeIn delay={delay} preset={preset}>{child}</FadeIn>;
          case 'slide_up':
            return <SlideIn direction="up" delay={delay} preset={preset}>{child}</SlideIn>;
          case 'slide_down':
            return <SlideIn direction="down" delay={delay} preset={preset}>{child}</SlideIn>;
          case 'slide_left':
            return <SlideIn direction="left" delay={delay} preset={preset}>{child}</SlideIn>;
          case 'scale':
            return <ScaleIn delay={delay} preset={preset}>{child}</ScaleIn>;
          default:
            return <SlideIn direction="up" delay={delay} preset={preset}>{child}</SlideIn>;
        }
      })}
    </>
  );
};
