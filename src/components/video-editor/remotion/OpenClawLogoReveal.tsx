import React from "react";
import {
  AbsoluteFill,
  Img,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
  Sequence,
} from "remotion";
import type { z } from "zod";
import type { openclawLogoRevealSchema } from "./skill-compositions/schemas";

// ── Types ────────────────────────────────────────────────────────────────

export type OpenClawLogoRevealProps = z.infer<typeof openclawLogoRevealSchema>;

// ── Background ───────────────────────────────────────────────────────────

const Background: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const opacity = interpolate(frame, [0, 0.4 * fps], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Subtle gradient shift over time
  const gradAngle = interpolate(frame, [0, 90 * fps], [135, 165], {
    extrapolateRight: "clamp",
  });

  return (
    <AbsoluteFill
      style={{
        opacity,
        background: `linear-gradient(${gradAngle}deg, #e8eaf0 0%, #f0f2f7 50%, #dde1ea 100%)`,
      }}
    />
  );
};

// ── Particle dots ────────────────────────────────────────────────────────

const ParticleDots: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const opacity = interpolate(frame, [1 * fps, 2 * fps], [0, 0.18], {
    extrapolateRight: "clamp",
  });

  const dots = [
    { x: 0.12, y: 0.18, size: 8, delay: 0 },
    { x: 0.88, y: 0.22, size: 6, delay: 4 },
    { x: 0.08, y: 0.72, size: 10, delay: 8 },
    { x: 0.92, y: 0.78, size: 7, delay: 12 },
    { x: 0.5, y: 0.08, size: 5, delay: 6 },
    { x: 0.5, y: 0.92, size: 9, delay: 10 },
    { x: 0.25, y: 0.45, size: 5, delay: 14 },
    { x: 0.75, y: 0.55, size: 6, delay: 3 },
  ];

  return (
    <>
      {dots.map((dot, i) => {
        const floatY = interpolate(
          (frame + dot.delay * 10) % Math.round(3 * fps),
          [0, Math.round(1.5 * fps), Math.round(3 * fps)],
          [0, -12, 0],
          { extrapolateRight: "clamp" }
        );
        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: dot.x * width - dot.size / 2,
              top: dot.y * height - dot.size / 2 + floatY,
              width: dot.size,
              height: dot.size,
              borderRadius: "50%",
              backgroundColor: "#0a66c2",
              opacity,
            }}
          />
        );
      })}
    </>
  );
};

// ── Mascot (the bug character) ───────────────────────────────────────────

const Mascot: React.FC<{ imageUrl: string }> = ({ imageUrl }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Drop-in spring
  const dropProgress = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 120, mass: 0.8 },
  });

  const mascotY = interpolate(dropProgress, [0, 1], [-200, 0]);
  const mascotOpacity = interpolate(dropProgress, [0, 0.1], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Idle float (starts after 1s)
  const floatOffset = interpolate(
    frame % Math.round(2.4 * fps),
    [0, Math.round(1.2 * fps), Math.round(2.4 * fps)],
    [0, -18, 0]
  );

  // Slight wobble
  const wobble = interpolate(
    frame % Math.round(3.6 * fps),
    [0, Math.round(0.9 * fps), Math.round(1.8 * fps), Math.round(2.7 * fps), Math.round(3.6 * fps)],
    [0, 2, 0, -2, 0]
  );

  const idleActive = frame > Math.round(1.2 * fps);
  const effectiveFloatY = idleActive ? floatOffset : 0;
  const effectiveWobble = idleActive ? wobble : 0;

  const mascotSize = Math.round(Math.min(width, height) * 0.22);
  const centerX = width / 2;
  const mascotTop = height * 0.1;

  return (
    <div
      style={{
        position: "absolute",
        left: centerX - mascotSize / 2,
        top: mascotTop + mascotY + effectiveFloatY,
        width: mascotSize,
        height: mascotSize,
        opacity: mascotOpacity,
        transform: `rotate(${effectiveWobble}deg)`,
      }}
    >
      {/* Clip to just the top portion of the source image — mascot occupies top ~38% */}
      <div
        style={{
          width: "100%",
          height: "100%",
          overflow: "hidden",
          borderRadius: "50%",
          position: "relative",
        }}
      >
        <Img
          src={imageUrl}
          style={{
            position: "absolute",
            width: `${(1 / 0.38) * 100}%`,
            top: 0,
            left: "50%",
            transform: "translateX(-50%)",
            objectFit: "cover",
            objectPosition: "top center",
          }}
        />
      </div>
    </div>
  );
};

// ── OpenClaw wordmark ────────────────────────────────────────────────────

const OpenClawText: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const scaleProgress = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 14, stiffness: 100, mass: 1 },
  });

  const scale = interpolate(scaleProgress, [0, 1], [0.6, 1]);
  const opacity = interpolate(scaleProgress, [0, 0.15], [0, 1], {
    extrapolateRight: "clamp",
  });

  const fontSize = Math.round(width * 0.11);
  const topPos = height * 0.42;

  return (
    <div
      style={{
        position: "absolute",
        width: "100%",
        top: topPos,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `scale(${scale})`,
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: 900,
          fontFamily: "Arial Black, Arial, sans-serif",
          color: "#111111",
          letterSpacing: -2,
          lineHeight: 1,
        }}
      >
        OpenClaw
      </span>
    </div>
  );
};

// ── "pour LinkedIn" row ──────────────────────────────────────────────────

const PourLinkedIn: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // "pour" slides from left
  const pourProgress = spring({
    frame,
    fps,
    delay: Math.round(0.9 * fps),
    config: { damping: 200 },
  });
  const pourX = interpolate(pourProgress, [0, 1], [-80, 0]);
  const pourOpacity = interpolate(pourProgress, [0, 1], [0, 1]);

  // LinkedIn badge slides from right
  const liProgress = spring({
    frame,
    fps,
    delay: Math.round(1.1 * fps),
    config: { damping: 18, stiffness: 130 },
  });
  const liX = interpolate(liProgress, [0, 1], [80, 0]);
  const liOpacity = interpolate(liProgress, [0, 1], [0, 1]);

  const topPos = height * 0.59;
  const fontSize = Math.round(width * 0.065);
  const badgeFontSize = Math.round(width * 0.062);

  return (
    <div
      style={{
        position: "absolute",
        width: "100%",
        top: topPos,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        gap: Math.round(width * 0.018),
      }}
    >
      {/* "pour" */}
      <span
        style={{
          fontSize,
          fontWeight: 500,
          fontFamily: "Arial, sans-serif",
          color: "#888888",
          opacity: pourOpacity,
          transform: `translateX(${pourX}px)`,
          display: "inline-block",
        }}
      >
        pour
      </span>

      {/* LinkedIn badge */}
      <div
        style={{
          opacity: liOpacity,
          transform: `translateX(${liX}px)`,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a66c2",
          borderRadius: 12,
          paddingLeft: Math.round(width * 0.022),
          paddingRight: Math.round(width * 0.022),
          paddingTop: Math.round(width * 0.008),
          paddingBottom: Math.round(width * 0.008),
        }}
      >
        <span
          style={{
            fontSize: badgeFontSize,
            fontWeight: 800,
            fontFamily: "Arial Black, Arial, sans-serif",
            color: "#ffffff",
            letterSpacing: -0.5,
          }}
        >
          LinkedIn
        </span>
      </div>
    </div>
  );
};

// ── Tagline ──────────────────────────────────────────────────────────────

const Tagline: React.FC<{ tagline: string }> = ({ tagline }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  const progress = spring({
    frame,
    fps,
    delay: Math.round(1.6 * fps),
    config: { damping: 200 },
  });

  const opacity = interpolate(progress, [0, 1], [0, 1]);
  const translateY = interpolate(progress, [0, 1], [24, 0]);

  const topPos = height * 0.77;
  const fontSize = Math.round(width * 0.038);

  return (
    <div
      style={{
        position: "absolute",
        width: "100%",
        top: topPos,
        display: "flex",
        justifyContent: "center",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <span
        style={{
          fontSize,
          fontWeight: 400,
          fontFamily: "Arial, sans-serif",
          color: "#555555",
          letterSpacing: 0,
        }}
      >
        {tagline}
      </span>
    </div>
  );
};

// ── Shine sweep ──────────────────────────────────────────────────────────

const ShineSweep: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();

  // Sweep once starting at 2s
  const delay = Math.round(2 * fps);
  const sweepDuration = Math.round(0.6 * fps);
  const progress = interpolate(frame, [delay, delay + sweepDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const x = interpolate(progress, [0, 1], [-width * 0.3, width * 1.3]);
  const opacity = interpolate(
    progress,
    [0, 0.1, 0.7, 1],
    [0, 0.35, 0.35, 0],
    { extrapolateRight: "clamp" }
  );

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: x,
        width: width * 0.25,
        height: height,
        background: "linear-gradient(105deg, transparent 20%, rgba(255,255,255,0.9) 50%, transparent 80%)",
        opacity,
        pointerEvents: "none",
        transform: "skewX(-15deg)",
      }}
    />
  );
};

// ── Main composition ─────────────────────────────────────────────────────

export const OpenClawLogoReveal: React.FC<OpenClawLogoRevealProps> = ({
  imageUrl,
  tagline = "L'IA qui développe votre entreprise.",
}) => {
  return (
    <AbsoluteFill style={{ backgroundColor: "#e8eaf0" }}>
      <Background />
      <ParticleDots />
      <Mascot imageUrl={imageUrl} />
      <OpenClawText />
      <PourLinkedIn />
      <Tagline tagline={tagline} />
      <ShineSweep />
    </AbsoluteFill>
  );
};
