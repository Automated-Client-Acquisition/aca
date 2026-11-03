import type { SEOOptions } from "@/hooks/useSEO";
import { SELF_HOSTED } from "@/config/site";

/**
 * Head metadata for the static marketing/utility routes that do not call useSEO
 * themselves. <RouteSEO /> (mounted once inside the router) looks the current
 * pathname up here, so the prerendered HTML and the client render agree and no
 * page falls back to the shared index.html title.
 *
 * Pages with their own useSEO (blog, playbooks, signals company, quote, book,
 * community, how-we-work, about) are deliberately NOT listed: two Helmet blocks
 * for one page would fight over the same tags.
 *
 * Titles get " | ACA" appended by useSEO (keep them under ~54 chars). `noindex`
 * routes are funnel steps, onboarding flows and duplicates that should never
 * compete with the canonical page for the same intent.
 */
export const PAGE_META: Record<string, SEOOptions> = {
  "/": {
    title: "ACA: Cold email + LinkedIn outreach. $67/month.",
    absoluteTitle: true,
    description:
      "Run cold email and LinkedIn campaigns, manage Microsoft 365 infrastructure, create content and capture leads. One $67/month platform. Bring your own API keys; provider usage extra.",
  },
  "/pricing": {
    title: "Pricing: Operator $67/mo, White-label $297/mo",
    description:
      "Flat pricing with your own keys and no per-credit fees. Operator from $67/mo, White-label from $297/mo. Unlimited leads, seats, campaigns and content, 0% markup on AI tokens.",
  },
  "/tools": {
    title: "Free outbound and lead generation tools",
    description:
      "Free tools built on the same engine that powers ACA. Use them without signing up to find leads, sharpen your outreach and work out what your stack costs.",
  },
  "/agents": {
    title: "Learn to build AI agents that run your business",
    description:
      "A step-by-step course plan, from what an agent is to a library of agents you built yourself. Set one up safely, give it an Obsidian second brain, then package and sell it.",
  },
  "/mcp": {
    title: "ACA MCP: connect ACA to any AI",
    description:
      "Connect ACA to Claude, ChatGPT or any MCP client and generate warm inbound and outbound leads straight from your prompts.",
  },
  "/mcp/commands": {
    title: "ACA Claude plugin: every command",
    description:
      "What each ACA slash command does in Claude, and what ACA replaces: cold email, LinkedIn automation, content, lead magnets, signals, mailbox infrastructure and integrations.",
  },
  "/developers": {
    title: "ACA API reference",
    description:
      "Create contacts, build lists, enroll leads and send messages with the ACA API. Full endpoint reference, authentication and examples.",
  },
  "/terms": {
    title: "Terms and conditions",
    description: "The terms and conditions for using Automated Client Acquisition (ACA).",
  },
  "/privacy": {
    title: "Privacy policy",
    description: "How Automated Client Acquisition (ACA) collects, uses and protects your data.",
  },
  "/support": {
    title: "Support",
    description:
      "Need a hand with Automated Client Acquisition? Contact the ACA team directly or browse answers to common questions.",
  },

  // Free lead-magnet landing pages
  "/free-hermes-linkedin-setter": {
    title: "Free LinkedIn appointment setter agent (Hermes)",
    description:
      "Get the exact Hermes agent prompt and setup guide for a LinkedIn appointment setter that finds in-market buyers, starts conversations and books meetings. You approve every message.",
  },
  "/free-google-maps-scraper": {
    title: "Free Google Maps scraper for local leads",
    description:
      "Get a list of 12 million businesses plus the Hermes scraper system that pulls any local niche off Google Maps, finds the decision-maker's email and verifies it. 100% free.",
  },
  "/free-sec-form4-agent": {
    title: "Free SEC Form 4 agent: reach insider sellers",
    description:
      "Exact prompts and a step-by-step guide for an agent that catches insider stock sales the day they are filed and returns a scored list from free public EDGAR filings.",
  },
  "/free-buying-signals-agent": {
    title: "Free buying signals agent for warm leads",
    description:
      "Exact prompts and a step-by-step guide for an agent that watches 428 sources for the buying signals you pick and alerts you with the account and the reason to reach out.",
  },
  "/free-reddit-engagement-agent": {
    title: "Free Reddit engagement agent for B2B buyers",
    description:
      "Exact prompts and a step-by-step guide for a Reddit agent that finds threads where buyers ask what to use and drafts replies in a real human voice.",
  },
  "/free-youtube-automation-agent": {
    title: "Free YouTube automation agent: a month of videos",
    description:
      "Exact prompts and a step-by-step guide for a YouTube agent that studies what already ranks in your niche, finds the gaps and writes a month of video scripts.",
  },
  "/free-seo-growth-agent": {
    title: "Free SEO growth agent: content and backlinks",
    description:
      "Exact prompts and a step-by-step guide for an SEO agent that writes content around what people search and goes and gets the backlinks itself.",
  },
  "/free-lead-pipeline-agent": {
    title: "Free lead pipeline agent: research and verify",
    description:
      "Exact prompts and a step-by-step guide for an agent that reads each lead's site and LinkedIn, keeps the ones that fit, verifies the email and loads them into your sequence.",
  },
  "/free-carousel-factory-agent": {
    title: "Free carousel factory agent for TikTok, IG, LinkedIn",
    description:
      "Exact prompts and a step-by-step guide for an agent that turns a Telegram message or a URL into an on-brand carousel and publishes it to all your accounts at once.",
  },

  // Cold-traffic sales pages
  "/kit": {
    title: "Launch an AI agent that finds local leads",
    description:
      "Launch an AI agent that pulls local businesses from Google Maps and finds the owners' emails automatically. Works even if you can't code and nobody knows your name.",
  },
  "/studio": {
    title: "Launch an AI agent that fills a faceless channel",
    description:
      "Point an AI agent at one niche and it researches topics and writes a month of video scripts. No face, no editing experience, no audience needed.",
  },
  "/radar": {
    title: "Launch an AI agent that finds buyers ready to buy",
    description:
      "An AI agent that watches funding rounds, new sales leaders, hiring sprees and launches, and hands you warm companies with a real reason to talk.",
  },

  // Duplicates and utility flows: keep out of the index
  "/home-classic": { title: "ACA (classic home)", noindex: true },
  "/autopilot-classic": { title: "Autopilot (classic view)", noindex: true },
  "/autopilot": { title: "Autopilot", noindex: true },
  "/get-started": { title: "Get started", noindex: true },
  "/sandbox": { title: "Sandbox", noindex: true },
  "/unsubscribe": { title: "Unsubscribe", noindex: true },
  "/kit/order": { title: "Order", noindex: true },
  "/kit/vault": { title: "Vault", noindex: true },
  "/kit/launch": { title: "Launch", noindex: true },
  "/kit/welcome": { title: "Welcome", noindex: true },
  "/studio/order": { title: "Order", noindex: true },
  "/studio/vault": { title: "Vault", noindex: true },
  "/studio/launch": { title: "Launch", noindex: true },
  "/studio/welcome": { title: "Welcome", noindex: true },
  "/radar/order": { title: "Order", noindex: true },
  "/radar/vault": { title: "Vault", noindex: true },
  "/radar/launch": { title: "Launch", noindex: true },
  "/radar/welcome": { title: "Welcome", noindex: true },
};

/** Onboarding wizard is per-playbook and per-user: never indexable. */
export function getPageMeta(pathname: string): SEOOptions | undefined {
  const path = pathname === "/" ? "/" : pathname.replace(/\/+$/, "");
  // A self-hosted install has no marketing site: / opens the app, so it gets
  // the app's name rather than ACA Cloud's pricing headline.
  if (SELF_HOSTED && path === "/") return { title: "ACA", absoluteTitle: true, noindex: true };
  if (PAGE_META[path]) return PAGE_META[path];
  if (path.startsWith("/onboard/playbook/")) return { title: "Onboarding", noindex: true };
  return undefined;
}
