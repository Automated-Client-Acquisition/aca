import React from "react";
import {
  AbsoluteFill,
  useCurrentFrame,
  useVideoConfig,
  spring,
  interpolate,
} from "remotion";
import type { z } from "zod";
import type {
  hookSceneSchema,
  oldStackSceneSchema,
  inboxSceneSchema,
  sequencesSceneSchema,
  autopilotsSceneSchema,
  peopleCRMSceneSchema,
  costComparisonSceneSchema,
  ctaSceneSchema,
} from "./skill-compositions/schemas";

// ── Shared Constants ──────────────────────────────────────────────────

const GOLD = "#d4a843";
const DARK_BG = "#0a0a14";
const CARD_BG = "#111122";
const RED = "#ef4444";
const GREEN = "#22c55e";
const BLUE = "#3b82f6";
const PURPLE = "#a78bfa";
const WHITE = "#ffffff";
const GRAY = "#94a3b8";
const FONT = "Inter, system-ui, -apple-system, sans-serif";

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// ── Scene 1: HookScene ────────────────────────────────────────────────

export type HookSceneProps = z.infer<typeof hookSceneSchema>;

export const DEFAULT_HOOK_PROPS: HookSceneProps = {
  oldPrice: "$3.50",
  newPrice: "$0.66",
  subtitle: "per conversation",
  savingsText: "81% Cost Reduction - Save $11,304/year",
};

export const HookScene: React.FC<HookSceneProps> = ({
  oldPrice,
  newPrice,
  subtitle,
  savingsText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Grid drift
  const drift = interpolate(frame, [0, 30 * fps], [0, -200], {
    extrapolateRight: "extend",
  });

  // Old price fades in large
  const oldPriceOpacity = interpolate(frame, [10, 30], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const oldPriceScale = interpolate(frame, [10, 30], [0.7, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Strikethrough slides in
  const strikeWidth = interpolate(frame, [40, 60], [0, 100], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // New price springs in
  const newPriceProgress = spring({
    frame,
    fps,
    delay: Math.round(1.5 * fps),
    config: { damping: 10, stiffness: 100 },
  });
  const newPriceOpacity = interpolate(newPriceProgress, [0, 1], [0, 1]);
  const newPriceY = interpolate(newPriceProgress, [0, 1], [60, 0]);

  // Subtitle
  const subtitleOpacity = interpolate(
    frame,
    [Math.round(2 * fps), Math.round(2.5 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Savings badge fades up
  const badgeProgress = interpolate(
    frame,
    [Math.round(3 * fps), Math.round(3.5 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const badgeY = interpolate(
    frame,
    [Math.round(3 * fps), Math.round(3.5 * fps)],
    [30, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill>
      {/* Dark background with grid */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 30%, #1a1030 0%, ${DARK_BG} 60%)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 0,
          backgroundImage: `
            linear-gradient(rgba(212,168,67,0.06) 1px, transparent 1px),
            linear-gradient(90deg, rgba(212,168,67,0.06) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
          transform: `translateY(${drift % 60}px)`,
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "60px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 24,
          }}
        >
          {/* Old price */}
          <div
            style={{
              position: "relative",
              opacity: oldPriceOpacity,
              transform: `scale(${oldPriceScale})`,
            }}
          >
            <span
              style={{
                fontSize: 140,
                fontWeight: 900,
                fontFamily: FONT,
                color: RED,
                lineHeight: 1,
              }}
            >
              {oldPrice}
            </span>
            {/* Strikethrough line */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: 0,
                width: `${strikeWidth}%`,
                height: 8,
                backgroundColor: RED,
                borderRadius: 4,
                transform: "translateY(-50%)",
              }}
            />
          </div>

          {/* New price */}
          <div
            style={{
              opacity: newPriceOpacity,
              transform: `translateY(${newPriceY}px)`,
            }}
          >
            <span
              style={{
                fontSize: 180,
                fontWeight: 900,
                fontFamily: FONT,
                color: GREEN,
                lineHeight: 1,
                textShadow: `0 0 80px ${GREEN}40`,
              }}
            >
              {newPrice}
            </span>
          </div>

          {/* Subtitle */}
          <div
            style={{
              opacity: subtitleOpacity,
              fontSize: 40,
              fontWeight: 500,
              fontFamily: FONT,
              color: GRAY,
              letterSpacing: 2,
            }}
          >
            {subtitle}
          </div>

          {/* Savings badge */}
          <div
            style={{
              opacity: badgeProgress,
              transform: `translateY(${badgeY}px)`,
              marginTop: 20,
              padding: "16px 48px",
              borderRadius: 100,
              background: `linear-gradient(135deg, ${GOLD}30, ${GOLD}15)`,
              border: `2px solid ${GOLD}60`,
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 700,
                fontFamily: FONT,
                color: GOLD,
                letterSpacing: 1,
              }}
            >
              {savingsText}
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 2: OldStackScene ────────────────────────────────────────────

export type OldStackSceneProps = z.infer<typeof oldStackSceneSchema>;

export const DEFAULT_OLD_STACK_PROPS: OldStackSceneProps = {
  title: "Your Current Stack",
  tools: [
    { name: "LinkedIn Tool", cost: "$99/mo", icon: "in", color: "#0a66c2" },
    { name: "Email Outreach", cost: "$79/mo", icon: "@", color: "#ea580c" },
    { name: "WhatsApp API", cost: "$45/mo", icon: "W", color: "#25d366" },
    { name: "Instagram DMs", cost: "$29/mo", icon: "IG", color: "#e1306c" },
    { name: "CRM Platform", cost: "$89/mo", icon: "C", color: "#6366f1" },
    { name: "Virtual Assistant", cost: "$800/mo", icon: "VA", color: "#f59e0b" },
  ],
  totalCost: "$1,141/month",
};

export const OldStackScene: React.FC<OldStackSceneProps> = ({
  title,
  tools,
  totalCost,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title fade
  const titleOpacity = interpolate(frame, [5, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const titleY = interpolate(frame, [5, 20], [20, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Total bar slides up
  const totalDelay = Math.round(0.5 * fps + tools.length * 6);
  const totalProgress = spring({
    frame,
    fps,
    delay: totalDelay,
    config: { damping: 14, stiffness: 100 },
  });
  const totalOpacity = interpolate(totalProgress, [0, 1], [0, 1]);
  const totalY = interpolate(totalProgress, [0, 1], [40, 0]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 20%, #1a1030 0%, ${DARK_BG} 60%)`,
      }}
    >
      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "60px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 32,
            width: "100%",
          }}
        >
          {/* Title */}
          <div
            style={{
              opacity: titleOpacity,
              transform: `translateY(${titleY}px)`,
              fontSize: 56,
              fontWeight: 800,
              fontFamily: FONT,
              color: WHITE,
              textAlign: "center" as const,
            }}
          >
            {title}
          </div>

          {/* Tool cards - 2 columns */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap" as const,
              justifyContent: "center",
              gap: 20,
              width: "100%",
              maxWidth: 1200,
            }}
          >
            {tools.map((tool, i: number) => {
              const cardProgress = spring({
                frame,
                fps,
                delay: Math.round(0.3 * fps + i * 6),
                config: { damping: 14, stiffness: 120 },
              });
              const cardOpacity = interpolate(cardProgress, [0, 1], [0, 1]);
              const cardScale = interpolate(cardProgress, [0, 1], [0.8, 1]);

              return (
                <div
                  key={i}
                  style={{
                    opacity: cardOpacity,
                    transform: `scale(${cardScale})`,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "18px 28px",
                    borderRadius: 16,
                    backgroundColor: CARD_BG,
                    border: "1px solid rgba(255,255,255,0.08)",
                    width: "45%",
                    minWidth: 340,
                  }}
                >
                  {/* Icon circle */}
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      backgroundColor: `${tool.color}25`,
                      display: "flex",
                      justifyContent: "center",
                      alignItems: "center",
                      fontSize: 20,
                      fontWeight: 800,
                      fontFamily: FONT,
                      color: tool.color,
                      flexShrink: 0,
                    }}
                  >
                    {tool.icon}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 600,
                        color: WHITE,
                        fontFamily: FONT,
                      }}
                    >
                      {tool.name}
                    </div>
                  </div>
                  <div
                    style={{
                      fontSize: 24,
                      fontWeight: 700,
                      color: RED,
                      fontFamily: FONT,
                    }}
                  >
                    {tool.cost}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total bar */}
          <div
            style={{
              opacity: totalOpacity,
              transform: `translateY(${totalY}px)`,
              padding: "20px 60px",
              borderRadius: 16,
              background: `linear-gradient(135deg, ${RED}25, ${RED}10)`,
              border: `2px solid ${RED}50`,
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <span
              style={{
                fontSize: 28,
                fontWeight: 600,
                color: GRAY,
                fontFamily: FONT,
              }}
            >
              Total:
            </span>
            <span
              style={{
                fontSize: 48,
                fontWeight: 900,
                color: RED,
                fontFamily: FONT,
              }}
            >
              {totalCost}
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 3: InboxScene ───────────────────────────────────────────────

export type InboxSceneProps = z.infer<typeof inboxSceneSchema>;

export const DEFAULT_INBOX_PROPS: InboxSceneProps = {
  conversationCount: "9,789",
  conversations: [
    { name: "Sarah Chen", channel: "LinkedIn", preview: "Thanks for connecting! I'd love to...", time: "2m" },
    { name: "Marc Dubois", channel: "Email", preview: "Re: Partnership proposal - sounds...", time: "5m" },
    { name: "Priya Patel", channel: "WhatsApp", preview: "Can we schedule a demo this week?", time: "12m" },
    { name: "James Wilson", channel: "Instagram", preview: "Love your content! Quick question...", time: "18m" },
    { name: "Ana Torres", channel: "Telegram", preview: "Our team reviewed the pricing and...", time: "25m" },
    { name: "Liu Wei", channel: "LinkedIn", preview: "Interested in the enterprise plan...", time: "32m" },
    { name: "Emma Davis", channel: "Email", preview: "Following up on our call yesterday...", time: "45m" },
  ],
  badgeText: "All channels. One inbox. $0.66/conversation.",
};

const channelColor = (channel: string): string => {
  const map: Record<string, string> = {
    LinkedIn: "#0a66c2",
    Email: "#ea580c",
    WhatsApp: "#25d366",
    Instagram: "#e1306c",
    Telegram: "#229ed9",
    SMS: "#8b5cf6",
  };
  return map[channel] || BLUE;
};

export const InboxScene: React.FC<InboxSceneProps> = ({
  conversationCount,
  conversations,
  badgeText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Container fade in
  const containerOpacity = interpolate(frame, [5, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Badge
  const badgeDelay = Math.round(3 * fps);
  const badgeOpacity = interpolate(
    frame,
    [badgeDelay, badgeDelay + Math.round(0.5 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const badgeY = interpolate(
    frame,
    [badgeDelay, badgeDelay + Math.round(0.5 * fps)],
    [20, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#f8f9fb" }}>
      <AbsoluteFill
        style={{
          opacity: containerOpacity,
          padding: "50px 60px",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Header bar */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "20px 32px",
            backgroundColor: WHITE,
            borderRadius: 16,
            marginBottom: 24,
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                fontSize: 28,
                fontWeight: 800,
                fontFamily: FONT,
                color: "#0f172a",
              }}
            >
              Inbox
            </div>
            <div
              style={{
                padding: "4px 16px",
                borderRadius: 100,
                backgroundColor: `${BLUE}15`,
                fontSize: 20,
                fontWeight: 700,
                color: BLUE,
                fontFamily: FONT,
              }}
            >
              {conversationCount}
            </div>
          </div>
          <div
            style={{
              display: "flex",
              gap: 12,
            }}
          >
            {["All", "LinkedIn", "Email", "WhatsApp"].map((tab: string, i: number) => (
              <div
                key={i}
                style={{
                  padding: "6px 18px",
                  borderRadius: 8,
                  backgroundColor: i === 0 ? `${BLUE}15` : "transparent",
                  fontSize: 18,
                  fontWeight: i === 0 ? 700 : 500,
                  color: i === 0 ? BLUE : GRAY,
                  fontFamily: FONT,
                }}
              >
                {tab}
              </div>
            ))}
          </div>
        </div>

        {/* Conversation list */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            flex: 1,
          }}
        >
          {conversations.map((conv, i: number) => {
            const rowDelay = Math.round(0.3 * fps + i * 5);
            const rowProgress = spring({
              frame,
              fps,
              delay: rowDelay,
              config: { damping: 20, stiffness: 150 },
            });
            const rowOpacity = interpolate(rowProgress, [0, 1], [0, 1]);
            const rowX = interpolate(rowProgress, [0, 1], [40, 0]);
            const clr = channelColor(conv.channel);

            return (
              <div
                key={i}
                style={{
                  opacity: rowOpacity,
                  transform: `translateX(${rowX}px)`,
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  padding: "16px 24px",
                  backgroundColor: WHITE,
                  borderRadius: 12,
                  boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
                }}
              >
                {/* Avatar circle */}
                <div
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 22,
                    backgroundColor: `${clr}20`,
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    fontSize: 20,
                    fontWeight: 700,
                    color: clr,
                    fontFamily: FONT,
                    flexShrink: 0,
                  }}
                >
                  {conv.name.charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 20,
                        fontWeight: 700,
                        color: "#0f172a",
                        fontFamily: FONT,
                      }}
                    >
                      {conv.name}
                    </span>
                    <span
                      style={{
                        fontSize: 13,
                        fontWeight: 600,
                        color: clr,
                        fontFamily: FONT,
                        padding: "2px 8px",
                        borderRadius: 6,
                        backgroundColor: `${clr}15`,
                      }}
                    >
                      {conv.channel}
                    </span>
                  </div>
                  <div
                    style={{
                      fontSize: 17,
                      color: GRAY,
                      fontFamily: FONT,
                      overflow: "hidden",
                      whiteSpace: "nowrap" as const,
                      textOverflow: "ellipsis",
                    }}
                  >
                    {conv.preview}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 16,
                    color: GRAY,
                    fontFamily: FONT,
                    flexShrink: 0,
                  }}
                >
                  {conv.time}
                </span>
              </div>
            );
          })}
        </div>

        {/* Floating badge */}
        <div
          style={{
            position: "absolute",
            bottom: 50,
            left: "50%",
            transform: `translateX(-50%) translateY(${badgeY}px)`,
            opacity: badgeOpacity,
            padding: "16px 40px",
            borderRadius: 100,
            background: `linear-gradient(135deg, ${GOLD}, #b8922e)`,
            boxShadow: `0 8px 32px ${GOLD}40`,
          }}
        >
          <span
            style={{
              fontSize: 24,
              fontWeight: 700,
              color: WHITE,
              fontFamily: FONT,
            }}
          >
            {badgeText}
          </span>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 4: SequencesScene ───────────────────────────────────────────

export type SequencesSceneProps = z.infer<typeof sequencesSceneSchema>;

export const DEFAULT_SEQUENCES_PROPS: SequencesSceneProps = {
  sequences: [
    { name: "Cold Outreach - SaaS Founders", steps: 7, enrolled: "3,241", done: "1,890", status: "Active" },
    { name: "Follow-up - Demo Booked", steps: 4, enrolled: "2,105", done: "1,432", status: "Active" },
    { name: "Re-engagement - 30 Days", steps: 5, enrolled: "4,209", done: "2,876", status: "Active" },
    { name: "Onboarding Welcome", steps: 3, enrolled: "2,400", done: "1,988", status: "Paused" },
  ],
  totalBadge: "11,955 leads enrolled automatically",
};

export const SequencesScene: React.FC<SequencesSceneProps> = ({
  sequences,
  totalBadge,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Title
  const titleOpacity = interpolate(frame, [5, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Badge
  const badgeDelay = Math.round(3.5 * fps);
  const badgeOpacity = interpolate(
    frame,
    [badgeDelay, badgeDelay + Math.round(0.4 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#f8f9fb" }}>
      <AbsoluteFill style={{ padding: "50px 60px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            width: "100%",
            height: "100%",
          }}
        >
          {/* Header */}
          <div
            style={{
              opacity: titleOpacity,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <div
              style={{
                fontSize: 44,
                fontWeight: 800,
                fontFamily: FONT,
                color: "#0f172a",
              }}
            >
              Email Sequences
            </div>
            <div
              style={{
                display: "flex",
                gap: 12,
              }}
            >
              {["All", "Active", "Paused", "Draft"].map((tab: string, i: number) => (
                <div
                  key={i}
                  style={{
                    padding: "8px 20px",
                    borderRadius: 8,
                    backgroundColor: i === 0 ? `${BLUE}15` : "transparent",
                    fontSize: 18,
                    fontWeight: i === 0 ? 700 : 500,
                    color: i === 0 ? BLUE : GRAY,
                    fontFamily: FONT,
                  }}
                >
                  {tab}
                </div>
              ))}
            </div>
          </div>

          {/* Sequence cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 16,
              flex: 1,
            }}
          >
            {sequences.map((seq, i: number) => {
              const cardDelay = Math.round(0.4 * fps + i * 8);
              const rawT = interpolate(
                frame,
                [cardDelay, cardDelay + Math.round(0.5 * fps)],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              const t = easeOutCubic(rawT);
              const cardOpacity = t;
              const cardX = interpolate(t, [0, 1], [60, 0]);
              const isActive = seq.status === "Active";

              return (
                <div
                  key={i}
                  style={{
                    opacity: cardOpacity,
                    transform: `translateX(${cardX}px)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    padding: "24px 32px",
                    backgroundColor: WHITE,
                    borderRadius: 16,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    border: `1px solid ${isActive ? GREEN + "30" : GRAY + "20"}`,
                  }}
                >
                  {/* Status dot */}
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: isActive ? GREEN : GRAY,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: "#0f172a",
                        fontFamily: FONT,
                        marginBottom: 4,
                      }}
                    >
                      {seq.name}
                    </div>
                    <div
                      style={{
                        fontSize: 16,
                        color: GRAY,
                        fontFamily: FONT,
                      }}
                    >
                      {seq.steps} steps
                    </div>
                  </div>
                  <div style={{ textAlign: "center" as const, minWidth: 80 }}>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 800,
                        color: BLUE,
                        fontFamily: FONT,
                      }}
                    >
                      {seq.enrolled}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        color: GRAY,
                        fontFamily: FONT,
                      }}
                    >
                      Enrolled
                    </div>
                  </div>
                  <div style={{ textAlign: "center" as const, minWidth: 80 }}>
                    <div
                      style={{
                        fontSize: 24,
                        fontWeight: 800,
                        color: GREEN,
                        fontFamily: FONT,
                      }}
                    >
                      {seq.done}
                    </div>
                    <div
                      style={{
                        fontSize: 14,
                        color: GRAY,
                        fontFamily: FONT,
                      }}
                    >
                      Done
                    </div>
                  </div>
                  <div
                    style={{
                      padding: "6px 16px",
                      borderRadius: 8,
                      backgroundColor: isActive ? `${GREEN}15` : `${GRAY}15`,
                      fontSize: 16,
                      fontWeight: 600,
                      color: isActive ? GREEN : GRAY,
                      fontFamily: FONT,
                    }}
                  >
                    {seq.status}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Total badge */}
          <div
            style={{
              opacity: badgeOpacity,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                padding: "14px 40px",
                borderRadius: 100,
                background: `linear-gradient(135deg, ${GOLD}, #b8922e)`,
                boxShadow: `0 6px 24px ${GOLD}30`,
              }}
            >
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: WHITE,
                  fontFamily: FONT,
                }}
              >
                {totalBadge}
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 5: AutopilotsScene ──────────────────────────────────────────

export type AutopilotsSceneProps = z.infer<typeof autopilotsSceneSchema>;

export const DEFAULT_AUTOPILOTS_PROPS: AutopilotsSceneProps = {
  stats: [
    { label: "Active", value: "4", color: GREEN },
    { label: "Paused", value: "0", color: GRAY },
    { label: "Generated", value: "80", color: BLUE },
    { label: "Published", value: "155", color: PURPLE },
  ],
  autopilots: [
    { name: "SaaS Growth Tips", blueprints: 3, destinations: 4, generated: 32, published: 58, pool: "120 ideas" },
    { name: "AI News Digest", blueprints: 2, destinations: 3, generated: 28, published: 52, pool: "85 ideas" },
    { name: "Case Studies", blueprints: 1, destinations: 2, generated: 20, published: 45, pool: "45 ideas" },
  ],
  badgeText: "Content on autopilot. Zero manual work.",
};

export const AutopilotsScene: React.FC<AutopilotsSceneProps> = ({
  stats,
  autopilots,
  badgeText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Container
  const containerOpacity = interpolate(frame, [5, 15], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // Badge
  const badgeDelay = Math.round(3.5 * fps);
  const badgeOpacity = interpolate(
    frame,
    [badgeDelay, badgeDelay + Math.round(0.4 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  return (
    <AbsoluteFill style={{ backgroundColor: "#f8f9fb" }}>
      <AbsoluteFill
        style={{
          opacity: containerOpacity,
          padding: "50px 60px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            width: "100%",
            height: "100%",
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 44,
              fontWeight: 800,
              fontFamily: FONT,
              color: "#0f172a",
            }}
          >
            Autopilots
          </div>

          {/* Stat cards */}
          <div
            style={{
              display: "flex",
              gap: 20,
            }}
          >
            {stats.map((stat, i: number) => {
              const statProgress = spring({
                frame,
                fps,
                delay: Math.round(0.2 * fps + i * 5),
                config: { damping: 12, stiffness: 120 },
              });
              const statScale = interpolate(statProgress, [0, 1], [0.8, 1]);
              const statOpacity = interpolate(statProgress, [0, 1], [0, 1]);

              return (
                <div
                  key={i}
                  style={{
                    opacity: statOpacity,
                    transform: `scale(${statScale})`,
                    flex: 1,
                    padding: "20px 24px",
                    borderRadius: 16,
                    backgroundColor: WHITE,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                    textAlign: "center" as const,
                  }}
                >
                  <div
                    style={{
                      fontSize: 40,
                      fontWeight: 900,
                      color: stat.color,
                      fontFamily: FONT,
                    }}
                  >
                    {stat.value}
                  </div>
                  <div
                    style={{
                      fontSize: 18,
                      color: GRAY,
                      fontFamily: FONT,
                      marginTop: 4,
                    }}
                  >
                    {stat.label}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Autopilot cards */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              flex: 1,
            }}
          >
            {autopilots.map((ap, i: number) => {
              const cardDelay = Math.round(0.8 * fps + i * 8);
              const rawT = interpolate(
                frame,
                [cardDelay, cardDelay + Math.round(0.5 * fps)],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              const t = easeOutCubic(rawT);
              const cardY = interpolate(t, [0, 1], [40, 0]);

              return (
                <div
                  key={i}
                  style={{
                    opacity: t,
                    transform: `translateY(${cardY}px)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 24,
                    padding: "22px 28px",
                    backgroundColor: WHITE,
                    borderRadius: 14,
                    boxShadow: "0 2px 8px rgba(0,0,0,0.05)",
                  }}
                >
                  {/* Active dot */}
                  <div
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: GREEN,
                      flexShrink: 0,
                    }}
                  />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: "#0f172a",
                        fontFamily: FONT,
                      }}
                    >
                      {ap.name}
                    </div>
                    <div
                      style={{
                        fontSize: 15,
                        color: GRAY,
                        fontFamily: FONT,
                        marginTop: 2,
                      }}
                    >
                      {ap.blueprints} blueprints / {ap.destinations} destinations / {ap.pool}
                    </div>
                  </div>
                  <div style={{ textAlign: "center" as const, minWidth: 70 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: BLUE, fontFamily: FONT }}>
                      {ap.generated}
                    </div>
                    <div style={{ fontSize: 13, color: GRAY, fontFamily: FONT }}>
                      Generated
                    </div>
                  </div>
                  <div style={{ textAlign: "center" as const, minWidth: 70 }}>
                    <div style={{ fontSize: 22, fontWeight: 800, color: GREEN, fontFamily: FONT }}>
                      {ap.published}
                    </div>
                    <div style={{ fontSize: 13, color: GRAY, fontFamily: FONT }}>
                      Published
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Floating badge */}
          <div
            style={{
              opacity: badgeOpacity,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                padding: "14px 40px",
                borderRadius: 100,
                background: `linear-gradient(135deg, ${GOLD}, #b8922e)`,
                boxShadow: `0 6px 24px ${GOLD}30`,
              }}
            >
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: WHITE,
                  fontFamily: FONT,
                }}
              >
                {badgeText}
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 6: PeopleCRMScene ───────────────────────────────────────────

export type PeopleCRMSceneProps = z.infer<typeof peopleCRMSceneSchema>;

export const DEFAULT_PEOPLE_CRM_PROPS: PeopleCRMSceneProps = {
  totalContacts: 93747,
  contacts: [
    { name: "Sarah Chen", email: "sarah@techcorp.io", type: "Lead", outreach: "LinkedIn", time: "2h ago" },
    { name: "Marc Dubois", email: "marc@startupx.fr", type: "Customer", outreach: "Email", time: "5h ago" },
    { name: "Priya Patel", email: "priya@saasly.com", type: "Lead", outreach: "WhatsApp", time: "1d ago" },
    { name: "James Wilson", email: "james@enterprise.co", type: "Prospect", outreach: "Instagram", time: "1d ago" },
    { name: "Ana Torres", email: "ana@growthco.mx", type: "Lead", outreach: "Telegram", time: "2d ago" },
    { name: "Liu Wei", email: "liu@megacorp.cn", type: "Customer", outreach: "Email", time: "3d ago" },
  ],
  badgeText: "93,747 contacts. Zero data entry.",
};

export const PeopleCRMScene: React.FC<PeopleCRMSceneProps> = ({
  totalContacts,
  contacts,
  badgeText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Counter animation
  const counterDuration = Math.round(2 * fps);
  const counterRaw = interpolate(frame, [10, counterDuration], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const counterT = easeOutCubic(counterRaw);
  const displayCount = Math.round(counterT * totalContacts).toLocaleString();

  // Badge
  const badgeDelay = Math.round(3.5 * fps);
  const badgeOpacity = interpolate(
    frame,
    [badgeDelay, badgeDelay + Math.round(0.4 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const typeColor = (type: string): string => {
    const map: Record<string, string> = {
      Lead: BLUE,
      Customer: GREEN,
      Prospect: PURPLE,
    };
    return map[type] || GRAY;
  };

  return (
    <AbsoluteFill style={{ backgroundColor: "#f8f9fb" }}>
      <AbsoluteFill style={{ padding: "50px 60px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 24,
            width: "100%",
            height: "100%",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
            }}
          >
            <div
              style={{
                fontSize: 44,
                fontWeight: 800,
                fontFamily: FONT,
                color: "#0f172a",
              }}
            >
              People
            </div>
            <div
              style={{
                padding: "6px 20px",
                borderRadius: 100,
                backgroundColor: `${BLUE}15`,
                fontSize: 32,
                fontWeight: 800,
                color: BLUE,
                fontFamily: FONT,
              }}
            >
              {displayCount}
            </div>
          </div>

          {/* Table header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "12px 24px",
              fontSize: 16,
              fontWeight: 600,
              color: GRAY,
              fontFamily: FONT,
              borderBottom: "1px solid #e2e8f0",
            }}
          >
            <div style={{ flex: 2 }}>Name</div>
            <div style={{ flex: 2 }}>Email</div>
            <div style={{ flex: 1 }}>Type</div>
            <div style={{ flex: 1 }}>Channel</div>
            <div style={{ flex: 1, textAlign: "right" as const }}>Last Activity</div>
          </div>

          {/* Contact rows */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              flex: 1,
            }}
          >
            {contacts.map((contact, i: number) => {
              const rowDelay = Math.round(0.6 * fps + i * 5);
              const rawT = interpolate(
                frame,
                [rowDelay, rowDelay + Math.round(0.4 * fps)],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
              );
              const t = easeOutCubic(rawT);
              const rowX = interpolate(t, [0, 1], [40, 0]);
              const clr = typeColor(contact.type);

              return (
                <div
                  key={i}
                  style={{
                    opacity: t,
                    transform: `translateX(${rowX}px)`,
                    display: "flex",
                    alignItems: "center",
                    gap: 16,
                    padding: "16px 24px",
                    backgroundColor: WHITE,
                    borderRadius: 10,
                    marginBottom: 2,
                  }}
                >
                  <div style={{ flex: 2, display: "flex", alignItems: "center", gap: 12 }}>
                    <div
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: 18,
                        backgroundColor: `${clr}20`,
                        display: "flex",
                        justifyContent: "center",
                        alignItems: "center",
                        fontSize: 16,
                        fontWeight: 700,
                        color: clr,
                        fontFamily: FONT,
                        flexShrink: 0,
                      }}
                    >
                      {contact.name.charAt(0)}
                    </div>
                    <span
                      style={{
                        fontSize: 19,
                        fontWeight: 600,
                        color: "#0f172a",
                        fontFamily: FONT,
                      }}
                    >
                      {contact.name}
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 2,
                      fontSize: 17,
                      color: GRAY,
                      fontFamily: FONT,
                    }}
                  >
                    {contact.email}
                  </div>
                  <div style={{ flex: 1 }}>
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        color: clr,
                        fontFamily: FONT,
                        padding: "3px 10px",
                        borderRadius: 6,
                        backgroundColor: `${clr}12`,
                      }}
                    >
                      {contact.type}
                    </span>
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: 16,
                      color: GRAY,
                      fontFamily: FONT,
                    }}
                  >
                    {contact.outreach}
                  </div>
                  <div
                    style={{
                      flex: 1,
                      fontSize: 16,
                      color: GRAY,
                      fontFamily: FONT,
                      textAlign: "right" as const,
                    }}
                  >
                    {contact.time}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Badge */}
          <div
            style={{
              opacity: badgeOpacity,
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                padding: "14px 40px",
                borderRadius: 100,
                background: `linear-gradient(135deg, ${GOLD}, #b8922e)`,
                boxShadow: `0 6px 24px ${GOLD}30`,
              }}
            >
              <span
                style={{
                  fontSize: 22,
                  fontWeight: 700,
                  color: WHITE,
                  fontFamily: FONT,
                }}
              >
                {badgeText}
              </span>
            </div>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 7: CostComparisonScene ──────────────────────────────────────

export type CostComparisonSceneProps = z.infer<typeof costComparisonSceneSchema>;

export const DEFAULT_COST_COMPARISON_PROPS: CostComparisonSceneProps = {
  oldItems: [
    { label: "LinkedIn Tool", cost: 99 },
    { label: "Email Outreach", cost: 79 },
    { label: "WhatsApp API", cost: 45 },
    { label: "Instagram DMs", cost: 29 },
    { label: "CRM Platform", cost: 89 },
    { label: "Virtual Assistant", cost: 800 },
  ],
  oldTotal: "$1,141/mo",
  oldAnnual: "$13,692/yr",
  newPlatformName: "ACA Platform",
  newMonthly: "$199/mo",
  newFeatures: "All 6 channels + CRM + AI content + Autopilots",
  newAnnual: "$2,388/yr",
  savingsText: "Save $11,304/year",
};

export const CostComparisonScene: React.FC<CostComparisonSceneProps> = ({
  oldItems,
  oldTotal,
  oldAnnual,
  newPlatformName,
  newMonthly,
  newFeatures,
  newAnnual,
  savingsText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Column headers
  const leftHeaderOpacity = interpolate(frame, [5, 20], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const rightHeaderDelay = Math.round(0.3 * fps);
  const rightHeaderOpacity = interpolate(
    frame,
    [rightHeaderDelay, rightHeaderDelay + 15],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Totals
  const totalDelay = Math.round(2.5 * fps);
  const totalProgress = spring({
    frame,
    fps,
    delay: totalDelay,
    config: { damping: 14, stiffness: 100 },
  });

  // Savings badge
  const savingsDelay = Math.round(3.5 * fps);
  const savingsProgress = spring({
    frame,
    fps,
    delay: savingsDelay,
    config: { damping: 12, stiffness: 80 },
  });
  const savingsScale = interpolate(savingsProgress, [0, 1], [0.7, 1]);
  const savingsOpacity = interpolate(savingsProgress, [0, 1], [0, 1]);

  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(ellipse at 50% 40%, #1a1030 0%, ${DARK_BG} 60%)`,
      }}
    >
      <AbsoluteFill style={{ padding: "60px 80px" }}>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 32,
            width: "100%",
            height: "100%",
            alignItems: "center",
          }}
        >
          {/* Title */}
          <div
            style={{
              fontSize: 48,
              fontWeight: 800,
              color: WHITE,
              fontFamily: FONT,
              textAlign: "center" as const,
              opacity: leftHeaderOpacity,
            }}
          >
            The Math Speaks For Itself
          </div>

          {/* Two columns */}
          <div
            style={{
              display: "flex",
              gap: 40,
              flex: 1,
              width: "100%",
              maxWidth: 1400,
            }}
          >
            {/* OLD column */}
            <div
              style={{
                flex: 1,
                opacity: leftHeaderOpacity,
                display: "flex",
                flexDirection: "column",
                gap: 12,
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: RED,
                  fontFamily: FONT,
                  textAlign: "center" as const,
                  marginBottom: 8,
                }}
              >
                Without ACA
              </div>

              {oldItems.map((item, i: number) => {
                const itemDelay = Math.round(0.4 * fps + i * 5);
                const rawT = interpolate(
                  frame,
                  [itemDelay, itemDelay + Math.round(0.3 * fps)],
                  [0, 1],
                  { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                );
                const t = easeOutCubic(rawT);

                return (
                  <div
                    key={i}
                    style={{
                      opacity: t,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "14px 24px",
                      backgroundColor: `${RED}10`,
                      borderRadius: 12,
                      border: `1px solid ${RED}20`,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 20,
                        color: GRAY,
                        fontFamily: FONT,
                      }}
                    >
                      {item.label}
                    </span>
                    <span
                      style={{
                        fontSize: 22,
                        fontWeight: 700,
                        color: RED,
                        fontFamily: FONT,
                      }}
                    >
                      ${item.cost}/mo
                    </span>
                  </div>
                );
              })}

              {/* Old total */}
              <div
                style={{
                  opacity: interpolate(totalProgress, [0, 1], [0, 1]),
                  marginTop: 12,
                  padding: "16px 24px",
                  borderRadius: 12,
                  backgroundColor: `${RED}20`,
                  border: `2px solid ${RED}40`,
                  textAlign: "center" as const,
                }}
              >
                <div style={{ fontSize: 36, fontWeight: 900, color: RED, fontFamily: FONT }}>
                  {oldTotal}
                </div>
                <div style={{ fontSize: 18, color: GRAY, fontFamily: FONT, marginTop: 4 }}>
                  {oldAnnual}
                </div>
              </div>
            </div>

            {/* Divider */}
            <div
              style={{
                width: 2,
                backgroundColor: "rgba(255,255,255,0.1)",
                borderRadius: 1,
              }}
            />

            {/* NEW column */}
            <div
              style={{
                flex: 1,
                opacity: rightHeaderOpacity,
                display: "flex",
                flexDirection: "column",
                gap: 12,
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  fontSize: 28,
                  fontWeight: 700,
                  color: GREEN,
                  fontFamily: FONT,
                  textAlign: "center" as const,
                  marginBottom: 8,
                }}
              >
                With ACA
              </div>

              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 20,
                  padding: "32px 28px",
                  backgroundColor: `${GREEN}08`,
                  borderRadius: 16,
                  border: `2px solid ${GREEN}30`,
                }}
              >
                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 800,
                    color: WHITE,
                    fontFamily: FONT,
                    textAlign: "center" as const,
                  }}
                >
                  {newPlatformName}
                </div>
                <div
                  style={{
                    fontSize: 60,
                    fontWeight: 900,
                    color: GREEN,
                    fontFamily: FONT,
                    textAlign: "center" as const,
                    textShadow: `0 0 40px ${GREEN}30`,
                  }}
                >
                  {newMonthly}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    color: GRAY,
                    fontFamily: FONT,
                    textAlign: "center" as const,
                    lineHeight: 1.5,
                  }}
                >
                  {newFeatures}
                </div>

                {/* New total */}
                <div
                  style={{
                    opacity: interpolate(totalProgress, [0, 1], [0, 1]),
                    marginTop: 8,
                    padding: "14px 24px",
                    borderRadius: 12,
                    backgroundColor: `${GREEN}15`,
                    border: `2px solid ${GREEN}30`,
                    textAlign: "center" as const,
                  }}
                >
                  <div style={{ fontSize: 32, fontWeight: 900, color: GREEN, fontFamily: FONT }}>
                    {newAnnual}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Savings badge */}
          <div
            style={{
              opacity: savingsOpacity,
              transform: `scale(${savingsScale})`,
              padding: "18px 60px",
              borderRadius: 100,
              background: `linear-gradient(135deg, ${GOLD}, #b8922e)`,
              boxShadow: `0 8px 32px ${GOLD}40`,
            }}
          >
            <span
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: WHITE,
                fontFamily: FONT,
                letterSpacing: 1,
              }}
            >
              {savingsText}
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ── Scene 8: CTAScene ─────────────────────────────────────────────────

export type CTASceneProps = z.infer<typeof ctaSceneSchema>;

export const DEFAULT_CTA_PROPS: CTASceneProps = {
  headline: "Stop Paying $3.50",
  highlightLine: "Start Paying $0.66",
  subtitle: "One platform. Six channels. Unlimited conversations.",
  stats: [
    { value: "81%", label: "Cost Reduction" },
    { value: "6", label: "Channels" },
    { value: "$199", label: "Per Month" },
    { value: "0", label: "Manual Work" },
  ],
  ctaText: 'DM me "INBOX" to see it live',
};

export const CTAScene: React.FC<CTASceneProps> = ({
  headline,
  highlightLine,
  subtitle,
  stats,
  ctaText,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  // Headline spring
  const headlineProgress = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 80 },
  });
  const headlineOpacity = interpolate(headlineProgress, [0, 1], [0, 1]);
  const headlineScale = interpolate(headlineProgress, [0, 1], [0.85, 1]);

  // Highlight line
  const highlightProgress = spring({
    frame,
    fps,
    delay: Math.round(0.5 * fps),
    config: { damping: 12, stiffness: 100 },
  });
  const highlightOpacity = interpolate(highlightProgress, [0, 1], [0, 1]);

  // Subtitle
  const subtitleDelay = Math.round(1 * fps);
  const subtitleOpacity = interpolate(
    frame,
    [subtitleDelay, subtitleDelay + Math.round(0.5 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Stats fade in
  const statsDelay = Math.round(1.8 * fps);
  const statsOpacity = interpolate(
    frame,
    [statsDelay, statsDelay + Math.round(0.5 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // CTA button pulse
  const ctaDelay = Math.round(3 * fps);
  const ctaOpacity = interpolate(
    frame,
    [ctaDelay, ctaDelay + Math.round(0.5 * fps)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const pulseCycle = Math.round(1.5 * fps);
  const pulse = frame > ctaDelay
    ? interpolate(
        frame % pulseCycle,
        [0, Math.round(pulseCycle / 2), pulseCycle],
        [1, 1.05, 1],
        { extrapolateRight: "clamp" }
      )
    : 1;

  return (
    <AbsoluteFill>
      {/* Dark bg with radial glow */}
      <AbsoluteFill
        style={{
          background: `radial-gradient(ellipse at 50% 40%, #1a1a3a 0%, ${DARK_BG} 60%)`,
        }}
      />
      {/* Gold glow orb */}
      <div
        style={{
          position: "absolute",
          width: 800,
          height: 800,
          borderRadius: "50%",
          background: `radial-gradient(circle, ${GOLD}15 0%, transparent 70%)`,
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          filter: "blur(80px)",
        }}
      />

      <AbsoluteFill
        style={{
          justifyContent: "center",
          alignItems: "center",
          padding: "60px 80px",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 28,
          }}
        >
          {/* Headline */}
          <div
            style={{
              opacity: headlineOpacity,
              transform: `scale(${headlineScale})`,
              fontSize: 72,
              fontWeight: 900,
              fontFamily: FONT,
              color: WHITE,
              textAlign: "center" as const,
              lineHeight: 1.1,
            }}
          >
            {headline}
          </div>

          {/* Highlight line */}
          <div
            style={{
              opacity: highlightOpacity,
              fontSize: 80,
              fontWeight: 900,
              fontFamily: FONT,
              color: GREEN,
              textAlign: "center" as const,
              lineHeight: 1.1,
              textShadow: `0 0 60px ${GREEN}40`,
            }}
          >
            {highlightLine}
          </div>

          {/* Subtitle */}
          <div
            style={{
              opacity: subtitleOpacity,
              fontSize: 32,
              fontWeight: 500,
              fontFamily: FONT,
              color: GRAY,
              textAlign: "center" as const,
              maxWidth: 800,
              lineHeight: 1.4,
            }}
          >
            {subtitle}
          </div>

          {/* Stats row */}
          <div
            style={{
              opacity: statsOpacity,
              display: "flex",
              gap: 40,
              marginTop: 16,
            }}
          >
            {stats.map((stat, i: number) => (
              <div
                key={i}
                style={{
                  textAlign: "center" as const,
                  minWidth: 120,
                }}
              >
                <div
                  style={{
                    fontSize: 48,
                    fontWeight: 900,
                    color: GOLD,
                    fontFamily: FONT,
                  }}
                >
                  {stat.value}
                </div>
                <div
                  style={{
                    fontSize: 18,
                    color: GRAY,
                    fontFamily: FONT,
                    marginTop: 4,
                  }}
                >
                  {stat.label}
                </div>
              </div>
            ))}
          </div>

          {/* CTA button */}
          <div
            style={{
              opacity: ctaOpacity,
              transform: `scale(${pulse})`,
              marginTop: 20,
              padding: "22px 60px",
              borderRadius: 100,
              background: `linear-gradient(135deg, ${GOLD}, #c49b38)`,
              boxShadow: `0 8px 40px ${GOLD}50`,
            }}
          >
            <span
              style={{
                fontSize: 30,
                fontWeight: 800,
                color: WHITE,
                fontFamily: FONT,
                letterSpacing: 0.5,
              }}
            >
              {ctaText}
            </span>
          </div>
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
