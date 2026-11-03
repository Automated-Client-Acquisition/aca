import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
} from "remotion";
import { TransitionSeries, linearTiming } from "@remotion/transitions";
import { fade } from "@remotion/transitions/fade";
import { slide } from "@remotion/transitions/slide";

import type { z } from "zod";
import type { aiNewsVideoSchema } from "./skill-compositions/schemas";

// ── Types ──────────────────────────────────────────────────────────────

export type AINewsVideoProps = z.infer<typeof aiNewsVideoSchema>;

// ── Data ───────────────────────────────────────────────────────────────

export const DEFAULT_NEWS_PROPS: AINewsVideoProps = {
  title: "AI NEWS",
  date: "March 22, 2026",
  newsItems: [
    {
      headline: "GPT-5.4 Thinking Launched",
      summary:
        "OpenAI's new flagship model combines reasoning, coding, and agentic workflows with up to 1M tokens of context. Reduces claim errors by 33%.",
      source: "OpenAI",
      icon: "\u{1F9E0}",
      accentColor: "#10b981",
    },
    {
      headline: "Gemini 3.1 Pro Dominates Benchmarks",
      summary:
        "Google's latest model leads 13 of 16 major benchmarks. Flash-Lite variant delivers 2.5x faster responses at $0.25/M tokens.",
      source: "Google DeepMind",
      icon: "\u{1F48E}",
      accentColor: "#6366f1",
    },
    {
      headline: "NVIDIA Nemotron 3 Super at GTC",
      summary:
        "120B parameter hybrid MoE model with only 12B active params. Tops SWE-Bench Verified at 60.47% for open-weight coding.",
      source: "NVIDIA",
      icon: "\u{1F680}",
      accentColor: "#76b900",
    },
    {
      headline: "LTX 2.3: Open-Source 4K Video AI",
      summary:
        "Lightricks releases 22B parameter model generating 4K video at 50 FPS with synchronized audio. Free for commercial use.",
      source: "Lightricks",
      icon: "\u{1F3AC}",
      accentColor: "#f43f5e",
    },
    {
      headline: "Apple Confirms Gemini-Powered Siri",
      summary:
        "Reimagined Siri running on Google's 1.2T parameter Gemini model via Private Cloud Compute. Samsung targets 800M AI devices.",
      source: "Apple / Samsung",
      icon: "\u{1F34E}",
      accentColor: "#a78bfa",
    },
  ],
};

// ── Constants ──────────────────────────────────────────────────────────

const SCENE_DURATION_SEC = 5;
const INTRO_DURATION_SEC = 3;
const OUTRO_DURATION_SEC = 3;
const TRANSITION_FRAMES = 12;

// ── Sub-components ─────────────────────────────────────────────────────

const GridBackground: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = interpolate(frame, [0, 30 * fps], [0, -200], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill>
      {/* Dark base */}
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(ellipse at 50% 20%, #1a1040 0%, #0a0a1a 50%, #050510 100%)",
        }}
      />
      {/* Animated grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(99,102,241,0.08) 1px, transparent 1px),
            linear-gradient(90deg, rgba(99,102,241,0.08) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          transform: `translateY(${drift % 60}px)`,
        }}
      />
      {/* Glow orb - top */}
      <div
        style={{
          position: "absolute",
          width: 700,
          height: 700,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(99,102,241,0.18) 0%, transparent 70%)",
          top: -200,
          left: "50%",
          transform: "translateX(-50%)",
          filter: "blur(60px)",
        }}
      />
      {/* Glow orb - bottom */}
      <div
        style={{
          position: "absolute",
          width: 500,
          height: 500,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(16,185,129,0.12) 0%, transparent 70%)",
          bottom: -100,
          left: "50%",
          transform: "translateX(-50%)",
          filter: "blur(50px)",
        }}
      />
    </AbsoluteFill>
  );
};

const IntroScene: React.FC<{ title: string; date: string }> = ({
  title,
  date,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleScale = spring({ frame, fps, config: { damping: 12, stiffness: 80 } });
  const titleOpacity = interpolate(titleScale, [0, 1], [0, 1]);

  const dateOpacity = interpolate(frame, [0.8 * fps, 1.5 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dateY = interpolate(frame, [0.8 * fps, 1.5 * fps], [30, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Scanning line effect (vertical sweep for portrait)
  const scanY = interpolate(frame, [0, 2 * fps], [-10, 110], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill>
      <GridBackground />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        {/* Scan line */}
        <div
          style={{
            position: "absolute",
            left: "10%",
            right: "10%",
            top: `${scanY}%`,
            height: 2,
            background:
              "linear-gradient(90deg, transparent, rgba(99,102,241,0.6), transparent)",
            filter: "blur(1px)",
          }}
        />

        {/* Title block */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 28,
            paddingLeft: 60,
            paddingRight: 60,
            opacity: titleOpacity,
            transform: `scale(${0.8 + titleScale * 0.2})`,
          }}
        >
          {/* Badge */}
          <div
            style={{
              padding: "10px 32px",
              borderRadius: 100,
              border: "1px solid rgba(99,102,241,0.4)",
              background: "rgba(99,102,241,0.1)",
              fontSize: 22,
              color: "#a5b4fc",
              fontFamily: "monospace",
              letterSpacing: 4,
            }}
          >
            WEEKLY ROUNDUP
          </div>

          {/* Main title */}
          <h1
            style={{
              fontSize: 128,
              fontWeight: 900,
              color: "white",
              fontFamily: "Arial Black, Arial, sans-serif",
              letterSpacing: -2,
              lineHeight: 1,
              textAlign: "center",
              textShadow: "0 0 80px rgba(99,102,241,0.4)",
              margin: 0,
            }}
          >
            {title}
          </h1>

          {/* Accent line */}
          <div
            style={{
              width: 120,
              height: 4,
              borderRadius: 100,
              background:
                "linear-gradient(90deg, rgba(99,102,241,0.8), rgba(16,185,129,0.8))",
            }}
          />

          {/* Date */}
          <div
            style={{
              opacity: dateOpacity,
              transform: `translateY(${dateY}px)`,
              fontSize: 30,
              color: "rgba(255,255,255,0.5)",
              fontFamily: "monospace",
              letterSpacing: 2,
              textAlign: "center",
            }}
          >
            {date}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const NewsScene: React.FC<{
  item: NewsItem;
  index: number;
}> = ({ item, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Number animation
  const numberProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const numberOpacity = interpolate(numberProgress, [0, 1], [0, 1]);
  const numberScale = 0.7 + numberProgress * 0.3;

  // Accent line animation
  const lineWidth = interpolate(frame, [0, 0.4 * fps], [0, 100], {
    extrapolateRight: "clamp",
  });

  // Headline animation
  const headlineProgress = spring({
    frame,
    fps,
    delay: 6,
    config: { damping: 15, stiffness: 120 },
  });
  const headlineOpacity = interpolate(headlineProgress, [0, 1], [0, 1]);
  const headlineY = interpolate(headlineProgress, [0, 1], [40, 0]);

  // Summary animation (delayed)
  const summaryProgress = spring({
    frame,
    fps,
    delay: 12,
    config: { damping: 200 },
  });
  const summaryOpacity = interpolate(summaryProgress, [0, 1], [0, 1]);
  const summaryY = interpolate(summaryProgress, [0, 1], [24, 0]);

  // Source badge animation
  const badgeProgress = spring({
    frame,
    fps,
    delay: 18,
    config: { damping: 200 },
  });

  const numberStr = `0${index + 1}`;

  return (
    <AbsoluteFill>
      <GridBackground />
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "80px 72px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 36,
            width: "100%",
          }}
        >
          {/* Large number */}
          <div
            style={{
              fontSize: 160,
              fontWeight: 900,
              color: item.accentColor,
              fontFamily: "Arial Black, Arial, sans-serif",
              lineHeight: 1,
              opacity: numberOpacity,
              transform: `scale(${numberScale})`,
              textShadow: `0 0 60px ${item.accentColor}50`,
            }}
          >
            {numberStr}
          </div>

          {/* Horizontal accent line */}
          <div
            style={{
              width: `${lineWidth}%`,
              height: 3,
              background: `linear-gradient(90deg, transparent, ${item.accentColor}, transparent)`,
              borderRadius: 100,
            }}
          />

          {/* Icon + headline */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              opacity: headlineOpacity,
              transform: `translateY(${headlineY}px)`,
              width: "100%",
            }}
          >
            <span style={{ fontSize: 80 }}>{item.icon}</span>
            <h2
              style={{
                fontSize: 64,
                fontWeight: 800,
                color: "white",
                fontFamily: "Arial, sans-serif",
                lineHeight: 1.2,
                margin: 0,
                textAlign: "center",
                // Clamp to 2 lines via overflow
                display: "-webkit-box",
                WebkitBoxOrient: "vertical" as const,
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {item.headline}
            </h2>
          </div>

          {/* Summary */}
          <p
            style={{
              fontSize: 34,
              color: "rgba(255,255,255,0.75)",
              fontFamily: "Arial, sans-serif",
              lineHeight: 1.55,
              margin: 0,
              textAlign: "center",
              opacity: summaryOpacity,
              transform: `translateY(${summaryY}px)`,
              // Clamp to 3 lines
              display: "-webkit-box",
              WebkitBoxOrient: "vertical" as const,
              WebkitLineClamp: 3,
              overflow: "hidden",
            }}
          >
            {item.summary}
          </p>

          {/* Source badge */}
          <div
            style={{
              opacity: interpolate(badgeProgress, [0, 1], [0, 1]),
              transform: `scale(${0.8 + badgeProgress * 0.2})`,
            }}
          >
            <span
              style={{
                display: "inline-block",
                padding: "10px 32px",
                borderRadius: 100,
                border: `1px solid ${item.accentColor}60`,
                background: `${item.accentColor}18`,
                fontSize: 24,
                color: item.accentColor,
                fontFamily: "monospace",
                letterSpacing: 2,
              }}
            >
              {item.source}
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const OutroScene: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  const subtitleOpacity = interpolate(frame, [0.5 * fps, 1.2 * fps], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Pulse effect on CTA
  const pulse = interpolate(
    frame % Math.round(1.5 * fps),
    [0, Math.round(0.75 * fps), Math.round(1.5 * fps)],
    [1, 1.04, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <GridBackground />
      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center" }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 40,
            paddingLeft: 60,
            paddingRight: 60,
            opacity: interpolate(titleProgress, [0, 1], [0, 1]),
            transform: `scale(${0.9 + titleProgress * 0.1})`,
          }}
        >
          <div
            style={{
              fontSize: 80,
              fontWeight: 900,
              color: "white",
              fontFamily: "Arial Black, Arial, sans-serif",
              textAlign: "center",
              lineHeight: 1.2,
            }}
          >
            That's a wrap!
          </div>

          {/* Accent line */}
          <div
            style={{
              width: 100,
              height: 4,
              borderRadius: 100,
              background:
                "linear-gradient(90deg, rgba(99,102,241,0.8), rgba(16,185,129,0.8))",
              opacity: subtitleOpacity,
            }}
          />

          <div
            style={{
              opacity: subtitleOpacity,
              transform: `scale(${pulse})`,
              padding: "20px 56px",
              borderRadius: 20,
              background:
                "linear-gradient(135deg, rgba(99,102,241,0.3), rgba(16,185,129,0.3))",
              border: "1px solid rgba(255,255,255,0.15)",
            }}
          >
            <span
              style={{
                fontSize: 34,
                color: "rgba(255,255,255,0.9)",
                fontFamily: "Arial, sans-serif",
                fontWeight: 600,
                textAlign: "center",
                display: "block",
              }}
            >
              Follow for weekly AI updates
            </span>
          </div>

          <div
            style={{
              opacity: subtitleOpacity,
              fontSize: 26,
              color: "rgba(255,255,255,0.4)",
              fontFamily: "monospace",
              letterSpacing: 2,
            }}
          >
            @sequence
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Main Composition ───────────────────────────────────────────────────

export const AINewsVideo: React.FC<AINewsVideoProps> = ({
  title,
  date,
  newsItems,
}) => {
  const { fps } = useVideoConfig();

  const introFrames = Math.round(INTRO_DURATION_SEC * fps);
  const sceneFrames = Math.round(SCENE_DURATION_SEC * fps);
  const outroFrames = Math.round(OUTRO_DURATION_SEC * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#050510" }}>
      <TransitionSeries>
        {/* Intro */}
        <TransitionSeries.Sequence
          durationInFrames={introFrames}
          premountFor={15}
        >
          <IntroScene title={title} date={date} />
        </TransitionSeries.Sequence>

        {/* News items */}
        {newsItems.map((item, i) => (
          <React.Fragment key={i}>
            <TransitionSeries.Transition
              presentation={i % 2 === 0 ? slide({ direction: "from-right" }) : fade()}
              timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
            />
            <TransitionSeries.Sequence
              durationInFrames={sceneFrames}
              premountFor={15}
            >
              <NewsScene item={item} index={i} />
            </TransitionSeries.Sequence>
          </React.Fragment>
        ))}

        {/* Outro */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={outroFrames}
          premountFor={15}
        >
          <OutroScene />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
