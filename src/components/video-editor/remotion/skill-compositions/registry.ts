// ── Skill Composition Registry ──────────────────────────────────────
// Every Remotion composition available as a "skill" that the AI agent
// can assign to a scene. Add new compositions here + the matching
// React component in this folder.

import type { z } from "zod";
import { COMPOSITION_SCHEMAS } from "./schemas";

export interface SkillCompositionDef {
  /** Unique ID used by the agent and stored in VideoScene */
  id: string;
  /** Human-readable label shown in the UI */
  label: string;
  /** What this composition is for (shown to the agent in its system prompt) */
  description: string;
  /** The aspect ratios this composition supports */
  aspectRatios: Array<"portrait" | "landscape" | "square">;
  /** Default duration in seconds */
  defaultDuration: number;
  /** The props schema description (for the agent's system prompt) */
  propsSchema: string;
  /** Zod schema for type-safe props editing in the UI */
  schema?: z.ZodObject<z.ZodRawShape>;
  /** Default props the agent can start from */
  defaultProps: Record<string, unknown>;
}

export const SKILL_COMPOSITIONS: SkillCompositionDef[] = [
  {
    id: "openclaw_logo_reveal",
    label: "OpenClaw Logo Reveal",
    description:
      "Animated logo reveal for OpenClaw pour LinkedIn. Mascot drops in with a bouncy spring, wordmark scales up, LinkedIn badge slides in, tagline fades up, shine sweep finishes it off.",
    aspectRatios: ["square"],
    defaultDuration: 6,
    propsSchema: `{
  imageUrl: string,   // Public URL of the OpenClaw logo image
  tagline?: string,   // Tagline text (default: "L'IA qui développe votre entreprise.")
}`,
    defaultProps: {
      imageUrl: "",
      tagline: "L'IA qui développe votre entreprise.",
    },
  },
  {
    id: "ai_news_video",
    label: "AI News Roundup",
    description:
      "A dark-themed news broadcast composition with animated intro, per-item scenes with slide/fade transitions, and a branded outro. Best for 'top 5' or 'this week in X' formats.",
    aspectRatios: ["portrait", "landscape"],
    defaultDuration: 38,
    propsSchema: `{
  title: string,          // e.g. "AI NEWS"
  date: string,           // e.g. "March 22, 2026"
  newsItems: Array<{
    headline: string,     // Short punchy headline (< 60 chars)
    summary: string,      // 1-2 sentence summary (< 200 chars)
    source: string,       // Source name (e.g. "OpenAI", "Google DeepMind")
    icon: string,         // Single emoji
    accentColor: string,  // Hex color (e.g. "#10b981")
  }>
}`,
    defaultProps: {
      title: "AI NEWS",
      date: "Today",
      newsItems: [],
    },
  },
  // ── Inbox Cost Scenes ──────────────────────────────────────────────
  {
    id: "inbox_cost_hook",
    label: "Inbox Cost - Hook",
    description:
      "Price comparison hook scene. Old price fades in and gets struck through, new price springs in below, savings badge fades up. Dark background with grid.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  oldPrice: string,    // e.g. "$3.50"
  newPrice: string,    // e.g. "$0.66"
  subtitle: string,    // e.g. "per conversation"
  savingsText: string, // e.g. "81% Cost Reduction - Save $11,304/year"
}`,
    defaultProps: {
      oldPrice: "$3.50",
      newPrice: "$0.66",
      subtitle: "per conversation",
      savingsText: "81% Cost Reduction - Save $11,304/year",
    },
  },
  {
    id: "inbox_cost_old_stack",
    label: "Inbox Cost - Old Stack",
    description:
      "Shows the current tool stack with 6 tool cards and their individual costs, ending with a total cost bar. Dark background.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  title: string,
  tools: Array<{ name: string, cost: string, icon: string, color: string }>,
  totalCost: string,
}`,
    defaultProps: {
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
    },
  },
  {
    id: "inbox_cost_inbox",
    label: "Inbox Cost - Unified Inbox",
    description:
      "Mockup of a unified inbox UI showing conversations from all channels (LinkedIn, Email, WhatsApp, Instagram, Telegram). Light background with ACA styling.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  conversationCount: string,
  conversations: Array<{ name: string, channel: string, preview: string, time: string }>,
  badgeText: string,
}`,
    defaultProps: {
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
    },
  },
  {
    id: "inbox_cost_sequences",
    label: "Inbox Cost - Email Sequences",
    description:
      "Email sequences dashboard showing active sequences with enrollment and completion counts. Light background.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  sequences: Array<{ name: string, steps: number, enrolled: string, done: string, status: string }>,
  totalBadge: string,
}`,
    defaultProps: {
      sequences: [
        { name: "Cold Outreach - SaaS Founders", steps: 7, enrolled: "3,241", done: "1,890", status: "Active" },
        { name: "Follow-up - Demo Booked", steps: 4, enrolled: "2,105", done: "1,432", status: "Active" },
        { name: "Re-engagement - 30 Days", steps: 5, enrolled: "4,209", done: "2,876", status: "Active" },
        { name: "Onboarding Welcome", steps: 3, enrolled: "2,400", done: "1,988", status: "Paused" },
      ],
      totalBadge: "11,955 leads enrolled automatically",
    },
  },
  {
    id: "inbox_cost_autopilots",
    label: "Inbox Cost - Autopilots",
    description:
      "Autopilots dashboard showing stat cards (active, paused, generated, published) and autopilot entries with content metrics. Light background.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  stats: Array<{ label: string, value: string, color: string }>,
  autopilots: Array<{ name: string, blueprints: number, destinations: number, generated: number, published: number, pool: string }>,
  badgeText: string,
}`,
    defaultProps: {
      stats: [
        { label: "Active", value: "4", color: "#22c55e" },
        { label: "Paused", value: "0", color: "#94a3b8" },
        { label: "Generated", value: "80", color: "#3b82f6" },
        { label: "Published", value: "155", color: "#a78bfa" },
      ],
      autopilots: [
        { name: "SaaS Growth Tips", blueprints: 3, destinations: 4, generated: 32, published: 58, pool: "120 ideas" },
        { name: "AI News Digest", blueprints: 2, destinations: 3, generated: 28, published: 52, pool: "85 ideas" },
        { name: "Case Studies", blueprints: 1, destinations: 2, generated: 20, published: 45, pool: "45 ideas" },
      ],
      badgeText: "Content on autopilot. Zero manual work.",
    },
  },
  {
    id: "inbox_cost_people_crm",
    label: "Inbox Cost - People CRM",
    description:
      "CRM contacts table with animated counter, contact rows with type badges and channel info. Light background.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  totalContacts: number,
  contacts: Array<{ name: string, email: string, type: string, outreach: string, time: string }>,
  badgeText: string,
}`,
    defaultProps: {
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
    },
  },
  {
    id: "inbox_cost_comparison",
    label: "Inbox Cost - Cost Comparison",
    description:
      "Side-by-side cost comparison: old stack ($1,141/mo) vs ACA ($199/mo). Items animate in, totals appear, gold savings badge. Dark background.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  oldItems: Array<{ label: string, cost: number }>,
  oldTotal: string,
  oldAnnual: string,
  newPlatformName: string,
  newMonthly: string,
  newFeatures: string,
  newAnnual: string,
  savingsText: string,
}`,
    defaultProps: {
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
    },
  },
  {
    id: "inbox_cost_cta",
    label: "Inbox Cost - CTA",
    description:
      "Call to action scene with headline, highlight price, stats row, and pulsing CTA button. Dark background with radial gold glow.",
    aspectRatios: ["landscape"],
    defaultDuration: 6,
    propsSchema: `{
  headline: string,
  highlightLine: string,
  subtitle: string,
  stats: Array<{ value: string, label: string }>,
  ctaText: string,
}`,
    defaultProps: {
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
    },
  },
  // ── R.I.P SaaS - Viral LinkedIn Video ─────────────────────────────
  {
    id: "rip_saas_video",
    label: "R.I.P SaaS - AI Agents Video",
    description:
      "Viral LinkedIn video about AI agents replacing SaaS tools. 7 scenes: glitch hook, crumbling tool stack, tools-to-agents morph, agent breakdown cards, dramatic cost comparison, typewriter insight quote, and gold CTA with stats. Dark cyberpunk aesthetic with particles and grid backgrounds.",
    aspectRatios: ["portrait", "landscape", "square"],
    defaultDuration: 34,
    propsSchema: `{
  hookLine1: string,          // e.g. "R.I.P SaaS."
  hookLine2: string,          // e.g. "AI agents just made half your tech stack obsolete."
  monthlyBefore: string,      // e.g. "$2,400"
  monthlyAfter: string,       // e.g. "$200"
  toolsReplaced: number,      // e.g. 11
  agentsUsed: number,         // e.g. 4
  agents: Array<{
    label: string,            // e.g. "CRM Agent"
    description: string,      // e.g. "Auto-updates itself"
    icon: string,             // Single emoji
    color: string,            // Hex color
  }>,
  insightLine1: string,       // e.g. "You don't need a dashboard."
  insightLine2: string,       // e.g. "You need an outcome."
  ctaHeadline: string,        // e.g. "Agents as a Service"
  ctaSubtext: string,         // Subtext under headline
  ctaKeyword: string,         // e.g. "AGENTS"
  stats: Array<{ value: string, label: string }>,
}`,
    defaultProps: {
      hookLine1: "R.I.P SaaS.",
      hookLine2: "AI agents just made half your tech stack obsolete.",
      monthlyBefore: "$2,400",
      monthlyAfter: "$200",
      toolsReplaced: 11,
      agentsUsed: 4,
      agents: [
        { label: "CRM Agent", description: "Auto-updates itself", icon: "\u{1F4CA}", color: "#6366f1" },
        { label: "Outreach Agent", description: "Writes AND optimizes sequences", icon: "\u{1F4E7}", color: "#10b981" },
        { label: "Scoring Agent", description: "Real-time signals, not static rules", icon: "\u{1F3AF}", color: "#f59e0b" },
        { label: "Reporting Agent", description: "Just tells you what matters", icon: "\u{1F9E0}", color: "#ef4444" },
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
    },
  },
];

// Attach Zod schemas to each composition from the schemas module
for (const comp of SKILL_COMPOSITIONS) {
  comp.schema = COMPOSITION_SCHEMAS[comp.id];
}

/** Look up a skill composition def by ID */
export function getSkillComposition(id: string): SkillCompositionDef | undefined {
  return SKILL_COMPOSITIONS.find((c) => c.id === id);
}
