/**
 * Caption animation utilities.
 *
 * Word bounce, color transitions, scale animations, and entry effects
 * for different caption/subtitle styles. Uses spring physics for
 * natural-feeling animations.
 *
 * 5 styles matching frontend captionStyleTemplates.ts:
 *   clean_white    — White text, gold word highlight, bottom position
 *   karaoke_bold   — Bold text with word-by-word accent color fill
 *   boxed_yellow   — Yellow box behind active word
 *   bounce_pop     — Words pop in with bounce scale animation
 *   cinematic_lower— Elegant lower-third with backdrop blur
 *
 * Pure functions — no React hooks or Node.js dependencies.
 */

import { interpolate } from 'remotion';
import type { SubtitleStyle, WordTimestamp } from '../types.js';

// ─── Legacy Style Normalizer ────────────────────────────────────────────────

/** Map legacy 4-style names to the new 5-style system */
function normalize(style: SubtitleStyle): SubtitleStyle {
  switch (style) {
    case 'minimal': return 'clean_white';
    case 'karaoke': return 'karaoke_bold';
    case 'tiktok_bounce': return 'bounce_pop';
    case 'big_center': return 'cinematic_lower';
    default: return style;
  }
}

// ─── Word Grouping ───────────────────────────────────────────────────────────

/**
 * Group words into display chunks of N words per line.
 * Returns arrays of word groups for display.
 */
export function groupWordsIntoChunks(
  words: WordTimestamp[],
  wordsPerChunk: number = 4,
): WordTimestamp[][] {
  const chunks: WordTimestamp[][] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk));
  }
  return chunks;
}

/**
 * Find the currently active chunk index based on the current playback time.
 * Returns -1 if no chunk is active.
 */
export function findActiveChunkIndex(
  chunks: WordTimestamp[][],
  currentTime: number,
  trailingMs: number = 0.3,
): number {
  return chunks.findIndex((chunk) => {
    const chunkStart = chunk[0].start;
    const chunkEnd = chunk[chunk.length - 1].end + trailingMs;
    return currentTime >= chunkStart && currentTime <= chunkEnd;
  });
}

// ─── Spring Ease Helper ─────────────────────────────────────────────────────

/**
 * Critically-damped spring approximation for natural word animations.
 * Returns 0-1 with smooth deceleration.
 */
function springEase(progress: number, bounciness: number = 1.0): number {
  const w = 5.0 * bounciness;
  const t = Math.max(0, Math.min(progress, 1));
  return 1 - (1 + t * w) * Math.exp(-t * w);
}

// ─── Word Scale Animations ───────────────────────────────────────────────────

/**
 * Word scale animation — spring physics for natural pop.
 */
export function getWordBounceScale(
  wordProgress: number,
  isActive: boolean,
  rawStyle: SubtitleStyle,
): number {
  if (!isActive) return 1;
  const style = normalize(rawStyle);

  const sprung = springEase(wordProgress, 1.2);

  switch (style) {
    case 'bounce_pop':
      // Overshoot bounce: starts small, pops past 1.0, settles back
      return interpolate(sprung, [0, 1], [0.85, 1.0], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      }) + (wordProgress < 0.4 ? Math.sin(wordProgress * Math.PI * 2.5) * 0.08 : 0);
    case 'boxed_yellow':
      // Subtle scale for active word
      return interpolate(sprung, [0, 1], [0.95, 1.0], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      });
    case 'cinematic_lower':
      return interpolate(sprung, [0, 1], [0.92, 1.0], {
        extrapolateRight: 'clamp',
        extrapolateLeft: 'clamp',
      }) + (wordProgress < 0.3 ? Math.sin(wordProgress * Math.PI * 3) * 0.05 : 0);
    case 'karaoke_bold':
      // Karaoke doesn't scale — it fills color instead
      return 1.0;
    case 'clean_white':
      return 1.0;
    default:
      return 1.0;
  }
}

// ─── Word Color Animations ───────────────────────────────────────────────────

/**
 * Get the color for a word based on its state and the caption style.
 */
export function getWordColor(
  isActive: boolean,
  isEmphasis: boolean,
  wordProgress: number,
  rawStyle: SubtitleStyle,
  accentColor: string,
): string {
  const style = normalize(rawStyle);

  if (isEmphasis && style !== 'karaoke_bold') {
    return accentColor;
  }

  switch (style) {
    case 'clean_white':
      // Gold highlight on active word, white otherwise
      return isActive ? '#FFD700' : 'rgba(255, 255, 255, 0.65)';
    case 'karaoke_bold':
      // Sweep accent color from left to right as word progresses
      if (isActive) return accentColor;
      return wordProgress >= 1 ? accentColor : 'rgba(255, 255, 255, 0.35)';
    case 'boxed_yellow':
      // Active word gets dark text (on yellow bg), inactive gets white
      return isActive ? '#000000' : '#FFFFFF';
    case 'bounce_pop':
      return isActive ? '#FFFFFF' : 'rgba(255, 255, 255, 0.45)';
    case 'cinematic_lower':
      return isActive ? '#FFFFFF' : 'rgba(224, 224, 224, 0.7)';
    default:
      return '#FFFFFF';
  }
}

// ─── Word Opacity ────────────────────────────────────────────────────────────

/**
 * Get the opacity for a word based on its progress and style.
 */
export function getWordOpacity(
  wordProgress: number,
  isActive: boolean,
  rawStyle: SubtitleStyle,
): number {
  const style = normalize(rawStyle);

  switch (style) {
    case 'clean_white':
      return wordProgress > 0 ? 1 : 0.65;
    case 'karaoke_bold':
      return wordProgress > 0 ? 1 : 0.55;
    case 'boxed_yellow':
      return wordProgress > 0 ? 1 : 0.85;
    case 'bounce_pop':
      return wordProgress > 0 ? 1 : 0.35;
    case 'cinematic_lower':
      return wordProgress > 0 ? 1 : 0.6;
    default:
      return 1;
  }
}

// ─── Font Size by Style ──────────────────────────────────────────────────────

/**
 * Get base font size for normal and emphasis words by style.
 */
export function getFontSizes(rawStyle: SubtitleStyle): {
  normal: number;
  emphasis: number;
} {
  const style = normalize(rawStyle);

  switch (style) {
    case 'clean_white':
      return { normal: 42, emphasis: 48 };
    case 'karaoke_bold':
      return { normal: 52, emphasis: 60 };
    case 'boxed_yellow':
      return { normal: 46, emphasis: 54 };
    case 'bounce_pop':
      return { normal: 48, emphasis: 58 };
    case 'cinematic_lower':
      return { normal: 36, emphasis: 42 };
    default:
      return { normal: 48, emphasis: 58 };
  }
}

// ─── Font Weight by State ────────────────────────────────────────────────────

/**
 * Get font weight for a word based on its active/emphasis state.
 */
export function getWordFontWeight(
  isActive: boolean,
  isEmphasis: boolean,
): number {
  if (isEmphasis) return 900;
  if (isActive) return 800;
  return 700;
}

// ─── Caption Positioning ─────────────────────────────────────────────────────

/**
 * Get vertical positioning for the caption container by style.
 * Returns CSS-compatible values for AbsoluteFill positioning.
 */
export function getCaptionPosition(rawStyle: SubtitleStyle): {
  justifyContent: string;
  paddingBottom: number;
  paddingTop: number;
} {
  const style = normalize(rawStyle);

  switch (style) {
    case 'clean_white':
      return { justifyContent: 'flex-end', paddingBottom: 180, paddingTop: 0 };
    case 'karaoke_bold':
      return { justifyContent: 'center', paddingBottom: 0, paddingTop: 0 };
    case 'boxed_yellow':
      return { justifyContent: 'flex-end', paddingBottom: 200, paddingTop: 0 };
    case 'bounce_pop':
      return { justifyContent: 'flex-end', paddingBottom: 220, paddingTop: 0 };
    case 'cinematic_lower':
      return { justifyContent: 'flex-end', paddingBottom: 120, paddingTop: 0 };
    default:
      return { justifyContent: 'flex-end', paddingBottom: 200, paddingTop: 0 };
  }
}

// ─── Text Shadow by Style ───────────────────────────────────────────────────

/**
 * Get text shadow CSS for each subtitle style.
 * Combines outline stroke + glow for readability over any background.
 */
export function getTextShadow(rawStyle: SubtitleStyle, isActive: boolean): string {
  const style = normalize(rawStyle);

  switch (style) {
    case 'clean_white': {
      // Soft drop shadow — no harsh outline
      return isActive
        ? '0 2px 8px rgba(0,0,0,0.8), 0 0 20px rgba(0,0,0,0.4)'
        : '0 2px 6px rgba(0,0,0,0.6), 0 0 12px rgba(0,0,0,0.3)';
    }
    case 'karaoke_bold': {
      // Strong outline for bold readability
      const sz = 3;
      const outline = [
        `${sz}px ${sz}px 0 rgba(0,0,0,0.95)`,
        `${-sz}px ${sz}px 0 rgba(0,0,0,0.95)`,
        `${sz}px ${-sz}px 0 rgba(0,0,0,0.95)`,
        `${-sz}px ${-sz}px 0 rgba(0,0,0,0.95)`,
        `0 ${sz}px 0 rgba(0,0,0,0.95)`,
        `${sz}px 0 0 rgba(0,0,0,0.95)`,
        `0 ${-sz}px 0 rgba(0,0,0,0.95)`,
        `${-sz}px 0 0 rgba(0,0,0,0.95)`,
      ].join(', ');
      return outline;
    }
    case 'boxed_yellow': {
      // Active word has yellow box — shadow only on inactive
      if (isActive) return 'none';
      const sz = 2;
      const outline = [
        `${sz}px ${sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px ${sz}px 0 rgba(0,0,0,0.9)`,
        `${sz}px ${-sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px ${-sz}px 0 rgba(0,0,0,0.9)`,
        `0 ${sz}px 0 rgba(0,0,0,0.9)`,
        `${sz}px 0 0 rgba(0,0,0,0.9)`,
        `0 ${-sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px 0 0 rgba(0,0,0,0.9)`,
      ].join(', ');
      return `${outline}, 0 0 12px rgba(0,0,0,0.4)`;
    }
    case 'bounce_pop': {
      const sz = 2;
      const outline = [
        `${sz}px ${sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px ${sz}px 0 rgba(0,0,0,0.9)`,
        `${sz}px ${-sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px ${-sz}px 0 rgba(0,0,0,0.9)`,
        `0 ${sz}px 0 rgba(0,0,0,0.9)`,
        `${sz}px 0 0 rgba(0,0,0,0.9)`,
        `0 ${-sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px 0 0 rgba(0,0,0,0.9)`,
      ].join(', ');
      const glow = isActive
        ? '0 0 20px rgba(0,0,0,0.6), 0 4px 12px rgba(0,0,0,0.5)'
        : '0 0 12px rgba(0,0,0,0.4), 0 2px 8px rgba(0,0,0,0.3)';
      return `${outline}, ${glow}`;
    }
    case 'cinematic_lower': {
      // Subtle shadow — the backdrop provides readability
      return isActive
        ? '0 1px 4px rgba(0,0,0,0.5)'
        : '0 1px 3px rgba(0,0,0,0.4)';
    }
    default: {
      const sz = 2;
      const outline = [
        `${sz}px ${sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px ${sz}px 0 rgba(0,0,0,0.9)`,
        `${sz}px ${-sz}px 0 rgba(0,0,0,0.9)`,
        `${-sz}px ${-sz}px 0 rgba(0,0,0,0.9)`,
      ].join(', ');
      return `${outline}, 0 0 12px rgba(0,0,0,0.4)`;
    }
  }
}

// ─── Word Background (boxed_yellow) ─────────────────────────────────────────

/**
 * Get background style for a word. Only boxed_yellow has visible backgrounds.
 */
export function getWordBackground(
  isActive: boolean,
  rawStyle: SubtitleStyle,
): { background: string; padding: string; borderRadius: string } | null {
  const style = normalize(rawStyle);

  if (style === 'boxed_yellow' && isActive) {
    return {
      background: '#FFD700',
      padding: '2px 8px',
      borderRadius: '6px',
    };
  }
  if (style === 'boxed_yellow' && !isActive) {
    return {
      background: 'transparent',
      padding: '2px 8px',
      borderRadius: '6px',
    };
  }
  return null;
}

// ─── Cinematic Backdrop ─────────────────────────────────────────────────────

/**
 * Get backdrop style for cinematic_lower (frosted glass lower-third bar).
 */
export function getCinematicBackdrop(rawStyle: SubtitleStyle): Record<string, any> | null {
  const style = normalize(rawStyle);
  if (style !== 'cinematic_lower') return null;

  return {
    background: 'linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.7) 40%, rgba(0,0,0,0.85) 100%)',
    paddingTop: 50,
    paddingBottom: 90,
    paddingLeft: 60,
    paddingRight: 60,
  };
}

// ─── Chunk Entry Animation ───────────────────────────────────────────────────

/**
 * Compute entry animation values for an entire caption chunk.
 * Uses spring physics for natural slide-up and fade-in.
 */
export function getChunkEntryAnimation(
  frame: number,
  fps: number,
  chunkStartTime: number,
  currentTime: number,
  rawStyle: SubtitleStyle,
): { opacity: number; translateY: number; scale: number } {
  const style = normalize(rawStyle);
  const timeSinceChunkStart = currentTime - chunkStartTime;
  const framesSinceStart = Math.round(timeSinceChunkStart * fps);

  if (framesSinceStart < 0) {
    return { opacity: 0, translateY: 20, scale: 0.95 };
  }

  // 8 frames entry (~0.27s at 30fps) with spring easing
  const entryProgress = Math.min(framesSinceStart / 8, 1);
  const sprung = springEase(entryProgress, 0.9);

  switch (style) {
    case 'clean_white':
      return {
        opacity: interpolate(sprung, [0, 1], [0, 1]),
        translateY: interpolate(sprung, [0, 1], [10, 0], {
          extrapolateRight: 'clamp',
        }),
        scale: 1.0,
      };
    case 'karaoke_bold':
      return {
        opacity: interpolate(sprung, [0, 1], [0, 1]),
        translateY: 0,
        scale: 1.0,
      };
    case 'boxed_yellow':
      return {
        opacity: interpolate(sprung, [0, 1], [0, 1]),
        translateY: interpolate(sprung, [0, 1], [12, 0], {
          extrapolateRight: 'clamp',
        }),
        scale: 1.0,
      };
    case 'bounce_pop':
      return {
        opacity: interpolate(sprung, [0, 1], [0, 1]),
        translateY: interpolate(sprung, [0, 1], [18, 0], {
          extrapolateRight: 'clamp',
        }),
        scale: interpolate(sprung, [0, 1], [0.9, 1.0], {
          extrapolateRight: 'clamp',
        }),
      };
    case 'cinematic_lower':
      return {
        opacity: interpolate(sprung, [0, 1], [0, 1]),
        translateY: interpolate(sprung, [0, 1], [8, 0], {
          extrapolateRight: 'clamp',
        }),
        scale: 1.0,
      };
    default:
      return { opacity: 1, translateY: 0, scale: 1.0 };
  }
}

// ─── Words Per Chunk ─────────────────────────────────────────────────────────

/**
 * Get the number of words per chunk for a given style.
 */
export function getWordsPerChunk(rawStyle: SubtitleStyle): number {
  const style = normalize(rawStyle);
  switch (style) {
    case 'karaoke_bold': return 3;
    case 'cinematic_lower': return 5;
    default: return 4;
  }
}
