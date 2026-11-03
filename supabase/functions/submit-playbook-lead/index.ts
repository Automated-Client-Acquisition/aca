// ============================================================================
// submit-playbook-lead
// ----------------------------------------------------------------------------
// Public endpoint (no auth). Captures playbook lead-gen submissions, writes
// to public.playbook_leads, fires an email notification to the founder.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { addContactToResendAudience } from "../_shared/resend-audience.ts";
import { AgentDeliveryConfig, fetchTodaySignals, renderAgentDeliveryEmail, renderHermesDeliveryEmail, renderMapsDeliveryEmail, renderWelcomeEmail, sendResendBatch, unsubscribeUrl } from "../_shared/signals-email.ts";
import { OPS_ALERT_EMAIL, PUBLIC_SITE_DISPLAY, PUBLIC_SITE_URL, fromAddress } from "../_shared/site-config.ts";

// Where the free Hermes appointment-setter deliverable (agent prompt + setup
// guide) lives. Override via env so the doc can move without a redeploy.
const HERMES_DELIVERABLE_URL =
  Deno.env.get("HERMES_DELIVERABLE_URL") ||
  "https://www.skool.com/aca-xtreme/about";

// Where the free Google Maps scraper deliverable (12M business list + the
// scraper system guide) lives. Override via env so the doc can move w/o redeploy.
const MAPS_DELIVERABLE_URL =
  Deno.env.get("MAPS_DELIVERABLE_URL") ||
  "https://docs.google.com/document/d/1M7T3pKYHzeEcbek2oGP8I9-SaOWauyUE4D1gs7gUpx4/edit";

// One "free agent build" lead magnet per remaining agent in the /agents
// curriculum (LinkedIn Setter + Google Maps Agent already have their own
// bespoke handlers above). Each deliverable URL is env-overridable — set
// `<KEY>_DELIVERABLE_URL` once a real prompt/guide doc exists; falls back to
// the Skool community in the meantime, same as HERMES_DELIVERABLE_URL did
// before its doc existed.
const AGENT_LEAD_MAGNETS: Record<string, { envKey: string; email: AgentDeliveryConfig }> = {
  "sec-form4-agent": {
    envKey: "SEC_FORM4_DELIVERABLE_URL",
    email: {
      agentLabel: "SEC Form 4 Agent",
      subject: "Your SEC Form 4 lead-gen agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that pulls SEC Form 4 filings straight off EDGAR, scores them for wealth and fintech fit, and hands you a compliance-minded shortlist your team used to dig out by hand.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Pull Form 4 filings", "It pulls EDGAR Form 4 filings the moment they're public — free, primary insider-trading data."],
        ["2", "Score for fit", "Every filing is scored against your wealth or fintech ICP, so you only see what's worth a call."],
        ["3", "Export the shortlist", "A clean, scored shortlist — ready to route straight into outreach."],
        ["4", "Stay compliance-minded", "You review every name before it's sent. No auto-blasting regulated leads."],
      ],
    },
  },
  "buying-signals-agent": {
    envKey: "SIGNALS_AGENT_DELIVERABLE_URL",
    email: {
      agentLabel: "Buying Signals Agent",
      subject: "Your buying-signals agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that tracks funding, hiring, M&A, and growth signals across hundreds of sources — and hands you the \"why now\" so outreach never lands cold.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Pull the signals", "It monitors funding, hiring, M&A, and growth signals via RSS — no paid intent platform required."],
        ["2", "Score and route", "Each signal is scored and routed to the right play automatically."],
        ["3", "Feed your outreach", "Wire the \"why now\" straight into your Setter, SEO, or pipeline agent."],
        ["4", "Run it on a cadence", "Set it to run 2-3x a day, so you're always working the freshest signals."],
      ],
    },
  },
  "reddit-agent": {
    envKey: "REDDIT_AGENT_DELIVERABLE_URL",
    email: {
      agentLabel: "Reddit Engagement Agent",
      subject: "Your Reddit engagement agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that mines Reddit for warm leads and engages in your voice — with the warmup, pacing, and pause switch that keep your accounts un-banned.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Warm up safely", "Multiple accounts, ramped like a real human — not a bot that gets flagged day one."],
        ["2", "Write in your voice", "Casual, config-driven personas that read like a real Redditor, not a sales pitch."],
        ["3", "Post through the browser", "Falls back to browser posting the moment the API gets rate-limited or blocked."],
        ["4", "Stay in control", "DEMO mode and a pause switch mean nothing goes out without your say-so."],
      ],
    },
  },
  "youtube-agent": {
    envKey: "YOUTUBE_AGENT_DELIVERABLE_URL",
    email: {
      agentLabel: "YouTube Automation Agent",
      subject: "Your YouTube automation agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that finds the gaps in your niche and writes a month of videos designed to beat what's already ranking.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Build the roadmap", "It maps a full content calendar around what's ranking — and what's missing — in your niche."],
        ["2", "Storyboard each video", "Hook, scenes, and b-roll planned out, so you never face a blank doc."],
        ["3", "Generate the script + cuts", "Full script plus short-form cuts, ready to shoot or hand to an editor."],
        ["4", "Ship YouTube SEO too", "Titles, tags, and metadata generated alongside every video."],
      ],
    },
  },
  "seo-agent": {
    envKey: "SEO_AGENT_DELIVERABLE_URL",
    email: {
      agentLabel: "SEO Growth Agent",
      subject: "Your SEO growth agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that runs strategist, campaign, and backlink roles like a real SEO agency pod — targeting actual search intent, not vanity keywords.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Find winnable intent", "It targets keywords you can actually rank for — not generic blog fluff."],
        ["2", "Run the pod", "Strategist, campaign, and backlink roles run as one agent, not three tools."],
        ["3", "Generate briefs + content", "Written content shipped against real search intent, on a schedule."],
        ["4", "Submit backlinks", "It actually submits the backlinks and deploys — not just a report you have to act on."],
      ],
    },
  },
  "lead-pipeline-agent": {
    envKey: "LEAD_PIPELINE_DELIVERABLE_URL",
    email: {
      agentLabel: "Lead Pipeline Agent",
      subject: "Your lead pipeline agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that turns any raw list — CSV, Maps, anything — into a scored, verified, ready-to-send pipeline.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Bring in a raw list", "CSV, Parquet, or a Maps export — it doesn't matter where the list came from."],
        ["2", "Score against your offer", "Every lead is scored and qualified before it takes another second of your time."],
        ["3", "Verify + validate", "The company gets verified and every email validated, so you protect your sending domain."],
        ["4", "Export what's worth sending", "Only the leads worth chasing make it to your outreach tool."],
      ],
    },
  },
  "carousel-agent": {
    envKey: "CAROUSEL_AGENT_DELIVERABLE_URL",
    email: {
      agentLabel: "Carousel Factory",
      subject: "Your carousel factory agent build is inside",
      headline: "It's all yours.",
      intro:
        "Below is everything you need to build the agent that turns a URL, transcript, or doc into a finished LinkedIn carousel and post copy — no design tool, no SaaS subscription, just a text to Telegram.",
      ctaLabel: "Get the prompts + guide →",
      steps: [
        ["1", "Feed it a source", "A URL, transcript, or doc is all it needs to start."],
        ["2", "Generate on-brand slides", "Image generation and layout that hold your brand rules every time."],
        ["3", "Write the post copy", "Copy that earns the swipe, written in your voice."],
        ["4", "Export + publish", "PDF exported and ready to publish straight to LinkedIn."],
      ],
    },
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LeadPayload {
  fullName?: string;
  email: string;
  website?: string;
  linkedinUrl?: string;
  biggestNeed?: string;
  whatTried?: string;
  revenue?: string;
  teamSize?: string;
  playbookSlug?: string;
  niche?: string;
  outcome?: string;
  source?: string;
  /* Quote questionnaire answers, sent structured so the emails can lay them
     out as a table rather than one run-on line. Not persisted as columns —
     playbook_leads has none — the readable summary goes into `outcome`. */
  quote?: {
    meetings?: string;
    budget?: string;
    clv?: string;
    closeRate?: string;
  };
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* Shared bits of the notification/confirmation templates. Kept local to this
   function rather than pulled from _shared/signals-email.ts, because that
   module's shell() always renders an unsubscribe link, which is wrong on a
   transactional confirmation and meaningless on an internal alert. */
const INK = "#15140F";
const ACCENT = "#D4361A";
const MUTED = "#6B6759";
const RULE = "#C9C2AE";
const BONE = "#F2EEE6";
const PAPER = "#FBFAF6";
const SITE = PUBLIC_SITE_URL;
const SANS = "-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,monospace";
const SERIF = "Georgia,'Times New Roman',serif";

function emailShell(kicker: string, inner: string, foot: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BONE};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BONE};padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:26px 32px 0;">
          <div style="font:600 13px/1 ${MONO};letter-spacing:0.12em;text-transform:uppercase;color:${INK};">${kicker}</div>
        </td></tr>
        ${inner}
        <tr><td style="padding:22px 32px 26px;background:${PAPER};border-top:1px solid ${RULE};">
          <div style="font:400 12px/1.6 ${SANS};color:${MUTED};">${foot}</div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

/* One label/value row. Used by both emails so a quote reads the same in the
   founder alert and in the lead's copy. */
function row(label: string, value: string): string {
  return `<tr>
    <td style="padding:9px 0;border-top:1px solid ${RULE};font:600 11px/1.4 ${MONO};letter-spacing:0.1em;text-transform:uppercase;color:${MUTED};width:180px;" valign="top">${escapeHtml(label)}</td>
    <td style="padding:9px 0;border-top:1px solid ${RULE};font:400 15px/1.5 ${SANS};color:${INK};">${value}</td>
  </tr>`;
}

function quoteRows(q: NonNullable<LeadPayload["quote"]>): string {
  const clv = q.clv ? `$${Number(q.clv).toLocaleString("en-US")}` : "";
  return [
    q.meetings ? row("Meetings wanted", `${escapeHtml(q.meetings)} over 6 months`) : "",
    q.budget ? row("Monthly budget", escapeHtml(q.budget)) : "",
    clv ? row("Customer worth", clv) : "",
    q.closeRate ? row("Close rate", `${escapeHtml(q.closeRate)}%`) : "",
  ].filter(Boolean).join("");
}

async function sendEmail(
  to: string,
  subject: string,
  html: string,
  replyTo?: string,
): Promise<void> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  // Only the `notifications.` subdomain is verified in Resend. The apex returns
  // 403 on every send, and Resend rejects by status rather than throwing, so an
  // unverified fallback here loses mail silently.
  const from = Deno.env.get("LEAD_NOTIFY_FROM") ||
    fromAddress("noreply");
  if (!resendKey) {
    console.log(`[submit-playbook-lead] No RESEND_API_KEY, skipping email to ${to}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!res.ok) {
    console.error(`[submit-playbook-lead] Resend failed ${res.status}: ${await res.text()}`);
  }
}

async function notifyFounder(payload: LeadPayload, leadId: string): Promise<void> {
  const notifyEmail = Deno.env.get("LEAD_NOTIFY_EMAIL") || OPS_ALERT_EMAIL;
  const who = payload.fullName || payload.email;
  const isQuote = (payload.source || "").startsWith("quote");

  const subject = isQuote
    ? `Quote request · ${who}${payload.quote?.meetings ? ` · ${payload.quote.meetings} meetings` : ""}${payload.quote?.budget ? ` · ${payload.quote.budget}/mo` : ""}`
    : `New lead · ${who}`;

  const detail = [
    payload.website
      ? row("Company", `<a href="${escapeHtml(payload.website.startsWith("http") ? payload.website : `https://${payload.website}`)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(payload.website)}</a>`)
      : "",
    payload.linkedinUrl
      ? row("LinkedIn", `<a href="${escapeHtml(payload.linkedinUrl)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(payload.linkedinUrl)}</a>`)
      : "",
    payload.quote ? quoteRows(payload.quote) : "",
    payload.niche ? row("Market", escapeHtml(payload.niche)) : "",
    payload.playbookSlug && !isQuote ? row("Playbook", escapeHtml(payload.playbookSlug)) : "",
    payload.revenue ? row("Revenue", escapeHtml(payload.revenue)) : "",
    payload.teamSize ? row("Team size", escapeHtml(payload.teamSize)) : "",
    payload.outcome && !payload.quote ? row("Outcome wanted", escapeHtml(payload.outcome)) : "",
    payload.biggestNeed ? row("Biggest blocker", escapeHtml(payload.biggestNeed)) : "",
    payload.whatTried ? row("What they tried", escapeHtml(payload.whatTried)) : "",
    payload.source ? row("Source", escapeHtml(payload.source)) : "",
  ].filter(Boolean).join("");

  const inner = `
    <tr><td style="padding:14px 32px 0;">
      <div style="font:600 27px/1.2 ${SERIF};color:${INK};">${escapeHtml(who)}</div>
      <div style="font:400 15px/1.5 ${SANS};color:${MUTED};margin-top:4px;">
        <a href="mailto:${escapeHtml(payload.email)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(payload.email)}</a>
      </div>
    </td></tr>
    <tr><td style="padding:18px 32px 6px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detail}</table>
    </td></tr>
    <tr><td style="padding:16px 32px 22px;">
      <a href="mailto:${escapeHtml(payload.email)}" style="display:inline-block;background:${ACCENT};color:#fff;font:600 15px/1 ${SANS};padding:14px 26px;border-radius:8px;text-decoration:none;">Reply to ${escapeHtml((payload.fullName || "them").split(" ")[0])} →</a>
    </td></tr>`;

  try {
    await sendEmail(
      notifyEmail,
      subject,
      emailShell(
        isQuote ? `ACA <span style="color:${ACCENT};">·</span> Quote request` : `ACA <span style="color:${ACCENT};">·</span> New lead`,
        inner,
        `Lead ID ${escapeHtml(leadId)}. Hit reply to answer them directly.`,
      ),
      payload.email,
    );
  } catch (e) {
    console.error("[submit-playbook-lead] Email notification error:", e);
  }
}

/* The lead's own copy. Only sent for quote submissions — every other source
   here already has its own delivery email, or is a silent capture. */
async function sendQuoteConfirmation(payload: LeadPayload): Promise<void> {
  const first = (payload.fullName || "").trim().split(" ")[0];
  const rows = payload.quote ? quoteRows(payload.quote) : "";
  const inner = `
    <tr><td style="padding:14px 32px 0;">
      <div style="font:600 28px/1.2 ${SERIF};color:${INK};">${first ? `Thanks, ${escapeHtml(first)}.` : "Thanks."}</div>
      <div style="font:400 15px/1.6 ${SANS};color:${MUTED};margin-top:8px;">
        We've got your numbers. We'll size the build against them and walk you
        through it on the call, including what it costs and what the first
        ninety days look like.
      </div>
    </td></tr>
    ${rows ? `<tr><td style="padding:20px 32px 6px;">
      <div style="font:600 11px/1 ${MONO};letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};margin-bottom:2px;">What you told us</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </td></tr>` : ""}
    <tr><td style="padding:22px 32px 4px;">
      <div style="font:600 11px/1 ${MONO};letter-spacing:0.12em;text-transform:uppercase;color:${MUTED};margin-bottom:8px;">Next</div>
      <div style="font:400 15px/1.6 ${SANS};color:${INK};">
        If you haven't already picked a time, grab one here. Thirty minutes, and
        if it isn't a fit we'll say so on the call.
      </div>
    </td></tr>
    <tr><td style="padding:16px 32px 24px;">
      <a href="${SITE}/book" style="display:inline-block;background:${ACCENT};color:#fff;font:600 16px/1 ${SANS};padding:16px 30px;border-radius:8px;text-decoration:none;">Pick a time →</a>
    </td></tr>`;

  try {
    await sendEmail(
      payload.email,
      "Your quote is on its way",
      emailShell(
        `ACA <span style="color:${ACCENT};">·</span> Your quote`,
        inner,
        `You're getting this because you asked for a quote at
         <a href="${SITE}" style="color:${MUTED};text-decoration:underline;">${PUBLIC_SITE_DISPLAY}</a>.
         Just reply to this email if you'd rather ask a question first.`,
      ),
      Deno.env.get("LEAD_NOTIFY_EMAIL") || OPS_ALERT_EMAIL,
    );
  } catch (e) {
    console.error("[submit-playbook-lead] Quote confirmation error:", e);
  }
}

// Daily-signals capture path: register the subscriber in its own list (with a
// per-row unsubscribe token) and send the immediate "you're in" welcome email.
// Fire-and-forget — never blocks or fails the lead insert.
async function handleSignalsDaily(rawEmail: string): Promise<void> {
  try {
    const email = rawEmail.trim().toLowerCase();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Upsert (re-subscribe reactivates) and return the token to build the link.
    const { data: sub, error } = await supabase
      .from("signals_subscribers")
      .upsert(
        { email, source: "signals-daily", status: "active", unsubscribed_at: null },
        { onConflict: "email", ignoreDuplicates: false }
      )
      .select("unsubscribe_token")
      .single();

    if (error || !sub?.unsubscribe_token) {
      console.error("[submit-playbook-lead] subscriber upsert failed:", error);
      return;
    }

    const today = await fetchTodaySignals(3);
    const unsubUrl = unsubscribeUrl(sub.unsubscribe_token);
    const { subject, html } = renderWelcomeEmail(today, unsubUrl);
    await sendResendBatch([{ to: email, subject, html, unsubUrl }]);
  } catch (e) {
    console.error("[submit-playbook-lead] handleSignalsDaily error:", e);
  }
}

// Hermes lead-magnet path: register the subscriber (own source tag + per-row
// unsubscribe token) and immediately email the prompt + setup guide. Reuses the
// signals_subscribers list so unsubscribe + dedupe work the same way.
async function handleHermesAgent(rawEmail: string): Promise<void> {
  try {
    const email = rawEmail.trim().toLowerCase();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: sub, error } = await supabase
      .from("signals_subscribers")
      .upsert(
        { email, source: "hermes-agent", status: "active", unsubscribed_at: null },
        { onConflict: "email", ignoreDuplicates: false }
      )
      .select("unsubscribe_token")
      .single();

    if (error || !sub?.unsubscribe_token) {
      console.error("[submit-playbook-lead] hermes subscriber upsert failed:", error);
      return;
    }

    const unsubUrl = unsubscribeUrl(sub.unsubscribe_token);
    const { subject, html } = renderHermesDeliveryEmail(HERMES_DELIVERABLE_URL, unsubUrl);
    await sendResendBatch([{ to: email, subject, html, unsubUrl }]);
  } catch (e) {
    console.error("[submit-playbook-lead] handleHermesAgent error:", e);
  }
}

// Google Maps scraper lead-magnet path: register the subscriber (own source tag
// + per-row unsubscribe token) and immediately email the 12M business list +
// scraper system. Reuses the signals_subscribers list for unsubscribe + dedupe.
async function handleMapsScraper(rawEmail: string): Promise<void> {
  try {
    const email = rawEmail.trim().toLowerCase();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: sub, error } = await supabase
      .from("signals_subscribers")
      .upsert(
        { email, source: "maps-scraper", status: "active", unsubscribed_at: null },
        { onConflict: "email", ignoreDuplicates: false }
      )
      .select("unsubscribe_token")
      .single();

    if (error || !sub?.unsubscribe_token) {
      console.error("[submit-playbook-lead] maps subscriber upsert failed:", error);
      return;
    }

    const unsubUrl = unsubscribeUrl(sub.unsubscribe_token);
    const { subject, html } = renderMapsDeliveryEmail(MAPS_DELIVERABLE_URL, unsubUrl);
    await sendResendBatch([{ to: email, subject, html, unsubUrl }]);
  } catch (e) {
    console.error("[submit-playbook-lead] handleMapsScraper error:", e);
  }
}

// Generic "free agent build" lead-magnet path (see AGENT_LEAD_MAGNETS above):
// register the subscriber (own source tag + per-row unsubscribe token) and
// immediately email the agent prompt + setup guide. Reuses the
// signals_subscribers list so unsubscribe + dedupe work the same way.
async function handleAgentLeadMagnet(source: string, rawEmail: string): Promise<void> {
  const config = AGENT_LEAD_MAGNETS[source];
  if (!config) return;
  try {
    const email = rawEmail.trim().toLowerCase();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: sub, error } = await supabase
      .from("signals_subscribers")
      .upsert(
        { email, source, status: "active", unsubscribed_at: null },
        { onConflict: "email", ignoreDuplicates: false }
      )
      .select("unsubscribe_token")
      .single();

    if (error || !sub?.unsubscribe_token) {
      console.error(`[submit-playbook-lead] ${source} subscriber upsert failed:`, error);
      return;
    }

    const deliverableUrl = Deno.env.get(config.envKey) || "https://www.skool.com/aca-xtreme/about";
    const unsubUrl = unsubscribeUrl(sub.unsubscribe_token);
    const { subject, html } = renderAgentDeliveryEmail(config.email, deliverableUrl, unsubUrl);
    await sendResendBatch([{ to: email, subject, html, unsubUrl }]);
  } catch (e) {
    console.error(`[submit-playbook-lead] handleAgentLeadMagnet(${source}) error:`, e);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body: LeadPayload = await req.json();

    if (!body.email || !isValidEmail(body.email)) {
      return new Response(
        JSON.stringify({ error: "Valid email required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data, error } = await supabase
      .from("playbook_leads")
      .insert({
        full_name: body.fullName,
        email: body.email,
        website: body.website,
        linkedin_url: body.linkedinUrl,
        biggest_need: body.biggestNeed,
        what_tried: body.whatTried,
        revenue: body.revenue,
        team_size: body.teamSize,
        playbook_slug: body.playbookSlug,
        niche: body.niche,
        outcome: body.outcome,
        source: body.source || "playbook_leadgen",
      })
      .select("id")
      .single();

    if (error) {
      console.error("[submit-playbook-lead] Insert error:", error);
      return new Response(
        JSON.stringify({ error: "Failed to record lead" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // The free daily-signals capture is a newsletter opt-in, not a sales lead:
    // route it to its own subscriber list + welcome email, and skip the founder
    // ping / playbook audience (reserved for qualified playbook lead-gen).
    if (body.source === "signals-daily") {
      handleSignalsDaily(body.email).catch((e) =>
        console.error("[submit-playbook-lead] handleSignalsDaily failed:", e)
      );
    } else if (body.source === "hermes-agent") {
      // Free lead magnet: deliver the prompt + setup guide immediately, and
      // still ping the founder so a new opt-in is visible. No playbook audience.
      handleHermesAgent(body.email).catch((e) =>
        console.error("[submit-playbook-lead] handleHermesAgent failed:", e)
      );
      notifyFounder(body, data.id).catch((e) =>
        console.error("[submit-playbook-lead] notifyFounder failed:", e)
      );
    } else if (body.source === "maps-scraper") {
      // Free lead magnet: deliver the 12M list + scraper system immediately, and
      // still ping the founder so a new opt-in is visible. No playbook audience.
      handleMapsScraper(body.email).catch((e) =>
        console.error("[submit-playbook-lead] handleMapsScraper failed:", e)
      );
      notifyFounder(body, data.id).catch((e) =>
        console.error("[submit-playbook-lead] notifyFounder failed:", e)
      );
    } else if (body.source && AGENT_LEAD_MAGNETS[body.source]) {
      // Free lead magnet: deliver the agent build immediately, and still ping
      // the founder so a new opt-in is visible. No playbook audience.
      handleAgentLeadMagnet(body.source, body.email).catch((e) =>
        console.error(`[submit-playbook-lead] handleAgentLeadMagnet(${body.source}) failed:`, e)
      );
      notifyFounder(body, data.id).catch((e) =>
        console.error("[submit-playbook-lead] notifyFounder failed:", e)
      );
    } else {
      // Fire-and-forget notification + audience add (don't block the response)
      notifyFounder(body, data.id).catch((e) =>
        console.error("[submit-playbook-lead] notifyFounder failed:", e)
      );
      // Quote requests get a confirmation with their own numbers back.
      if ((body.source || "").startsWith("quote")) {
        sendQuoteConfirmation(body).catch((e) =>
          console.error("[submit-playbook-lead] quote confirmation failed:", e)
        );
      }
      addContactToResendAudience({
        email: body.email,
        fullName: body.fullName,
        metadata: { leadId: data.id, playbookSlug: body.playbookSlug },
      }).catch((e) =>
        console.error("[submit-playbook-lead] audience add failed:", e)
      );
    }

    return new Response(
      JSON.stringify({ leadId: data.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (e) {
    console.error("[submit-playbook-lead] Error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
