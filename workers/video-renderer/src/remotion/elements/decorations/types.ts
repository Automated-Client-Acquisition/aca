import type { BrandConfig } from '../../types.js';

/**
 * Props every decoration component receives.
 * Position and scale are resolved by DecorationLayer before rendering.
 */
export interface DecorationComponentProps {
  brand: BrandConfig;
  /** Current frame within this decoration's lifetime (0 = decoration start). */
  frame: number;
  fps: number;
  width: number;
  height: number;
  /** Decoration-specific overrides from DecorationInstance.config. */
  config?: Record<string, any>;
}

export type DecorationCategory =
  | 'arrows'
  | 'badges'
  | 'social'
  | 'emphasis'
  | 'emojis'
  | 'frames';

export interface DecorationMeta {
  id: string;
  name: string;
  category: DecorationCategory;
  description: string;
  defaultScale: number;
  looping: boolean;
  tags: string[];
  emoji?: string;
}
