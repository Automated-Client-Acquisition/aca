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
import { wipe } from "@remotion/transitions/wipe";

import type { z } from "zod";
import type { ripSaaSVideoSchema } from "./skill-compositions/schemas";

// ── Types ──────────────────────────────────────────────────────────────

export type RIPSaaSVideoProps = z.infer<typeof ripSaaSVideoSchema>;

// ── Default Props ──────────────────────────────────────────────────────

export const DEFAULT_RIP_SAAS_PROPS: RIPSaaSVideoProps = {
  hookLine1: "R.I.P SaaS.",
  hookLine2: "AI agents just made half your tech stack obsolete.",
  monthlyBefore: "$2,400",
  monthlyAfter: "$200",
  toolsReplaced: 11,
  agentsUsed: 4,
  agents: [
    {
      label: "CRM Agent",
      description: "Auto-updates itself",
      icon: "\u{1F4CA}",
      color: "#6366f1",
    },
    {
      label: "Outreach Agent",
      description: "Writes AND optimizes sequences",
      icon: "\u{1F4E7}",
      color: "#10b981",
    },
    {
      label: "Scoring Agent",
      description: "Real-time signals, not static rules",
      icon: "\u{1F3AF}",
      color: "#f59e0b",
    },
    {
      label: "Reporting Agent",
      description: "Just tells you what matters",
      icon: "\u{1F9E0}",
      color: "#ef4444",
    },
  ],
  insightLine1: "You don't need a dashboard.",
  insightLine2: "You need an outcome.",
  ctaHeadline: "Agents as a Service",
  ctaSubtext: "The founders who get this first will run circles around the rest.",
  ctaKeyword: "AGENTS",
  stats: [
    { value: "92%", label: "Cost Cut" },
    { value: "11", label: "Tools Killed" },
    { value: "4", label: "Agents" },
    { value: "0", label: "Dashboards" },
  ],
};

// ── Constants ──────────────────────────────────────────────────────────

const SCENE_DURATION_SEC = 5;
const HOOK_DURATION_SEC = 4;
const TRANSITION_FRAMES = 10;

// ── Shared Background ─────────────────────────────────────────────────

const DarkGrid: React.FC<{ accentColor?: string }> = ({
  accentColor = "#6366f1",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const drift = interpolate(frame, [0, 30 * fps], [0, -300], {
    extrapolateRight: "extend",
  });

  return (
    <AbsoluteFill>
      <div
        style={{
          width: "100%",
          height: "100%",
          background:
            "radial-gradient(ellipse at 50% 30%, #1a0a2e 0%, #0a0a1a 50%, #020208 100%)",
        }}
      />
      {/* Grid */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(${accentColor}12 1px, transparent 1px),
            linear-gradient(90deg, ${accentColor}12 1px, transparent 1px)
          `,
          backgroundSize: "50px 50px",
          transform: `translateY(${drift % 50}px)`,
        }}
      />
      {/* Top glow */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${accentColor}25 0%, transparent 70%)`,
          top: -300,
          left: "50%",
          transform: "translateX(-50%)",
          filter: "blur(80px)",
        }}
      />
    </AbsoluteFill>
  );
};

// ── Floating Particles ────────────────────────────────────────────────

const Particles: React.FC<{ count?: number; color?: string }> = ({
  count = 12,
  color = "#6366f1",
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ overflow: "hidden" }}>
      {Array.from({ length: count }).map((_, i) => {
        const seed = i * 137.5;
        const x = (seed * 7.3) % 100;
        const startY = 100 + ((seed * 3.1) % 30);
        const speed = 0.3 + ((seed * 1.7) % 0.5);
        const size = 3 + ((seed * 2.3) % 5);
        const y = startY - ((frame / fps) * speed * 30);
        const opacity = interpolate(
          y,
          [-10, 30, 70, 100],
          [0, 0.6, 0.6, 0],
          { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
        );

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${x}%`,
              top: `${y}%`,
              width: size,
              height: size,
              borderRadius: "50%",
              background: color,
              opacity,
              filter: "blur(1px)",
            }}
          />
        );
      })}
    </AbsoluteFill>
  );
};

// ── Scene 1: HOOK - Glitch "R.I.P SaaS" ──────────────────────────────

const HookScene: React.FC<{
  line1: string;
  line2: string;
}> = ({ line1, line2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Glitch flicker on main text
  const glitchPhase = Math.sin(frame * 0.8) > 0.7;
  const glitchX = glitchPhase ? (Math.sin(frame * 12) > 0 ? 4 : -4) : 0;

  // Main title spring
  const titleSpring = spring({
    frame,
    fps,
    config: { damping: 8, stiffness: 120 },
  });
  const titleScale = 0.3 + titleSpring * 0.7;
  const titleOpacity = interpolate(titleSpring, [0, 0.5], [0, 1], {
    extrapolateRight: "clamp",
  });

  // Subtitle fade-up
  const subProgress = spring({
    frame,
    fps,
    delay: Math.round(0.8 * fps),
    config: { damping: 200 },
  });
  const subY = interpolate(subProgress, [0, 1], [50, 0]);
  const subOpacity = interpolate(subProgress, [0, 1], [0, 1]);

  // Red flash on entry
  const flashOpacity = interpolate(frame, [0, 4, 10], [0, 0.3, 0], {
    extrapolateRight: "clamp",
  });

  // Skull pulse
  const skullScale = interpolate(
    frame % Math.round(1.2 * fps),
    [0, Math.round(0.6 * fps), Math.round(1.2 * fps)],
    [1, 1.15, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#ef4444" />
      <Particles color="#ef444480" count={8} />

      {/* Red flash overlay */}
      <AbsoluteFill
        style={{
          backgroundColor: `rgba(239,68,68,${flashOpacity})`,
        }}
      />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 60 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 40,
          }}
        >
          {/* Skull */}
          <div
            style={{
              fontSize: 120,
              transform: `scale(${skullScale * titleSpring})`,
              opacity: titleOpacity,
            }}
          >
            {"\u{1F480}"}
          </div>

          {/* R.I.P SaaS */}
          <div
            style={{
              fontSize: 140,
              fontWeight: 900,
              color: "#ef4444",
              fontFamily: "Arial Black, Arial, sans-serif",
              letterSpacing: -3,
              lineHeight: 1,
              textAlign: "center",
              textShadow: "0 0 80px rgba(239,68,68,0.6), 0 0 160px rgba(239,68,68,0.3)",
              opacity: titleOpacity,
              transform: `scale(${titleScale}) translateX(${glitchX}px)`,
            }}
          >
            {line1}
          </div>

          {/* Subtitle */}
          <div
            style={{
              fontSize: 38,
              color: "rgba(255,255,255,0.8)",
              fontFamily: "Arial, sans-serif",
              fontWeight: 600,
              textAlign: "center",
              lineHeight: 1.4,
              maxWidth: 800,
              opacity: subOpacity,
              transform: `translateY(${subY}px)`,
            }}
          >
            {line2}
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 2: THE PROBLEM - $2,400/mo crumbling stack ──────────────────

const ProblemScene: React.FC<{
  monthlyBefore: string;
  toolsReplaced: number;
}> = ({ monthlyBefore, toolsReplaced }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const tools = [
    { name: "CRM", cost: "$89", color: "#6366f1" },
    { name: "Email", cost: "$79", color: "#ea580c" },
    { name: "LinkedIn", cost: "$99", color: "#0a66c2" },
    { name: "WhatsApp", cost: "$45", color: "#25d366" },
    { name: "Analytics", cost: "$59", color: "#8b5cf6" },
    { name: "Scheduler", cost: "$29", color: "#06b6d4" },
    { name: "Forms", cost: "$19", color: "#f43f5e" },
    { name: "Chat", cost: "$39", color: "#14b8a6" },
    { name: "SEO", cost: "$49", color: "#eab308" },
    { name: "Social", cost: "$69", color: "#ec4899" },
    { name: "VA", cost: "$800", color: "#f59e0b" },
  ];

  // Title
  const titleSpring = spring({ frame, fps, config: { damping: 200 } });

  // Total counter animation
  const totalProgress = spring({
    frame,
    fps,
    delay: Math.round(2.5 * fps),
    config: { damping: 200 },
  });
  const totalOpacity = interpolate(totalProgress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#f59e0b" />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "60px 50px",
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
          {/* Title */}
          <div
            style={{
              fontSize: 48,
              fontWeight: 800,
              color: "rgba(255,255,255,0.9)",
              fontFamily: "Arial, sans-serif",
              textAlign: "center",
              opacity: interpolate(titleSpring, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(titleSpring, [0, 1], [30, 0])}px)`,
            }}
          >
            Your current stack? {toolsReplaced} tools.
          </div>

          {/* Tool cards grid */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "center",
              gap: 14,
              maxWidth: 900,
            }}
          >
            {tools.map((tool, i) => {
              const delay = 4 + i * 3;
              const cardSpring = spring({
                frame,
                fps,
                delay,
                config: { damping: 12, stiffness: 120 },
              });

              // Shake effect near end of scene
              const shakeStart = 3.5 * fps;
              const shakeAmount =
                frame > shakeStart
                  ? Math.sin(frame * 15 + i * 2) *
                    interpolate(
                      frame,
                      [shakeStart, shakeStart + 0.5 * fps],
                      [0, 3],
                      { extrapolateRight: "clamp" }
                    )
                  : 0;

              return (
                <div
                  key={i}
                  style={{
                    padding: "12px 20px",
                    borderRadius: 12,
                    background: `${tool.color}20`,
                    border: `1px solid ${tool.color}50`,
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    opacity: interpolate(cardSpring, [0, 1], [0, 1]),
                    transform: `scale(${0.5 + cardSpring * 0.5}) translateX(${shakeAmount}px)`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: tool.color,
                      fontFamily: "Arial, sans-serif",
                    }}
                  >
                    {tool.name}
                  </span>
                  <span
                    style={{
                      fontSize: 16,
                      color: "rgba(255,255,255,0.5)",
                      fontFamily: "monospace",
                    }}
                  >
                    {tool.cost}/mo
                  </span>
                </div>
              );
            })}
          </div>

          {/* Total cost */}
          <div
            style={{
              opacity: totalOpacity,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 8,
            }}
          >
            <div
              style={{
                fontSize: 72,
                fontWeight: 900,
                color: "#ef4444",
                fontFamily: "Arial Black, Arial, sans-serif",
                textShadow: "0 0 40px rgba(239,68,68,0.4)",
              }}
            >
              {monthlyBefore}/mo
            </div>
            <div
              style={{
                fontSize: 24,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "monospace",
              }}
            >
              + a part-time ops hire
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 3: THE SHIFT - Tools morph to agents ────────────────────────

const ShiftScene: React.FC<{
  toolsReplaced: number;
  agentsUsed: number;
}> = ({ toolsReplaced, agentsUsed }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // "11 tools" number
  const oldSpring = spring({ frame, fps, config: { damping: 200 } });

  // Arrow animation
  const arrowProgress = spring({
    frame,
    fps,
    delay: Math.round(1 * fps),
    config: { damping: 200 },
  });

  // "4 agents" number
  const newSpring = spring({
    frame,
    fps,
    delay: Math.round(1.5 * fps),
    config: { damping: 12, stiffness: 80 },
  });

  // Strikethrough on old number
  const strikeWidth = interpolate(
    frame,
    [2 * fps, 2.8 * fps],
    [0, 100],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // "Replaced" text
  const replacedOpacity = interpolate(
    frame,
    [2.5 * fps, 3.2 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#10b981" />
      <Particles color="#10b98160" count={10} />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 60 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 50,
          }}
        >
          {/* Old: 11 tools */}
          <div
            style={{
              position: "relative",
              opacity: interpolate(oldSpring, [0, 1], [0, 1]),
              transform: `scale(${0.8 + oldSpring * 0.2})`,
            }}
          >
            <div
              style={{
                fontSize: 100,
                fontWeight: 900,
                color: "rgba(255,255,255,0.4)",
                fontFamily: "Arial Black, Arial, sans-serif",
                textAlign: "center",
              }}
            >
              {toolsReplaced} tools
            </div>
            {/* Strikethrough */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: 0,
                width: `${strikeWidth}%`,
                height: 6,
                background: "#ef4444",
                borderRadius: 3,
                boxShadow: "0 0 20px rgba(239,68,68,0.6)",
              }}
            />
          </div>

          {/* Arrow */}
          <div
            style={{
              fontSize: 60,
              color: "#10b981",
              opacity: interpolate(arrowProgress, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(arrowProgress, [0, 1], [-20, 0])}px)`,
            }}
          >
            {"\u2193"}
          </div>

          {/* New: 4 agents */}
          <div
            style={{
              opacity: interpolate(newSpring, [0, 1], [0, 1]),
              transform: `scale(${0.5 + newSpring * 0.5})`,
            }}
          >
            <div
              style={{
                fontSize: 120,
                fontWeight: 900,
                color: "#10b981",
                fontFamily: "Arial Black, Arial, sans-serif",
                textAlign: "center",
                textShadow: "0 0 60px rgba(16,185,129,0.5)",
              }}
            >
              {agentsUsed} agents
            </div>
          </div>

          {/* Replaced badge */}
          <div
            style={{
              opacity: replacedOpacity,
              padding: "12px 40px",
              borderRadius: 100,
              border: "1px solid rgba(16,185,129,0.4)",
              background: "rgba(16,185,129,0.1)",
              fontSize: 26,
              color: "#10b981",
              fontFamily: "monospace",
              letterSpacing: 3,
            }}
          >
            REPLACED
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 4: AGENT BREAKDOWN ──────────────────────────────────────────

const AgentBreakdownScene: React.FC<{ agents: AgentItem[] }> = ({
  agents,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleSpring = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#8b5cf6" />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "60px 50px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 40,
            width: "100%",
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 52,
              fontWeight: 800,
              color: "white",
              fontFamily: "Arial, sans-serif",
              textAlign: "center",
              opacity: interpolate(titleSpring, [0, 1], [0, 1]),
            }}
          >
            Here's what died:
          </div>

          {/* Agent cards */}
          {agents.map((agent, i) => {
            const delay = Math.round(0.5 * fps) + i * Math.round(0.6 * fps);
            const cardSpring = spring({
              frame,
              fps,
              delay,
              config: { damping: 15, stiffness: 120 },
            });
            const cardX = interpolate(
              cardSpring,
              [0, 1],
              [i % 2 === 0 ? -100 : 100, 0]
            );

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 24,
                  padding: "20px 36px",
                  borderRadius: 16,
                  background: `${agent.color}15`,
                  border: `1px solid ${agent.color}40`,
                  width: "100%",
                  maxWidth: 750,
                  opacity: interpolate(cardSpring, [0, 1], [0, 1]),
                  transform: `translateX(${cardX}px)`,
                }}
              >
                <span style={{ fontSize: 50 }}>{agent.icon}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  <span
                    style={{
                      fontSize: 30,
                      fontWeight: 800,
                      color: agent.color,
                      fontFamily: "Arial, sans-serif",
                    }}
                  >
                    {agent.label}
                  </span>
                  <span
                    style={{
                      fontSize: 22,
                      color: "rgba(255,255,255,0.6)",
                      fontFamily: "Arial, sans-serif",
                    }}
                  >
                    {agent.description}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 5: THE NUMBERS ──────────────────────────────────────────────

const NumbersScene: React.FC<{
  monthlyBefore: string;
  monthlyAfter: string;
}> = ({ monthlyBefore, monthlyAfter }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Before price
  const beforeSpring = spring({ frame, fps, config: { damping: 200 } });

  // Arrow
  const arrowSpring = spring({
    frame,
    fps,
    delay: Math.round(1 * fps),
    config: { damping: 200 },
  });

  // After price - bouncy entrance
  const afterSpring = spring({
    frame,
    fps,
    delay: Math.round(1.5 * fps),
    config: { damping: 8, stiffness: 100 },
  });

  // Savings badge
  const badgeSpring = spring({
    frame,
    fps,
    delay: Math.round(2.5 * fps),
    config: { damping: 12 },
  });

  // Pulse on after price
  const pulse = interpolate(
    frame % Math.round(1 * fps),
    [0, Math.round(0.5 * fps), Math.round(1 * fps)],
    [1, 1.05, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#f59e0b" />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 60 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 30,
          }}
        >
          {/* Label */}
          <div
            style={{
              fontSize: 28,
              color: "rgba(255,255,255,0.4)",
              fontFamily: "monospace",
              letterSpacing: 4,
              opacity: interpolate(beforeSpring, [0, 1], [0, 1]),
            }}
          >
            MONTHLY COST
          </div>

          {/* Before */}
          <div
            style={{
              position: "relative",
              opacity: interpolate(beforeSpring, [0, 1], [0, 1]),
            }}
          >
            <div
              style={{
                fontSize: 100,
                fontWeight: 900,
                color: "rgba(255,255,255,0.3)",
                fontFamily: "Arial Black, Arial, sans-serif",
                textDecoration: "line-through",
                textDecorationColor: "#ef4444",
                textDecorationThickness: 5,
              }}
            >
              {monthlyBefore}/mo
            </div>
          </div>

          {/* Arrow */}
          <div
            style={{
              fontSize: 50,
              color: "#f59e0b",
              opacity: interpolate(arrowSpring, [0, 1], [0, 1]),
              transform: `translateY(${interpolate(arrowSpring, [0, 1], [-15, 0])}px)`,
            }}
          >
            {"\u2193"}
          </div>

          {/* After */}
          <div
            style={{
              opacity: interpolate(afterSpring, [0, 1], [0, 1]),
              transform: `scale(${afterSpring * pulse})`,
            }}
          >
            <div
              style={{
                fontSize: 130,
                fontWeight: 900,
                color: "#10b981",
                fontFamily: "Arial Black, Arial, sans-serif",
                textShadow: "0 0 80px rgba(16,185,129,0.5)",
              }}
            >
              {monthlyAfter}/mo
            </div>
          </div>

          {/* In API calls */}
          <div
            style={{
              fontSize: 24,
              color: "rgba(255,255,255,0.4)",
              fontFamily: "monospace",
              opacity: interpolate(afterSpring, [0, 1], [0, 1]),
            }}
          >
            in API calls
          </div>

          {/* Savings badge */}
          <div
            style={{
              marginTop: 10,
              padding: "14px 40px",
              borderRadius: 100,
              background:
                "linear-gradient(135deg, rgba(245,158,11,0.2), rgba(16,185,129,0.2))",
              border: "1px solid rgba(245,158,11,0.4)",
              opacity: interpolate(badgeSpring, [0, 1], [0, 1]),
              transform: `scale(${0.8 + badgeSpring * 0.2})`,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 800,
                color: "#f59e0b",
                fontFamily: "Arial, sans-serif",
              }}
            >
              92% cost reduction
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 6: THE INSIGHT ──────────────────────────────────────────────

const InsightScene: React.FC<{
  line1: string;
  line2: string;
}> = ({ line1, line2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Line 1 - typewriter effect
  const charsVisible1 = Math.floor(
    interpolate(frame, [0, 1.5 * fps], [0, line1.length], {
      extrapolateRight: "clamp",
    })
  );

  // Line 2 - typewriter after line 1
  const line2Start = 2 * fps;
  const charsVisible2 = Math.floor(
    interpolate(frame, [line2Start, line2Start + 1.5 * fps], [0, line2.length], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    })
  );

  // Cursor blink
  const cursorVisible = Math.floor(frame / (fps * 0.4)) % 2 === 0;

  // Accent line grows after both lines
  const accentWidth = interpolate(
    frame,
    [3.5 * fps, 4.2 * fps],
    [0, 200],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const isTypingLine1 = charsVisible1 < line1.length;
  const isTypingLine2 = frame >= line2Start && charsVisible2 < line2.length;
  const showCursor = isTypingLine1 || isTypingLine2;

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#a78bfa" />
      <Particles color="#a78bfa50" count={6} />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 80 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
          }}
        >
          {/* Line 1 */}
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              color: "rgba(255,255,255,0.6)",
              fontFamily: "Arial, sans-serif",
              textAlign: "center",
              lineHeight: 1.3,
            }}
          >
            {line1.slice(0, charsVisible1)}
            {isTypingLine1 && cursorVisible && (
              <span style={{ color: "#a78bfa" }}>|</span>
            )}
          </div>

          {/* Line 2 */}
          <div
            style={{
              fontSize: 64,
              fontWeight: 900,
              color: "white",
              fontFamily: "Arial, sans-serif",
              textAlign: "center",
              lineHeight: 1.3,
              textShadow: "0 0 40px rgba(167,139,250,0.3)",
            }}
          >
            {line2.slice(0, charsVisible2)}
            {isTypingLine2 && cursorVisible && (
              <span style={{ color: "#a78bfa" }}>|</span>
            )}
            {!showCursor && frame > 3.5 * fps && cursorVisible && (
              <span style={{ color: "#a78bfa" }}>|</span>
            )}
          </div>

          {/* Accent line */}
          <div
            style={{
              width: accentWidth,
              height: 4,
              borderRadius: 100,
              background:
                "linear-gradient(90deg, rgba(167,139,250,0.8), rgba(99,102,241,0.8))",
              marginTop: 16,
            }}
          />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 7: CTA ──────────────────────────────────────────────────────

const CTAScene: React.FC<{
  headline: string;
  subtext: string;
  keyword: string;
  stats: StatItem[];
}> = ({ headline, subtext, keyword, stats }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const headlineSpring = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });

  const subtextOpacity = interpolate(
    frame,
    [1 * fps, 1.8 * fps],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Stats row
  const statsDelay = Math.round(1.5 * fps);

  // CTA button pulse
  const ctaSpring = spring({
    frame,
    fps,
    delay: Math.round(2.5 * fps),
    config: { damping: 200 },
  });
  const ctaPulse = interpolate(
    frame % Math.round(1.5 * fps),
    [0, Math.round(0.75 * fps), Math.round(1.5 * fps)],
    [1, 1.04, 1],
    { extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      <DarkGrid accentColor="#f59e0b" />
      <Particles color="#f59e0b40" count={10} />

      {/* Gold glow */}
      <div
        style={{
          position: "absolute",
          width: 600,
          height: 600,
          borderRadius: "50%",
          background:
            "radial-gradient(circle, rgba(245,158,11,0.15) 0%, transparent 70%)",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          filter: "blur(60px)",
        }}
      />

      <AbsoluteFill
        style={{ justifyContent: "center", alignItems: "center", padding: 60 }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 36,
          }}
        >
          {/* Headline */}
          <div
            style={{
              fontSize: 80,
              fontWeight: 900,
              color: "#f59e0b",
              fontFamily: "Arial Black, Arial, sans-serif",
              textAlign: "center",
              textShadow: "0 0 60px rgba(245,158,11,0.4)",
              opacity: interpolate(headlineSpring, [0, 1], [0, 1]),
              transform: `scale(${0.8 + headlineSpring * 0.2})`,
            }}
          >
            {headline}
          </div>

          {/* Subtext */}
          <div
            style={{
              fontSize: 30,
              color: "rgba(255,255,255,0.7)",
              fontFamily: "Arial, sans-serif",
              fontWeight: 500,
              textAlign: "center",
              lineHeight: 1.4,
              maxWidth: 700,
              opacity: subtextOpacity,
            }}
          >
            {subtext}
          </div>

          {/* Stats row */}
          <div
            style={{
              display: "flex",
              gap: 36,
              marginTop: 10,
            }}
          >
            {stats.map((stat, i) => {
              const statSpring = spring({
                frame,
                fps,
                delay: statsDelay + i * 5,
                config: { damping: 15, stiffness: 120 },
              });

              return (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 6,
                    opacity: interpolate(statSpring, [0, 1], [0, 1]),
                    transform: `translateY(${interpolate(statSpring, [0, 1], [20, 0])}px)`,
                  }}
                >
                  <span
                    style={{
                      fontSize: 44,
                      fontWeight: 900,
                      color: "white",
                      fontFamily: "Arial Black, Arial, sans-serif",
                    }}
                  >
                    {stat.value}
                  </span>
                  <span
                    style={{
                      fontSize: 18,
                      color: "rgba(255,255,255,0.4)",
                      fontFamily: "monospace",
                      letterSpacing: 1,
                    }}
                  >
                    {stat.label}
                  </span>
                </div>
              );
            })}
          </div>

          {/* CTA button */}
          <div
            style={{
              marginTop: 10,
              opacity: interpolate(ctaSpring, [0, 1], [0, 1]),
              transform: `scale(${ctaSpring * ctaPulse})`,
            }}
          >
            <div
              style={{
                padding: "20px 56px",
                borderRadius: 20,
                background:
                  "linear-gradient(135deg, rgba(245,158,11,0.3), rgba(234,88,12,0.3))",
                border: "1px solid rgba(245,158,11,0.5)",
              }}
            >
              <span
                style={{
                  fontSize: 30,
                  fontWeight: 700,
                  color: "white",
                  fontFamily: "Arial, sans-serif",
                }}
              >
                Comment "{keyword}" for the full system
              </span>
            </div>
          </div>

          {/* Handle */}
          <div
            style={{
              opacity: interpolate(ctaSpring, [0, 1], [0, 1]),
              fontSize: 22,
              color: "rgba(255,255,255,0.3)",
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

// ── Main Composition ──────────────────────────────────────────────────

export const RIPSaaSVideo: React.FC<RIPSaaSVideoProps> = (props) => {
  const { fps } = useVideoConfig();

  const hookFrames = Math.round(HOOK_DURATION_SEC * fps);
  const sceneFrames = Math.round(SCENE_DURATION_SEC * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#020208" }}>
      <TransitionSeries>
        {/* Scene 1: Hook */}
        <TransitionSeries.Sequence
          durationInFrames={hookFrames}
          premountFor={15}
        >
          <HookScene line1={props.hookLine1} line2={props.hookLine2} />
        </TransitionSeries.Sequence>

        {/* Scene 2: The Problem */}
        <TransitionSeries.Transition
          presentation={wipe({ direction: "from-left" })}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={sceneFrames}
          premountFor={15}
        >
          <ProblemScene
            monthlyBefore={props.monthlyBefore}
            toolsReplaced={props.toolsReplaced}
          />
        </TransitionSeries.Sequence>

        {/* Scene 3: The Shift */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={sceneFrames}
          premountFor={15}
        >
          <ShiftScene
            toolsReplaced={props.toolsReplaced}
            agentsUsed={props.agentsUsed}
          />
        </TransitionSeries.Sequence>

        {/* Scene 4: Agent Breakdown */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-right" })}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={sceneFrames}
          premountFor={15}
        >
          <AgentBreakdownScene agents={props.agents} />
        </TransitionSeries.Sequence>

        {/* Scene 5: The Numbers */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={sceneFrames}
          premountFor={15}
        >
          <NumbersScene
            monthlyBefore={props.monthlyBefore}
            monthlyAfter={props.monthlyAfter}
          />
        </TransitionSeries.Sequence>

        {/* Scene 6: The Insight */}
        <TransitionSeries.Transition
          presentation={slide({ direction: "from-bottom" })}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={sceneFrames}
          premountFor={15}
        >
          <InsightScene
            line1={props.insightLine1}
            line2={props.insightLine2}
          />
        </TransitionSeries.Sequence>

        {/* Scene 7: CTA */}
        <TransitionSeries.Transition
          presentation={fade()}
          timing={linearTiming({ durationInFrames: TRANSITION_FRAMES })}
        />
        <TransitionSeries.Sequence
          durationInFrames={sceneFrames}
          premountFor={15}
        >
          <CTAScene
            headline={props.ctaHeadline}
            subtext={props.ctaSubtext}
            keyword={props.ctaKeyword}
            stats={props.stats}
          />
        </TransitionSeries.Sequence>
      </TransitionSeries>
    </AbsoluteFill>
  );
};
