import React, { useMemo } from 'react';
import {
  AbsoluteFill,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion';
import { createTikTokStyleCaptions } from '@remotion/captions';
import type { Caption, TikTokPage } from '@remotion/captions';
import type { WordTimestamp, CaptionStyleId, CaptionPreset, BrandConfig } from '../../types.js';
import { CAPTION_PRESETS } from '../../types.js';

interface Props {
  words: WordTimestamp[];
  style: Exclude<CaptionStyleId, 'none'>;
  brand?: BrandConfig;
  fps: number;
}

/** Convert our WordTimestamp[] to Remotion Caption[] */
function toCaptions(words: WordTimestamp[]): Caption[] {
  return words.map((w) => ({
    text: ' ' + w.word,
    startMs: w.start * 1000,
    endMs: w.end * 1000,
    timestampMs: w.start * 1000,
    confidence: 1,
  }));
}

/** Map wordsPerChunk to a combineTokensWithinMilliseconds value */
function chunkToMs(wordsPerChunk: number): number {
  return wordsPerChunk * 300;
}

export const CaptionLayer: React.FC<Props> = ({ words, style, brand, fps }) => {
  const { fps: configFps } = useVideoConfig();
  const usedFps = configFps || fps;

  const preset = CAPTION_PRESETS[style];

  const { pages } = useMemo(() => {
    const captions = toCaptions(words);
    return createTikTokStyleCaptions({
      captions,
      combineTokensWithinMilliseconds: chunkToMs(preset.wordsPerChunk),
    });
  }, [words, preset.wordsPerChunk]);

  const positionStyle = getPositionStyle(preset.position);
  const accentColor = brand?.accent_color || preset.activeColor;

  return (
    <AbsoluteFill style={{ pointerEvents: 'none' }}>
      {pages.map((page, index) => {
        const nextPage = pages[index + 1] ?? null;
        const startFrame = (page.startMs / 1000) * usedFps;
        const endFrame = Math.min(
          nextPage ? (nextPage.startMs / 1000) * usedFps : Infinity,
          startFrame + (chunkToMs(preset.wordsPerChunk) / 1000) * usedFps,
        );
        const durationInFrames = Math.max(1, Math.round(endFrame - startFrame));

        return (
          <Sequence
            key={index}
            from={Math.round(startFrame)}
            durationInFrames={durationInFrames}
          >
            <CaptionPage
              page={page}
              preset={preset}
              accentColor={accentColor}
              positionStyle={positionStyle}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};

interface CaptionPageProps {
  page: TikTokPage;
  preset: CaptionPreset;
  accentColor: string;
  positionStyle: React.CSSProperties;
}

const CaptionPage: React.FC<CaptionPageProps> = ({
  page,
  preset,
  accentColor,
  positionStyle,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const currentTimeMs = (frame / fps) * 1000;
  const absoluteTimeMs = page.startMs + currentTimeMs;

  return (
    <AbsoluteFill style={{ ...positionStyle, alignItems: 'center' }}>
      <div
        style={{
          fontSize: preset.fontSize,
          fontWeight: preset.fontWeight,
          fontFamily: preset.fontFamily,
          textShadow: preset.textShadow,
          lineHeight: 1.3,
          textAlign: 'center',
          maxWidth: '80%',
          overflowWrap: 'break-word',
          wordBreak: 'break-word',
        }}
      >
        {page.tokens.map((token) => {
          const isActive =
            token.fromMs <= absoluteTimeMs && token.toMs > absoluteTimeMs;
          const isPast = absoluteTimeMs > token.toMs;

          const text = preset.uppercase ? token.text.toUpperCase() : token.text;

          let color = preset.color;

          switch (preset.animation) {
            case 'bounce':
            case 'scale':
              color = isActive
                ? accentColor
                : isPast
                  ? preset.color
                  : 'rgba(255,255,255,0.3)';
              break;
            case 'fill':
              color = isPast || isActive ? preset.activeColor : preset.color;
              break;
            case 'box':
              color = isActive ? accentColor : preset.color;
              break;
            case 'none':
            default:
              color = isActive ? accentColor : preset.color;
              break;
          }

          return (
            <span
              key={token.fromMs}
              style={{ color }}
            >
              {text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

function getPositionStyle(position: 'bottom' | 'center' | 'top'): React.CSSProperties {
  switch (position) {
    case 'top':
      return { justifyContent: 'flex-start', paddingTop: 80 };
    case 'center':
      return { justifyContent: 'center' };
    case 'bottom':
    default:
      return { justifyContent: 'flex-end', paddingBottom: 100 };
  }
}
