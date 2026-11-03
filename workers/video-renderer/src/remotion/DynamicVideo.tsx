/**
 * DynamicVideo — Renders arbitrary remotion_code compositions server-side.
 *
 * Mirrors the frontend's useDynamicComposition hook: strips imports/exports,
 * transpiles JSX/TS via Babel, then evals with all Remotion packages injected.
 */
import React, { useMemo } from 'react';
import { AbsoluteFill } from 'remotion';
import * as Babel from '@babel/standalone';
import * as remotion from 'remotion';
import * as transitions from '@remotion/transitions';
import * as transitionsFade from '@remotion/transitions/fade';
import * as transitionsSlide from '@remotion/transitions/slide';
import * as transitionsFlip from '@remotion/transitions/flip';
import * as transitionsWipe from '@remotion/transitions/wipe';
import * as gif from '@remotion/gif';
import * as lottie from '@remotion/lottie';
import * as preload from '@remotion/preload';
import * as mediaUtils from '@remotion/media-utils';
import * as noise from '@remotion/noise';
import * as paths from '@remotion/paths';
import * as shapes from '@remotion/shapes';
import * as animationUtils from '@remotion/animation-utils';
import * as layoutUtils from '@remotion/layout-utils';
import * as motionBlur from '@remotion/motion-blur';

export interface DynamicVideoProps {
  remotion_code: string;
  [key: string]: unknown;
}

function compileCode(code: string): React.ComponentType | null {
  // Strip import/export statements — deps injected via closure
  const stripped = code
    .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+default\s+/gm, 'const __defaultExport__ = ')
    .replace(/^export\s+\{[^}]*\};?\s*$/gm, '')
    .replace(/^export\s+(const|function|class|type|interface)\s+/gm, '$1 ');

  // Transpile JSX + TypeScript
  const transpiled = Babel.transform(stripped, {
    presets: [
      ['typescript', { allExtensions: true, isTSX: true }],
      ['react', { runtime: 'classic' }],
    ],
    filename: 'composition.tsx',
  }).code;

  if (!transpiled) throw new Error('Babel produced no output');

  // Build module factory with all Remotion deps injected
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'React',
    'remotion',
    'transitions',
    'transitionsFade',
    'transitionsSlide',
    'transitionsFlip',
    'transitionsWipe',
    'gif',
    'lottie',
    'preload',
    'mediaUtils',
    'noise',
    'paths',
    'shapes',
    'animationUtils',
    'layoutUtils',
    'motionBlur',
    'three_stub',
    `
    // ── Core Remotion ──────────────────────────────────────────────
    const {
      AbsoluteFill, useCurrentFrame, useVideoConfig, spring, interpolate,
      Sequence, Audio, Video, Img, Loop, freeze, random, staticFile,
      continueRender, delayRender, cancelRender, OffthreadVideo,
      prefetch, getStaticFiles, watchStaticFile, Series, Easing,
      interpolateColors, measureSpring, noise2D, noise3D, noise4D,
    } = remotion;

    // ── Transitions ────────────────────────────────────────────────
    const { TransitionSeries, linearTiming, springTiming } = transitions;
    const { fade } = transitionsFade;
    const { slide } = transitionsSlide;
    const { flip } = transitionsFlip;
    const { wipe } = transitionsWipe;

    // ── Media ──────────────────────────────────────────────────────
    const { Gif } = gif;
    const { Lottie, LottieAnimationData } = lottie;
    const { prefetchVideo, prefetchAudio, prefetchImage, resolveRedirect } = preload;
    const { getAudioData, getVideoMetadata, getWaveformPortion, useAudioData, visualizeAudio } = mediaUtils;

    // ── Noise (Perlin/Simplex) ─────────────────────────────────────
    const { generateNoiseFrame, NoiseCanvas } = noise;

    // ── SVG Paths ──────────────────────────────────────────────────
    const {
      evolvePath, getLength, getPointAtLength, getSubpaths, getTangentAtLength,
      interpolatePath, parsePath, resetPath, reversePath, scalePath,
      translatePath, warpPath, getBoundingBox, extendViewBox,
    } = paths;

    // ── Shapes ─────────────────────────────────────────────────────
    const {
      Circle, Ellipse, Pie, Polygon, Rect, Star, Triangle,
      makeCircle, makeEllipse, makePie, makePolygon, makeRect, makeStar, makeTriangle,
    } = shapes;

    // ── Animation Utils ────────────────────────────────────────────
    const { makeTransform, rotate, scale, translate, skew, matrix } =
      animationUtils.makeTransform ? animationUtils : { makeTransform: (...args) => args.map(String).join(" "), rotate: (d) => "rotate(" + d + "deg)", scale: (s) => "scale(" + s + ")", translate: (x,y) => "translate(" + x + "px," + y + "px)", skew: (x,y) => "skew(" + x + "deg," + (y||0) + "deg)", matrix: (...a) => "matrix(" + a.join(",") + ")" };

    // ── Layout Utils ───────────────────────────────────────────────
    const { measureText, fitText } = layoutUtils;

    // ── Motion Blur ────────────────────────────────────────────────
    const { CameraMotionBlur, Trail } = motionBlur;

    // ── Three.js (stub) ────────────────────────────────────────────
    const { ThreeCanvas, useVideoTexture } = three_stub;

    ${transpiled}

    return typeof __defaultExport__ !== 'undefined' ? __defaultExport__ : null;
    `
  );

  return factory(
    React,
    remotion,
    transitions,
    transitionsFade,
    transitionsSlide,
    transitionsFlip,
    transitionsWipe,
    gif,
    lottie,
    preload,
    mediaUtils,
    noise,
    paths,
    shapes,
    animationUtils,
    layoutUtils,
    motionBlur,
    { ThreeCanvas: () => null, useVideoTexture: () => null },
  );
}

export const DynamicVideo: React.FC<DynamicVideoProps> = ({ remotion_code }) => {
  const Component = useMemo(() => {
    try {
      return compileCode(remotion_code);
    } catch (err) {
      console.error('[DynamicVideo] Compilation error:', err);
      return null;
    }
  }, [remotion_code]);

  if (!Component) {
    return (
      <AbsoluteFill style={{ backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' }}>
        <div style={{ color: '#ef4444', fontSize: 32, fontFamily: 'monospace', textAlign: 'center', padding: 40 }}>
          Failed to compile composition
        </div>
      </AbsoluteFill>
    );
  }

  return <Component />;
};
