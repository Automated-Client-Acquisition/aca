import { useState, useEffect, useRef } from "react";
import * as Babel from "@babel/standalone";
import * as remotion from "remotion";
import * as transitions from "@remotion/transitions";
import * as transitionsFade from "@remotion/transitions/fade";
import * as transitionsSlide from "@remotion/transitions/slide";
import * as transitionsFlip from "@remotion/transitions/flip";
import * as transitionsWipe from "@remotion/transitions/wipe";
import * as gif from "@remotion/gif";
import * as lottie from "@remotion/lottie";
import * as preload from "@remotion/preload";
import * as mediaUtils from "@remotion/media-utils";
import * as noise from "@remotion/noise";
import * as paths from "@remotion/paths";
import * as shapes from "@remotion/shapes";
import * as animationUtils from "@remotion/animation-utils";
import * as layoutUtils from "@remotion/layout-utils";
import * as motionBlur from "@remotion/motion-blur";
// @remotion/three removed - crashes with React 18 due to reconciler incompatibility
// import * as three from "@remotion/three";
import React from "react";

export interface DynamicCompositionResult {
  component: React.ComponentType<Record<string, unknown>> | null;
  durationInFrames: number;
  fps: number;
  width: number;
  height: number;
  error: string | null;
  isCompiling: boolean;
}

const DEFAULT_META = { durationInFrames: 150, fps: 30, width: 1080, height: 1920 };

// Parse metadata comments the AI can put at the top:
// // @duration 5s  or  // @duration 150frames
// // @fps 30
// // @width 1080  // @height 1920  // @aspect portrait|landscape|square
function parseMetaFromCode(code: string): Partial<typeof DEFAULT_META> {
  const meta: Partial<typeof DEFAULT_META> = {};
  const lines = code.split("\n").slice(0, 20);

  for (const line of lines) {
    const trimmed = line.trim();
    const durationMatch = trimmed.match(/\/\/\s*@duration\s+(\d+(?:\.\d+)?)(s|frames?)?/i);
    if (durationMatch) {
      const val = parseFloat(durationMatch[1]);
      const unit = durationMatch[2]?.toLowerCase();
      const fps = meta.fps ?? DEFAULT_META.fps;
      meta.durationInFrames = unit === "s" || !unit ? Math.round(val * fps) : Math.round(val);
    }
    const fpsMatch = trimmed.match(/\/\/\s*@fps\s+(\d+)/i);
    if (fpsMatch) meta.fps = parseInt(fpsMatch[1]);
    const widthMatch = trimmed.match(/\/\/\s*@width\s+(\d+)/i);
    if (widthMatch) meta.width = parseInt(widthMatch[1]);
    const heightMatch = trimmed.match(/\/\/\s*@height\s+(\d+)/i);
    if (heightMatch) meta.height = parseInt(heightMatch[1]);
    const aspectMatch = trimmed.match(/\/\/\s*@aspect\s+(portrait|landscape|square)/i);
    if (aspectMatch) {
      const aspect = aspectMatch[1].toLowerCase();
      if (aspect === "portrait") { meta.width = 1080; meta.height = 1920; }
      else if (aspect === "landscape") { meta.width = 1920; meta.height = 1080; }
      else if (aspect === "square") { meta.width = 1080; meta.height = 1080; }
    }
  }

  return meta;
}

export function useDynamicComposition(code: string): DynamicCompositionResult {
  const [result, setResult] = useState<DynamicCompositionResult>({
    component: null,
    ...DEFAULT_META,
    error: null,
    isCompiling: false,
  });

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!code.trim()) {
      setResult((prev) => ({ ...prev, component: null, error: null, isCompiling: false }));
      return;
    }

    setResult((prev) => ({ ...prev, isCompiling: true, error: null }));

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        // Parse metadata from comments
        const parsedMeta = parseMetaFromCode(code);
        const meta = { ...DEFAULT_META, ...parsedMeta };

        // Strip import/export statements — we inject deps via closure
        const stripped = code
          .replace(/^import\s+.*?from\s+['"][^'"]+['"];?\s*$/gm, "")
          .replace(/^export\s+default\s+/gm, "const __defaultExport__ = ")
          .replace(/^export\s+\{[^}]*\};?\s*$/gm, "")
          .replace(/^export\s+(const|function|class|type|interface)\s+/gm, "$1 ");

        // Transpile with Babel (JSX + TypeScript)
        const transpiled = Babel.transform(stripped, {
          presets: [
            ["typescript", { allExtensions: true, isTSX: true }],
            ["react", { runtime: "classic" }],
          ],
          filename: "composition.tsx",
        }).code;

        if (!transpiled) throw new Error("Babel produced no output");

        // Build module factory — inject React and all Remotion deps
        // eslint-disable-next-line no-new-func
        const factory = new Function(
          "React",
          "remotion",
          "transitions",
          "transitionsFade",
          "transitionsSlide",
          "transitionsFlip",
          "transitionsWipe",
          "gif",
          "lottie",
          "preload",
          "mediaUtils",
          "noise",
          "paths",
          "shapes",
          "animationUtils",
          "layoutUtils",
          "motionBlur",
          "three_stub",
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

          // ── Three.js (stub - not available in React 18) ────────────────
          const { ThreeCanvas, useVideoTexture } = three_stub;

          ${transpiled}

          return typeof __defaultExport__ !== 'undefined' ? __defaultExport__ : null;
          `
        );

        const component = factory(
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
          { ThreeCanvas: () => null, useVideoTexture: () => null }
        );

        if (!component) throw new Error("No default export found in composition");

        setResult({
          component,
          durationInFrames: meta.durationInFrames,
          fps: meta.fps,
          width: meta.width,
          height: meta.height,
          error: null,
          isCompiling: false,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        setResult((prev) => ({
          ...prev,
          component: null,
          error: message,
          isCompiling: false,
        }));
      }
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [code]);

  return result;
}
