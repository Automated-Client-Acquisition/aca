import { APP_URL, PUBLIC_SITE_DISPLAY, PUBLIC_SITE_URL } from "./site-config.ts";
// ============================================================================
// lead-magnet-drip.ts
// ----------------------------------------------------------------------------
// Content + rendering for the daily "agent library tour" nurture sequence that
// lead-magnet-drip-tick sends to signals_subscribers who opted into a free
// agent build. Modeled on the "here's a thing I built → grab the free
// walkthrough → come into ACA / the community" daily-showcase format.
//
// One showcase per agent, sent one per day. A subscriber is skipped past the
// showcase for the agent they themselves signed up for (they already got that
// deliverable), then a final "whole library + offer" email closes the tour.
// ============================================================================

const INK = "#15140F";
const ACCENT = "#D4361A";
const MUTED = "#6B6759";
const BONE = "#F2EEE6";
const PAPER = "#FFF8F4";
const RULE = "#E4DED0";

const SITE = PUBLIC_SITE_URL;
export const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";
export const TRIAL_URL =
  Deno.env.get("LEAD_MAGNET_TRIAL_URL") || `${APP_URL}/get-started`;

// Optional social proof: set SKOOL_MEMBER_COUNT (e.g. "650") to inject a hard
// number into the community CTA; otherwise we use a non-numeric phrasing so we
// never fabricate a count.
const MEMBER_COUNT = (Deno.env.get("SKOOL_MEMBER_COUNT") || "").trim();
const communityLine = MEMBER_COUNT
  ? `come build with ${MEMBER_COUNT}+ founders &amp; agencies doing the same`
  : `come build it with the founders &amp; agencies doing the same`;

// source → env var holding that agent's deliverable URL (mirrors the map in
// submit-playbook-lead). Falls back to Skool until a real doc is set.
const DELIVERABLE_ENV: Record<string, string> = {
  "hermes-agent": "HERMES_DELIVERABLE_URL",
  "maps-scraper": "MAPS_DELIVERABLE_URL",
  "lead-pipeline-agent": "LEAD_PIPELINE_DELIVERABLE_URL",
  "buying-signals-agent": "SIGNALS_AGENT_DELIVERABLE_URL",
  "carousel-agent": "CAROUSEL_AGENT_DELIVERABLE_URL",
  "seo-agent": "SEO_AGENT_DELIVERABLE_URL",
  "youtube-agent": "YOUTUBE_AGENT_DELIVERABLE_URL",
  "reddit-agent": "REDDIT_AGENT_DELIVERABLE_URL",
  "sec-form4-agent": "SEC_FORM4_DELIVERABLE_URL",
};

export function deliverableUrl(source: string): string {
  const env = DELIVERABLE_ENV[source];
  return (env && Deno.env.get(env)) || SKOOL_URL;
}

export interface Showcase {
  key: string; // subscriber `source`
  label: string; // "SEC Form 4 agent"
  teaser: string; // one line for the "tomorrow / in case you missed" P.S.
  subject: string;
  lead: string; // "a X agent I built in Hermes that…"
  how: string[]; // 3–4 steps
  vsOld: string;
  test: string; // "To test it, …"
  useCases: string[]; // "→ …" lines
}

// Ordered library tour — broad appeal first, niche last.
export const SHOWCASES: Showcase[] = [
  {
    key: "maps-scraper",
    label: "Google Maps scraper",
    teaser: "the Google Maps scraper that pulls 200 local leads before your coffee's cold",
    subject: "the Google Maps scraper I built (200 local leads in ~2 min)",
    lead:
      "a Google Maps lead scraper I built in Hermes that turns any niche + city into a clean list of local businesses — names, phones, emails, websites, review counts — in a couple of minutes.",
    how: [
      "You give it a niche, a city, and how many results you want.",
      "It scrapes Google Maps in the background while the leads populate — name, phone, email, website, review count for each.",
      "It finds the decision-maker's real email (not a generic info@) and verifies it before it hits your list.",
      "You keep the ones worth pitching and it exports a ready-to-send list.",
    ],
    vsOld:
      "Most agencies rent this exact thing from a scraper SaaS at ~$200/mo, or build lists by hand clicking listings one at a time. Own the agent and you get a fresh, targeted list whenever you want — no subscription, no export caps.",
    test:
      "To test it I pulled 200 “med spas” in Scottsdale, AZ. A couple minutes later I had phones, sites, and review counts for every one — and I flagged the ones under 50 reviews, since those are the easiest to start a conversation with.",
    useCases: [
      "Agencies building a fresh cold-outreach list every week without a scraper subscription",
      "Lead-gen operators spinning up targeted lists by niche and city on demand",
      "DTC brands sourcing local retailers, stockists, or wholesale accounts to pitch",
      "Anyone enriching a CRM with verified phones, emails, and websites",
    ],
  },
  {
    key: "lead-pipeline-agent",
    label: "lead pipeline agent",
    teaser: "the agent that researches every lead before it hits your sequence",
    subject: "the agent that researches every lead before you email it",
    lead:
      "a lead-pipeline agent I built in Hermes that takes any raw list and turns it into a researched, verified, ready-to-send pipeline — it reads each lead's site and LinkedIn, keeps only who fits what you sell, and drops the rest.",
    how: [
      "Drop in any list — CSV, Parquet, a Maps export.",
      "It reads each company's website and LinkedIn and writes a quick business analysis.",
      "It scores each against your offer and keeps only the matches.",
      "It verifies every email and loads the keepers straight into your sequence.",
    ],
    vsOld:
      "Enrichment tools append a job title and a guessed email behind a $99–$500/mo bill. This researches each lead like a human would — so what lands in your sequence is qualified, not just enriched.",
    test:
      "To test it I fed in a messy 2,400-row trade-show export. It came back with 612 that actually matched the ICP, 598 with verified emails, and a one-line reason for each — the rest dropped before I wasted a single send.",
    useCases: [
      "Agencies turning bought or scraped lists into clean, sendable pipelines",
      "Founders who want only the leads worth chasing, already researched",
      "Teams protecting their sending domain with verified-only lists",
      "Anyone paying for enrichment + verification + a researcher separately",
    ],
  },
  {
    key: "hermes-agent",
    label: "LinkedIn DM setter",
    teaser: "the LinkedIn setter that books calls while you sleep",
    subject: "the LinkedIn setter I built that books calls while I sleep",
    lead:
      "a LinkedIn appointment setter I built in Hermes that finds in-market buyers, starts real conversations, and books meetings — and every message waits for your one-tap approval in Telegram before it sends.",
    how: [
      "It mines your competitors' best-performing posts and pulls everyone engaging with them.",
      "It filters to your exact ICP, so you never message the wrong person.",
      "It writes an opener in your voice and holds it for your approval in Telegram.",
      "You tap approve, it sends and books — you just show up to the call.",
    ],
    vsOld:
      "The tools that do a slice of this run ~$99/mo each and still blast templates. This runs on your own account, warm and approved — the same system that holds 40%+ connection accepts and 30%+ reply rates.",
    test:
      "To test it I pointed it at three competitors and it pulled a few hundred warm, in-market people who'd just engaged with posts in my space — then drafted openers referencing exactly what they'd commented on.",
    useCases: [
      "Founders who want meetings booked without living in LinkedIn",
      "Agencies running setters across multiple client accounts",
      "Anyone tired of template spam that gets ignored",
      "Teams that want a human approval gate before anything sends",
    ],
  },
  {
    key: "buying-signals-agent",
    label: "buying-signals agent",
    teaser: "the agent that only pings you when someone's ready to buy",
    subject: "the agent that only pings me when someone's ready to buy",
    lead:
      "a buying-signals agent I built in Hermes that watches hundreds of sources for the exact signals I pick — a warm commenter on a competitor's post, a job change, a hiring surge — and pings me the moment one fires, with the account and the reason to reach out.",
    how: [
      "You pick what “ready to buy” means — a keyword, a warm commenter, a job change, a hiring surge, your own trigger.",
      "It watches 428 sources, 3× a day, for exactly those.",
      "The second one fires, it hands you the account plus the “why now.”",
      "It feeds straight into your LinkedIn, email, or WhatsApp outreach.",
    ],
    vsOld:
      "Intent platforms charge $2–10k/mo to repackage the funding alerts everyone already gets. This catches the warm ones nobody's watching — because you defined them — for the price of your own keys.",
    test:
      "To test it I set it to flag warm commenters in my niche. Within a day it surfaced someone who'd commented on a competitor's post asking if it did X — I reached out that afternoon while they were still shopping.",
    useCases: [
      "Outbound teams sick of cold-messaging strangers who show no intent",
      "Founders who want a real reason in every first line",
      "Anyone replacing a pricey intent platform with owned signals",
      "Teams feeding warm accounts into an existing sequence",
    ],
  },
  {
    key: "carousel-agent",
    label: "carousel factory",
    teaser: "the agent that turns a Telegram link into carousels on every account",
    subject: "I drop a link in Telegram and get a carousel on every account",
    lead:
      "a carousel agent I built in Hermes that turns a Telegram message or a URL into a finished, on-brand carousel — then posts it to all my TikTok, Instagram, and LinkedIn accounts at once. I never touch Canva or log into a platform.",
    how: [
      "Chat in Telegram or paste a URL or video link.",
      "It pulls the strongest points into a finished carousel in your brand, and writes the caption.",
      "You approve it right there in the chat.",
      "It publishes to all your accounts at once — no scheduler, no exporting.",
    ],
    vsOld:
      "A single carousel is half a day in Canva plus posting to each account by hand — or a designer and a scheduler subscription. This is one text message → live everywhere, pennies per deck on your own keys.",
    test:
      "To test it I dropped a YouTube link into Telegram and had five branded carousels live on my TikTok, Instagram, and LinkedIn before my coffee was cold.",
    useCases: [
      "Founders who want to post consistently without the design grind",
      "Agencies running content across many client accounts at once",
      "Creators turning one video into a week of posts",
      "Anyone who wants on-brand decks without a designer or a SaaS seat",
    ],
  },
  {
    key: "seo-agent",
    label: "SEO growth agent",
    teaser: "the agent that does a $3k/mo SEO pod's job — and actually ships the links",
    subject: "the agent that does what a $3k/mo SEO pod does — and ships",
    lead:
      "an SEO agent I built in Hermes that writes content around what people actually search, then goes and gets the backlinks itself — not a spreadsheet of “opportunities” you have to chase.",
    how: [
      "Point it at what you want to rank for — it finds the intent you can actually win.",
      "It writes the content, built to rank, not filler.",
      "It goes and gets the backlinks itself and submits on a schedule.",
      "Rankings and AI citations climb while you run the business.",
    ],
    vsOld:
      "Agencies charge $3k/mo and hand you a to-do list. This runs the strategist, content, and backlink roles as one agent and actually does the work — on the keys you already pay for.",
    test:
      "To test it I ran it on a page sitting at position 8. It wrote the piece, queued three real backlinks, and moved it toward the top of page one — and it started showing up cited in AI answers too.",
    useCases: [
      "Agencies wanting an SEO pod without the retainer",
      "Founders sitting on content that never ranks",
      "Anyone who wants links built, not just listed",
      "Teams that want to show up in AI search, not just Google",
    ],
  },
  {
    key: "youtube-agent",
    label: "YouTube automation agent",
    teaser: "the agent that plans a month of videos built to beat what's ranking",
    subject: "the agent that plans a month of videos built to beat what's ranking",
    lead:
      "a YouTube agent I built in Hermes that studies what's already winning in my niche, finds the gaps nobody's covering, and hands me a month of videos built to beat them — each with a ready-to-read script.",
    how: [
      "Tell it your channel topic.",
      "It checks what's already ranking and finds the gaps.",
      "It plans a full month of videos built to be better and more thorough.",
      "It hands you an angle and a ready-to-read script for each — you just record.",
    ],
    vsOld:
      "Most creators stall on the blank doc every Monday. This turns “what do I post?” into a month planned in one sitting, built on what's already proven to work.",
    test:
      "To test it I gave it my topic on a Sunday. It showed me the gaps in my niche and handed me a month of scripts built to beat what was ranking. I haven't opened a blank doc since.",
    useCases: [
      "Founders using YouTube for inbound but stalling on consistency",
      "Agencies running channels for clients",
      "Creators who want content as a system, not a weekly scramble",
      "Anyone who'd post weekly if the scripts were already written",
    ],
  },
  {
    key: "reddit-agent",
    label: "Reddit engagement agent",
    teaser: "the agent that gets you in the “what should I use?” threads without bans",
    subject: "the agent that gets me in the “what should I use?” threads (no bans)",
    lead:
      "a Reddit agent I built in Hermes that runs dozens of karma-warmed, protected accounts, finds the threads where buyers are asking what to use, and drafts a reply in a real human voice — so I'm in front of them before they ever hit Google.",
    how: [
      "Tell it your niche — it warms dozens of accounts with real karma first.",
      "It hunts the threads where people are asking what to use in your space.",
      "It drafts a helpful, human reply — a soft mention only if someone asks.",
      "It works across accounts on its own, with DEMO mode and a pause switch in your hands.",
    ],
    vsOld:
      "Nobody mines Reddit for leads because it's a pain and a ban risk. Warmed accounts + a human voice + browser-fallback posting means you work the threads without tripping a flag.",
    test:
      "To test it I ran it dry in DEMO mode against a few subreddits. It found the exact “cheapest tool that isn't $200/mo?” threads and drafted replies that read like a regular, not a pitch.",
    useCases: [
      "Founders whose buyers research on Reddit before Google",
      "Agencies adding a channel almost nobody works",
      "Anyone who tried Reddit manually and got removed",
      "Teams that want a pause switch and DEMO mode, not a black box",
    ],
  },
  {
    key: "sec-form4-agent",
    label: "SEC Form 4 agent",
    teaser: "the agent that finds people the week they turn stock into millions",
    subject: "the agent that finds people the week they cash out stock",
    lead:
      "a SEC Form 4 agent I built in Hermes that finds people the week they turn company stock into cash — it watches EDGAR for insider sales, flags who just went liquid, scores them, and hands you a review-ready list.",
    how: [
      "It pulls new Form 4 filings the day they hit EDGAR — free, primary data.",
      "It flags the people who just sold a block of stock — a live liquidity event.",
      "It scores each against your niche and checks for “no advisor of record.”",
      "You review the list and reach out — the week it happened, not months later.",
    ],
    vsOld:
      "Most advisors buy the same stale wealth lists everyone has, or pay someone to dig through EDGAR by hand. This gives you a fresh, scored list of newly-liquid prospects from a government site almost nobody checks.",
    test:
      "To test it I ran a week of filings and it surfaced a CFO who'd sold ~$2M in stock three days earlier, with no advisor on record — a conversation you get to have first.",
    useCases: [
      "Wealth advisors reaching people the week they come into money",
      "Fintech / private banking teams sourcing HNW prospects from primary data",
      "Financial-services teams tired of over-worked broker lists",
      "RIAs who want a compliance-minded list they review before outreach",
    ],
  },
];

// ─── HTML helpers ───────────────────────────────────────────────────────────
function esc(s: string): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shell(inner: string, unsubUrl: string): string {
  return `<!doctype html><html><body style="margin:0;padding:24px 0;background:${BONE};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BONE};">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#fff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:30px 32px;font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${INK};">
          ${inner}
        </td></tr>
        <tr><td style="padding:18px 32px 24px;background:${BONE};border-top:1px solid ${RULE};font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
          You're getting this because you grabbed a free agent build at
          <a href="${SITE}" style="color:${MUTED};">${PUBLIC_SITE_DISPLAY}</a>.<br/>
          <a href="${esc(unsubUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
        </td></tr>
      </table>
    </td></tr>
  </table></body></html>`;
}

function btn(label: string, href: string): string {
  return `<a href="${esc(href)}" style="display:inline-block;padding:13px 26px;background:${ACCENT};color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:15px;">${label}</a>`;
}

function bullets(items: string[]): string {
  return items
    .map(
      (b) =>
        `<div style="margin:7px 0;padding-left:20px;position:relative;color:${INK};"><span style="position:absolute;left:0;color:${ACCENT};">→</span>${b}</div>`,
    )
    .join("");
}

/**
 * Render one agent showcase. `nextTeaser` powers the P.S. "tomorrow →" line;
 * `otherTeasers` is the "in case you missed" list of other agents.
 */
export function renderShowcase(
  s: Showcase,
  opts: { unsubUrl: string; nextTeaser?: string; otherTeasers: string[] },
): { subject: string; html: string } {
  const dUrl = deliverableUrl(s.key);
  const how = s.how
    .map((step) => `<div style="margin:8px 0;color:${INK};">${step}</div>`)
    .join("");
  const ps = [
    opts.nextTeaser ? `Tomorrow: ${opts.nextTeaser}.` : "",
    opts.otherTeasers.length
      ? `In case you missed them — ${opts.otherTeasers.slice(0, 3).join("; ")}.`
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const inner = `
    <p style="margin:0 0 16px;">Hey, Cedric here 👋</p>
    <p style="margin:0 0 16px;">Today I want to show you ${s.lead}</p>
    <p style="margin:18px 0 8px;font-weight:700;color:${INK};">Here's how it works:</p>
    ${how}
    <p style="margin:16px 0;color:${MUTED};">${s.vsOld}</p>
    <div style="margin:16px 0;padding:14px 16px;background:${PAPER};border:1px solid rgba(212,54,26,0.16);border-radius:10px;color:${INK};">${s.test}</div>
    <p style="margin:18px 0 8px;font-weight:700;color:${INK};">Here's where it gets useful:</p>
    ${bullets(s.useCases)}
    <p style="margin:22px 0 6px;">I put together the full build — the exact prompts and the step-by-step setup — so you can stand up your own.</p>
    <p style="margin:0 0 22px;">${btn("Grab the full build — free →", dUrl)}</p>
    <p style="margin:0 0 18px;color:${MUTED};">And if you want the machine that actually <i>runs</i> it — the campaigns, mailboxes, deliverability, inbox, and CRM — that's ACA. <a href="${TRIAL_URL}" style="color:${ACCENT};">Start free →</a> · <a href="${SKOOL_URL}" style="color:${ACCENT};">${communityLine} →</a></p>
    <p style="margin:0 0 4px;">Talk soon,<br/>Cedric</p>
    ${ps ? `<p style="margin:18px 0 0;font-size:13px;color:${MUTED};">${ps}</p>` : ""}
  `;
  return { subject: s.subject, html: shell(inner, opts.unsubUrl) };
}

// The closer, sent once the library tour is done.
export function renderFinal(opts: { unsubUrl: string }): { subject: string; html: string } {
  const inner = `
    <p style="margin:0 0 16px;">Hey, Cedric here 👋</p>
    <p style="margin:0 0 16px;">Over the last week or so I've walked you through the agent library — the Maps scraper, the lead pipeline, the LinkedIn setter, buying signals, the carousel factory, SEO, YouTube, Reddit, and the SEC Form 4 agent. Every one of them is yours to build, free.</p>
    <p style="margin:0 0 16px;">Here's the thing nobody tells you: the prompt is the <i>brain</i>. It still needs a <i>body</i> to run in — somewhere to source and store leads, mailboxes and deliverability so your sends land, an inbox to catch replies, and something to keep it running every day without you babysitting it.</p>
    <p style="margin:0 0 16px;">That's ACA. It's the machine all of these plug into — email + LinkedIn campaigns, the inbox infrastructure, the CRM, the content — on your own API keys. Bring your keys, start free, and if it doesn't save you time or make you leads in 30 days, we refund you.</p>
    <p style="margin:0 0 22px;">${btn("Start your ACA trial — free →", TRIAL_URL)}</p>
    <p style="margin:0 0 18px;color:${MUTED};">Rather build it alongside other people doing the same? <a href="${SKOOL_URL}" style="color:${ACCENT};">${communityLine} →</a></p>
    <p style="margin:0;">Talk soon,<br/>Cedric</p>
  `;
  return { subject: "the whole library (and the machine that runs it)", html: shell(inner, opts.unsubUrl) };
}
