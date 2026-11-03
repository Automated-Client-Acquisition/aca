// ── Zod Schemas for Skill Compositions ──────────────────────────────
// Each composition defines a Zod schema so the PropertyEditor can
// generate type-aware form controls automatically.

import { z } from "zod";
import { zColor } from "@remotion/zod-types";

// ── OpenClaw Logo Reveal ────────────────────────────────────────────

export const openclawLogoRevealSchema = z.object({
  imageUrl: z.string().describe("Public URL of the logo image"),
  tagline: z.string().optional().describe("Brand tagline"),
});

// ── AI News Video ───────────────────────────────────────────────────

const newsItemSchema = z.object({
  headline: z.string().describe("Short punchy headline (< 60 chars)"),
  summary: z.string().describe("1-2 sentence summary (< 200 chars)"),
  source: z.string().describe("Source name (e.g. OpenAI)"),
  icon: z.string().describe("Single emoji"),
  accentColor: zColor().describe("Accent color"),
});

export const aiNewsVideoSchema = z.object({
  title: z.string().describe("Video title"),
  date: z.string().describe("Date string"),
  newsItems: z.array(newsItemSchema).describe("News items"),
});

// ── Inbox Cost: Hook ────────────────────────────────────────────────

export const hookSceneSchema = z.object({
  oldPrice: z.string().describe("Old price text"),
  newPrice: z.string().describe("New price text"),
  subtitle: z.string().describe("Subtitle text"),
  savingsText: z.string().describe("Savings badge text"),
});

// ── Inbox Cost: Old Stack ───────────────────────────────────────────

const oldStackToolSchema = z.object({
  name: z.string().describe("Tool name"),
  cost: z.string().describe("Monthly cost"),
  icon: z.string().describe("Short icon label"),
  color: zColor().describe("Brand color"),
});

export const oldStackSceneSchema = z.object({
  title: z.string().describe("Section title"),
  tools: z.array(oldStackToolSchema).describe("Tool cards"),
  totalCost: z.string().describe("Total monthly cost"),
});

// ── Inbox Cost: Unified Inbox ───────────────────────────────────────

const inboxConversationSchema = z.object({
  name: z.string().describe("Contact name"),
  channel: z.string().describe("Channel (LinkedIn, Email, etc.)"),
  preview: z.string().describe("Message preview"),
  time: z.string().describe("Time ago"),
});

export const inboxSceneSchema = z.object({
  conversationCount: z.string().describe("Total conversations"),
  conversations: z.array(inboxConversationSchema).describe("Conversation list"),
  badgeText: z.string().describe("Bottom badge text"),
});

// ── Inbox Cost: Sequences ───────────────────────────────────────────

const sequenceItemSchema = z.object({
  name: z.string().describe("Sequence name"),
  steps: z.number().describe("Number of steps"),
  enrolled: z.string().describe("Enrolled count"),
  done: z.string().describe("Completed count"),
  status: z.string().describe("Status (Active/Paused)"),
});

export const sequencesSceneSchema = z.object({
  sequences: z.array(sequenceItemSchema).describe("Sequence list"),
  totalBadge: z.string().describe("Bottom badge text"),
});

// ── Inbox Cost: Autopilots ──────────────────────────────────────────

const autopilotStatSchema = z.object({
  label: z.string().describe("Stat label"),
  value: z.string().describe("Stat value"),
  color: zColor().describe("Stat color"),
});

const autopilotItemSchema = z.object({
  name: z.string().describe("Autopilot name"),
  blueprints: z.number().describe("Blueprint count"),
  destinations: z.number().describe("Destination count"),
  generated: z.number().describe("Generated count"),
  published: z.number().describe("Published count"),
  pool: z.string().describe("Pool size text"),
});

export const autopilotsSceneSchema = z.object({
  stats: z.array(autopilotStatSchema).describe("Stat cards"),
  autopilots: z.array(autopilotItemSchema).describe("Autopilot entries"),
  badgeText: z.string().describe("Bottom badge text"),
});

// ── Inbox Cost: People CRM ──────────────────────────────────────────

const crmContactSchema = z.object({
  name: z.string().describe("Contact name"),
  email: z.string().describe("Email address"),
  type: z.string().describe("Contact type (Lead/Customer/Prospect)"),
  outreach: z.string().describe("Outreach channel"),
  time: z.string().describe("Time ago"),
});

export const peopleCRMSceneSchema = z.object({
  totalContacts: z.number().describe("Total contact count"),
  contacts: z.array(crmContactSchema).describe("Contact rows"),
  badgeText: z.string().describe("Bottom badge text"),
});

// ── Inbox Cost: Cost Comparison ─────────────────────────────────────

const costItemSchema = z.object({
  label: z.string().describe("Item label"),
  cost: z.number().describe("Monthly cost"),
});

export const costComparisonSceneSchema = z.object({
  oldItems: z.array(costItemSchema).describe("Old stack cost items"),
  oldTotal: z.string().describe("Old total monthly"),
  oldAnnual: z.string().describe("Old annual cost"),
  newPlatformName: z.string().describe("New platform name"),
  newMonthly: z.string().describe("New monthly price"),
  newFeatures: z.string().describe("Features summary"),
  newAnnual: z.string().describe("New annual cost"),
  savingsText: z.string().describe("Savings text"),
});

// ── Inbox Cost: CTA ─────────────────────────────────────────────────

const ctaStatSchema = z.object({
  value: z.string().describe("Stat value"),
  label: z.string().describe("Stat label"),
});

export const ctaSceneSchema = z.object({
  headline: z.string().describe("Main headline"),
  highlightLine: z.string().describe("Highlighted price line"),
  subtitle: z.string().describe("Subtitle text"),
  stats: z.array(ctaStatSchema).describe("Stats row"),
  ctaText: z.string().describe("CTA button text"),
});

// ── R.I.P SaaS Video ───────────────────────────────────────────────

const agentItemSchema = z.object({
  label: z.string().describe("Agent name"),
  description: z.string().describe("Agent description"),
  icon: z.string().describe("Single emoji"),
  color: zColor().describe("Card color"),
});

const statItemSchema = z.object({
  value: z.string().describe("Stat value"),
  label: z.string().describe("Stat label"),
});

export const ripSaaSVideoSchema = z.object({
  hookLine1: z.string().describe("Hook line 1"),
  hookLine2: z.string().describe("Hook line 2"),
  monthlyBefore: z.string().describe("Monthly cost before"),
  monthlyAfter: z.string().describe("Monthly cost after"),
  toolsReplaced: z.number().describe("Tools replaced count"),
  agentsUsed: z.number().describe("Agents used count"),
  agents: z.array(agentItemSchema).describe("Agent cards"),
  insightLine1: z.string().describe("Insight quote line 1"),
  insightLine2: z.string().describe("Insight quote line 2"),
  ctaHeadline: z.string().describe("CTA headline"),
  ctaSubtext: z.string().describe("CTA subtext"),
  ctaKeyword: z.string().describe("CTA keyword"),
  stats: z.array(statItemSchema).describe("CTA stats"),
});

// ── Schema lookup by composition ID ─────────────────────────────────

export const COMPOSITION_SCHEMAS: Record<string, z.ZodObject<z.ZodRawShape>> = {
  openclaw_logo_reveal: openclawLogoRevealSchema,
  ai_news_video: aiNewsVideoSchema,
  inbox_cost_hook: hookSceneSchema,
  inbox_cost_old_stack: oldStackSceneSchema,
  inbox_cost_inbox: inboxSceneSchema,
  inbox_cost_sequences: sequencesSceneSchema,
  inbox_cost_autopilots: autopilotsSceneSchema,
  inbox_cost_people_crm: peopleCRMSceneSchema,
  inbox_cost_comparison: costComparisonSceneSchema,
  inbox_cost_cta: ctaSceneSchema,
  rip_saas_video: ripSaaSVideoSchema,
};

/** Get the Zod schema for a composition by ID */
export function getCompositionSchema(id: string): z.ZodObject<z.ZodRawShape> | undefined {
  return COMPOSITION_SCHEMAS[id];
}
