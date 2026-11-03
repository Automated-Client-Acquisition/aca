// ============================================================================
// onboarding-drip-tick
// ----------------------------------------------------------------------------
// Cron-driven (every 30 min). Walks freshly-onboarded orgs and sends asset-led
// drip emails during the 3-day trial. Each email is built from REAL assets
// the system generated for the user during /get-started - their actual ICP,
// their LinkedIn audit score, the first cold email we wrote for them, etc.
// Each email pushes toward one specific next step inside the workspace.
//
// Stage cadence (across the 3-day trial):
//   T+30min  → 1. The Reveal           (Look at the buyer we built for you)
//   T+6h     → 2. LinkedIn audit       (Your profile scored X/10, here's the fix)
//   T+24h    → 3. Cold email reveal    (This is what we wrote for [ICP] - import 10 leads)
//   T+36h    → 4. Content plan reveal  (30 days of post angles, written for you)
//   T+52h    → 5. AI agent intro       (Your assistant is trained, give it leads to handle)
//   T+68h    → 6. Trial ends           (4 hours left, here's the link to keep it running)
//
// Idempotent via public.onboarding_drip_state.stages_sent. Skips users who
// have already taken the action being pushed (e.g. already imported leads).
// ============================================================================

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import { ensureOnboardingDoc, syncOnboardingDoc } from "../_shared/onboarding-notion-doc.ts";
import type { NotionBlockDef } from "../_shared/notion-block-types.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";
import { APP_URL, PUBLIC_SITE_DISPLAY, PUBLIC_SITE_URL, fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// app.automatedclientacquisition.com has no live Vercel deployment (see
// lifecycle-digest-tick / reply-notification-tick, fixed the same way) - www is the real app.
const FROM = Deno.env.get("ONBOARDING_DRIP_FROM") ||
  // Apex is unverified in Resend (403); only the `notifications.` subdomain sends.
  fromAddress("cedric", "Cedric @ ACA");

interface OrgRow {
  id: string;
  name: string | null;
  created_at: string;
  subscription_status: string | null;
  trial_ends_at: string | null;
  stripe_subscription_id: string | null;
}

interface MemberRow {
  email: string;
  full_name: string | null;
}

type Phase = "trial" | "winback" | "post_conversion";

interface DripCtx {
  org: OrgRow;
  member: MemberRow;
  firstName: string;
  ageHours: number;
  hoursSinceTrialEnd: number;  // negative if trial still active
  hoursSinceConversion: number; // negative if not yet converted
  phase: Phase;
  // The actual assets we generated. Each is optional - if a stage's asset
  // isn't ready, we fall back to a no-asset version of the email rather
  // than skipping the touch entirely.
  icp: { name: string; summary: string; pains: string[] } | null;
  audit: {
    overall: number | null; headline: string | null; about: string | null; status: string | null;
    summary: string | null; aboutRewrite: string | null; recommendations: string[];
    headlineScore: number | null; aboutScore: number | null; bannerScore: number | null; activityScore: number | null;
  } | null;
  sequence: { name: string | null; firstStep: { subject?: string; body?: string } | null } | null;
  blueprint: { themes: Array<{ theme?: string; hook_pattern?: string }> } | null;
  agent: { name: string | null; toneTraits: string[] } | null;
  knowledge: { content: string | null } | null;
  strategy: { content: string | null } | null;
  hasLeads: boolean;
  hasUnipile: boolean;
  hasOpenRouter: boolean;
  voiceGuidance: string | null;
  stageFeedback: string | null; // pulled per-stage from prefs.stage_feedback[stage.key]
}

// ─── Notion onboarding-doc "Updates" content ───────────────────────────────
// One narrative entry per trial stage, reusing the same ctx fields already
// assembled for that stage's HTML email - no separate authoring. Stages not
// listed here (reminders like trial_ends/trial_12h_left) get a checklist-only
// sync with no new "Updates" entry.
function buildNotionUpdate(stageKey: string, ctx: DripCtx): NotionBlockDef[] | null {
  const heading = (text: string): NotionBlockDef => ({ type: "heading_3", text: [{ content: text }] });
  const para = (text: string): NotionBlockDef => ({ type: "paragraph", text: [{ content: text }] });
  const toggle = (label: string, body: string): NotionBlockDef => ({
    type: "toggle",
    text: [{ content: label, bold: true }],
    children: [{ type: "paragraph", text: [{ content: body }] }],
  });

  switch (stageKey) {
    case "reveal_icp":
      if (!ctx.icp) return null;
      return [
        heading("Your ideal customer profile"),
        { type: "callout", emoji: "🎯", text: [{ content: ctx.icp.summary }] },
        ...(ctx.icp.pains?.length
          ? [para("What's actually costing them:"), ...ctx.icp.pains.map((p): NotionBlockDef => ({ type: "bulleted_list_item", text: [{ content: p }] }))]
          : []),
      ];

    case "audit_linkedin": {
      if (ctx.audit?.overall == null) return null;
      const a = ctx.audit;
      const scoreRow = (label: string, score: number | null) => ({
        cells: [[{ content: label }], [{ content: score != null ? `${score}/10` : "—" }]],
      });
      return [
        heading("Your LinkedIn audit"),
        ...(a.summary ? [{ type: "callout" as const, emoji: "🔍", text: [{ content: a.summary }] }] : []),
        {
          type: "table",
          has_column_header: true,
          has_row_header: false,
          rows: [
            { cells: [[{ content: "Area", bold: true }], [{ content: "Score", bold: true }]] },
            scoreRow("Overall", a.overall),
            scoreRow("Headline", a.headlineScore),
            scoreRow("About section", a.aboutScore),
            scoreRow("Banner", a.bannerScore),
            scoreRow("Activity", a.activityScore),
          ],
        },
        ...(a.headline ? [toggle("New headline (paste-ready)", a.headline)] : []),
        ...(a.aboutRewrite ? [toggle("New About section (paste-ready)", a.aboutRewrite)] : []),
        ...(a.recommendations.length
          ? [para("What to fix first:"), ...a.recommendations.map((r): NotionBlockDef => ({ type: "numbered_list_item", text: [{ content: r }] }))]
          : []),
      ];
    }

    case "reveal_sequence": {
      if (!ctx.sequence) return null;
      const step = ctx.sequence.firstStep;
      return [
        heading("Your outbound sequence"),
        para(ctx.sequence.name || "Your sequence is ready."),
        ...(step?.subject ? [para(`First touch subject: "${step.subject}"`)] : []),
        ...(step?.body ? [toggle("First touch (paste-ready)", step.body)] : []),
      ];
    }

    case "reveal_content": {
      const themes = ctx.blueprint?.themes || [];
      if (!themes.length) return null;
      return [
        heading("Your content plan"),
        ...themes.slice(0, 5).flatMap((t): NotionBlockDef[] => {
          const title = t.theme || "Post idea";
          return [
            { type: "bulleted_list_item", text: [{ content: title, bold: true }] },
            ...(t.hook_pattern ? [{ type: "paragraph" as const, text: [{ content: t.hook_pattern, italic: true }] }] : []),
          ];
        }),
      ];
    }

    case "reveal_agent":
      if (!ctx.agent) return null;
      return [
        heading("Your AI agent"),
        para(ctx.agent.name ? `${ctx.agent.name} is trained and ready.` : "Your agent is trained and ready."),
        ...(ctx.agent.toneTraits?.length ? [para(`Tone: ${ctx.agent.toneTraits.join(", ")}`)] : []),
      ];

    case "reveal_knowledge":
      return ctx.knowledge ? [heading("Knowledge base"), para("A knowledge document was added to your workspace - your agent now draws on it when it writes.")] : null;

    case "reveal_strategy":
      return ctx.strategy ? [heading("Strategy"), para("A strategy document was added to your workspace.")] : null;

    case "edu_comment_to_dm":
    case "edu_lead_magnets":
    case "edu_infra":
      return [heading("Tip"), para(`We sent you a play: "${STAGES.find((s) => s.key === stageKey)?.subject(ctx) || stageKey}"`)];

    default:
      return null; // reminders (trial_ends, trial_12h_left, ...) - checklist sync only
  }
}

// ─── Shared bits ───────────────────────────────────────────────────────────
// The {{STAGE_KEY}} placeholder is replaced by the handler after each stage's
// html() returns so per-stage feedback links work without each stage having
// to pass its own key into wrap().
const wrap = (innerHtml: string) => `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.55; color:#1a1a1a; background:#fafaf7; margin:0; padding:24px 0;">
  <div style="max-width:540px; margin:0 auto; background:#fff; padding:32px 28px; border-radius:14px; border:1px solid #efeae0;">
    ${innerHtml}
  </div>
  <div style="max-width:540px; margin:14px auto 0; text-align:center; font-size:11px; color:#888;">
    ACA · ${PUBLIC_SITE_DISPLAY}<br>
    <a href="${APP_URL}/settings?tab=notifications" style="color:#888;text-decoration:underline;">Steer my emails</a>
    · <a href="${APP_URL}/settings?tab=notifications&feedback={{STAGE_KEY}}" style="color:#888;text-decoration:underline;">This was off - fix it</a>
    · <a href="${APP_URL}/settings?tab=notifications&pause=1" style="color:#888;text-decoration:underline;">Pause all</a>
  </div>
</body></html>`;

const btn = (label: string, href: string) =>
  `<a href="${href}" style="display:inline-block;padding:11px 22px;background:#D4361A;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">${label} →</a>`;

const asset = (label: string, lines: string[]) =>
  `<div style="margin:18px 0;padding:14px 18px;background:#FFF8F4;border:1px solid rgba(212,54,26,0.18);border-radius:10px;">
    <div style="font-size:10.5px;font-family:ui-monospace,Menlo,monospace;letter-spacing:0.06em;text-transform:uppercase;color:#D4361A;font-weight:600;margin-bottom:8px;">${label}</div>
    ${lines.map((l) => `<div style="margin:4px 0;color:#2A2818;">${l}</div>`).join("")}
  </div>`;

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ─── Drip stages ──────────────────────────────────────────────────────────
type Stream =
  | "reveals"        // asset-reveal emails (ICP, audit, sequence, etc)
  | "education"      // strategy plays + frameworks
  | "content_drops"  // paste-ready LinkedIn posts
  | "daily_briefs"   // today's 3 actions
  | "checkins"       // week/month retrospectives
  | "alerts"         // behavior triggers (handled by alerts-tick)
  | "winback";       // post-trial-expired sequence

interface Stage {
  key: string;
  phase: Phase;
  stream: Stream;
  // Hours since the lifecycle anchor for this phase:
  //   trial            → since org.created_at
  //   winback          → since trial_ends_at
  //   post_conversion  → since current_period_start (we approximate with the
  //                       moment stripe_subscription_id was first set, tracked
  //                       in onboarding_drip_state.converted_at - see handler)
  minHours: number;
  maxHours: number;
  // Optional skip: when the action this stage pushes has already been
  // completed, don't bother (and still record so we don't re-evaluate forever).
  skipIf?: (ctx: DripCtx) => boolean;
  subject: (ctx: DripCtx) => string;
  // Body can be sync (template w/ injected DB values) or async (LLM-personalized
  // per-send using the user's real ICP, audit, sequence, niche, etc).
  html: (ctx: DripCtx) => string | Promise<string>;
}

// ─── LLM personalization helper ────────────────────────────────────────────
// Used by stages that want their body content tailored per-user - not just
// variable injection but real prose written for THIS seller's THIS buyer.
// Falls back to the provided static body on any error so a deliverability
// glitch in OpenRouter never silently drops a touch.
interface LLMOpts {
  voiceGuidance?: string | null;
  stageFeedback?: string | null; // last feedback the user gave for THIS stage
}

async function callLLMForEmail(prompt: string, maxTokens = 1800, temperature = 0.6, opts: LLMOpts = {}): Promise<string | null> {
  const key = Deno.env.get("OPENROUTER_API_KEY");
  if (!key) return null;
  // Build a stronger system prompt that respects user-provided voice
  // guidance + any past "this was off" feedback for this specific stage.
  const systemBase = "You're writing a single section of a personal drip email from Cedric (founder of ACA) to a real user. Match their context - their buyer, their niche, their actual situation. Output ONLY the requested HTML/markdown content - no preamble, no signature, no markdown fences. Never use 'leverage', 'unlock', 'unleash', 'game-changing', 'next-level', 'revolutionary', or any AI-speak. Be specific.";
  const userVoice = opts.voiceGuidance ? `\n\n## The user's own voice guidance (override defaults if these conflict):\n${opts.voiceGuidance}` : "";
  const fb = opts.stageFeedback ? `\n\n## Last time we sent this stage the user said it was "${opts.stageFeedback}". Fix that this time.` : "";
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "HTTP-Referer": PUBLIC_SITE_URL,
        "X-Title": "ACA Onboarding Drip",
      },
      body: JSON.stringify({
        model: "anthropic/claude-haiku-4.5",
        messages: [
          { role: "system", content: systemBase + userVoice + fb },
          { role: "user", content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) {
      console.warn("[drip llm] openrouter", res.status, await res.text().catch(() => ""));
      return null;
    }
    const j = await res.json();
    const content = j?.choices?.[0]?.message?.content;
    return (typeof content === "string" && content.length > 50) ? content.trim() : null;
  } catch (e) {
    console.warn("[drip llm] error:", e);
    return null;
  }
}

// HTML-escape free-form LLM output if we need to put it inside a <pre>-like
// block. For most cases we trust the LLM output as inline HTML.
const safeEscape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const STAGES: Stage[] = [
  // ── 1. T+30min: ICP reveal ─────────────────────────────────────────────
  {
    key: "reveal_icp",
    phase: "trial",
    stream: "reveals",
    minHours: 0.5,
    maxHours: 5.5,
    subject: (c) => c.icp?.name
      ? `${c.firstName || "Hey"}, meet ${c.icp.name.split(" ")[0]} - the buyer we just built for you`
      : `${c.firstName || "Hey"} - your workspace is open, take 3 minutes`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Your workspace is sitting there waiting. Before you do anything else, look at <strong>who we're going to land for you</strong>.</p>
      ${c.icp ? asset("Your ideal buyer", [
        `<strong style="font-size:16px;">${escapeHtml(c.icp.name)}</strong>`,
        `<div style="font-size:13.5px;opacity:0.85;margin-top:4px;">${escapeHtml((c.icp.summary || "").slice(0, 240))}${(c.icp.summary || "").length > 240 ? "…" : ""}</div>`,
        c.icp.pains.length ? `<div style="margin-top:10px;font-size:13px;"><strong>Top pain:</strong> ${escapeHtml(c.icp.pains[0])}</div>` : "",
      ]) : `<p style="opacity:0.7;">(Your buyer profile is still being generated - open the workspace and it'll be there.)</p>`}
      <p style="margin-top:18px;">Every message, every reply, every campaign in your workspace is shaped around this person. The more they feel known, the more they reply.</p>
      <p>Open the profile, edit anything that feels off, and we'll keep tuning everything else around it.</p>
      <p style="margin:24px 0;">${btn("Open my buyer profile", `${APP_URL}/icps`)}</p>
      <p style="font-size:13px;opacity:0.65;">Next up: your LinkedIn audit. Coming in a few hours.</p>
    `),
  },

  // ── 2. T+6h: LinkedIn audit ────────────────────────────────────────────
  {
    key: "audit_linkedin",
    phase: "trial",
    stream: "reveals",
    minHours: 5.5,
    maxHours: 22,
    subject: (c) => c.audit?.overall != null
      ? `Your LinkedIn just scored ${c.audit.overall}/10 - here's the headline that fixes it`
      : `Connect your LinkedIn - your audit is one click away`,
    html: (c) => {
      const hasAudit = c.audit?.overall != null && c.audit?.headline;
      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        ${hasAudit ? `
          <p>We pulled your LinkedIn profile and scored it against the buyer we built for you.</p>
          ${asset(`Score: ${c.audit!.overall}/10`, [
            `<div style="font-size:13px;opacity:0.85;">${escapeHtml((c.audit!.about || "").slice(0, 220))}</div>`,
          ])}
          ${asset("Your new headline (paste-ready)", [
            `<div style="font-size:14px;font-weight:500;font-style:italic;">"${escapeHtml(c.audit!.headline!.slice(0, 260))}"</div>`,
          ])}
          <p>Most members swap their headline + About in 5 minutes flat and start seeing profile views from their actual ICP within 48 hours.</p>
          <p style="margin:24px 0;">${btn("See full audit + new About section", `${APP_URL}/library/audits`)}</p>
        ` : `
          <p>Your LinkedIn audit is waiting - but we need to pair your account first to run it live.</p>
          <p>Takes 30 seconds, then we'll score your headline, About, banner, and activity against your ideal buyer and hand you paste-ready rewrites.</p>
          <p style="margin:24px 0;">${btn("Connect LinkedIn + run my audit", `${APP_URL}/senders`)}</p>
        `}
        <p style="font-size:13px;opacity:0.65;">Tomorrow: the first cold email we wrote for ${c.icp?.name ? escapeHtml(c.icp.name.split(" ")[0]) : "your buyer"}.</p>
      `);
    },
  },

  // ── 3. T+24h: Cold email reveal + import nudge ─────────────────────────
  {
    key: "reveal_sequence",
    phase: "trial",
    stream: "reveals",
    minHours: 22,
    maxHours: 35,
    skipIf: (c) => c.hasLeads, // they already imported, don't repeat the ask
    subject: (c) => c.icp?.name
      ? `The cold email we wrote for ${c.icp.name.split(" ")[0]}`
      : `Your 5-touch sequence is ready - see what we wrote`,
    html: (c) => {
      const step1 = c.sequence?.firstStep;
      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Day 1. The pipeline only works once real prospects start going through it. Here's what we wrote for them.</p>
        ${step1?.subject || step1?.body ? asset("Email 1 (of 5)", [
          step1.subject ? `<div style="font-size:13.5px;"><strong>Subject:</strong> ${escapeHtml(step1.subject)}</div>` : "",
          step1.body ? `<div style="font-size:13.5px;margin-top:8px;white-space:pre-wrap;font-style:italic;opacity:0.9;">${escapeHtml(step1.body.slice(0, 400))}${step1.body.length > 400 ? "…" : ""}</div>` : "",
        ]) : `<p style="opacity:0.7;">(Sequence is in your workspace - open it to see all 5 touches.)</p>`}
        <p>This works <strong>only when there are real people on the receiving end</strong>. The fastest path: import 10 prospects, enroll them, watch what happens this week.</p>
        <p style="margin:24px 0;">${btn("Import my first 10 leads", `${APP_URL}/leads/lists`)}</p>
        <p style="font-size:13px;opacity:0.7;">Or paste a LinkedIn Sales Nav URL · drop in a CSV · we even pull from a 123M pool if you want.</p>
        <p style="font-size:13px;opacity:0.65;margin-top:18px;">Tomorrow: your 30-day content plan.</p>
      `);
    },
  },

  // ── 4. T+36h: Content plan reveal ──────────────────────────────────────
  {
    key: "reveal_content",
    phase: "trial",
    stream: "reveals",
    minHours: 35,
    maxHours: 50,
    subject: (c) => c.blueprint?.themes?.[0]?.theme
      ? `30 days of LinkedIn posts - starting with "${c.blueprint.themes[0].theme}"`
      : `Your 30-day content plan is ready`,
    html: (c) => {
      const themes = c.blueprint?.themes?.slice(0, 3) || [];
      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Outbound puts the right people in front of you. Content makes them <strong>come to you</strong>. We wrote 30 days of LinkedIn post angles and built it around three themes that pull your buyer in.</p>
        ${themes.length ? asset("Your 3 content themes", themes.map((t) =>
          `<div style="margin:8px 0;"><strong>${escapeHtml(t.theme || "")}</strong>${t.hook_pattern ? `<br><span style="font-size:12.5px;opacity:0.7;">Hook: ${escapeHtml(t.hook_pattern)}</span>` : ""}</div>`
        )) : `<p style="opacity:0.7;">(Content plan is in your workspace.)</p>`}
        <p>Each day in the plan has the theme, the angle, and a hook formula. You write the actual words - we make sure you never have to stare at a blank screen again.</p>
        <p style="margin:24px 0;">${btn("Open my content plan", `${APP_URL}/blueprints`)}</p>
        <p style="font-size:13px;opacity:0.65;">Tomorrow: meet your AI booking agent.</p>
      `);
    },
  },

  // ── 5. T+52h: AI agent intro ────────────────────────────────────────────
  {
    key: "reveal_agent",
    phase: "trial",
    stream: "reveals",
    minHours: 50,
    maxHours: 66,
    subject: (c) => c.agent?.name
      ? `${c.agent.name} is ready to handle your replies`
      : `Your AI booking agent is trained - give it work`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Most outbound tools stop at "send the email". The reason founders burn out on outbound: <strong>nobody handles the replies</strong>. That's what your agent is for.</p>
      ${c.agent?.name || c.agent?.toneTraits.length ? asset(c.agent?.name || "Your reply agent", [
        c.agent?.toneTraits.length ? `<div style="font-size:13px;"><strong>Tone:</strong> ${c.agent.toneTraits.slice(0, 3).map(escapeHtml).join(" · ")}</div>` : "",
        `<div style="font-size:13px;opacity:0.85;margin-top:6px;">Reads your knowledge base. Qualifies inbound replies. Drafts answers in your voice. Hands off to you when a real human moment is needed.</div>`,
      ]) : `<p style="opacity:0.7;">(Your agent profile is in the workspace.)</p>`}
      <p>It needs <strong>real replies to learn from</strong>. The cycle is: prospects in → sequence runs → people reply → agent qualifies and drafts → you approve → meetings booked.</p>
      ${c.hasLeads
        ? `<p style="margin:24px 0;">${btn("Open my inbox", `${APP_URL}/inbox`)}</p>`
        : `<p style="margin:24px 0;">${btn("Import prospects so it has something to do", `${APP_URL}/leads/lists`)}</p>`}
      <p style="font-size:13px;opacity:0.65;">Trial ends in ~20 hours.</p>
    `),
  },

  // ── 6. T+68h: Final urgency ────────────────────────────────────────────
  {
    key: "trial_ends",
    phase: "trial",
    stream: "checkins",
    minHours: 66,
    maxHours: 96,
    skipIf: (c) => !!c.org.stripe_subscription_id, // already converted
    subject: () => `Your trial ends today - don't lose what we built you`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Quick heads up - your 3-day trial ends in the next few hours.</p>
      <p>Everything that's in your workspace right now keeps running on autopilot if you stay:</p>
      <ul style="padding-left:20px;line-height:1.65;">
        ${c.icp ? `<li><strong>${escapeHtml(c.icp.name)}</strong> - your buyer profile</li>` : ""}
        ${c.sequence?.name ? `<li>Your 5-touch sequence (${escapeHtml(c.sequence.name)})</li>` : "<li>Your 5-touch outbound sequence</li>"}
        <li>Your LinkedIn campaign - ready to enroll prospects</li>
        ${c.blueprint?.themes?.length ? `<li>30 days of content angles across ${c.blueprint.themes.length} themes</li>` : "<li>30-day content plan</li>"}
        ${c.agent?.name ? `<li>${escapeHtml(c.agent.name)} - your booking assistant</li>` : "<li>Your AI booking agent</li>"}
        <li>Your 60-day plan</li>
      </ul>
      <p>Cancel and it all pauses. Your prospects stop hearing from you. The agent goes dark.</p>
      <p><strong>$67/month</strong> or <strong>$490/year</strong> (saves $314). One-click cancel anytime from settings.</p>
      <p style="margin:24px 0;">${btn("Keep my pipeline running", `${APP_URL}/settings/billing`)}</p>
    `),
  },

  // ── T+3h: Knowledge base reveal (what your agent knows about your offer) ──
  {
    key: "reveal_knowledge",
    phase: "trial",
    stream: "reveals",
    minHours: 2.5,
    maxHours: 5.5,
    subject: () => `Here's what your AI agent knows about you (preview)`,
    html: (c) => {
      const snippet = (c.knowledge?.content || "").slice(0, 500);
      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Quick one. Your agent doesn't reply blindly - it reads a knowledge base we built about your offer, your voice, and your proof. Here's the first chunk so you can see what it actually thinks you sell.</p>
        ${snippet ? asset("Your knowledge base - offer section", [
          `<div style="font-size:13px;white-space:pre-wrap;font-style:italic;opacity:0.88;">${escapeHtml(snippet)}${(c.knowledge?.content || "").length > 500 ? "…" : ""}</div>`,
        ]) : `<p style="opacity:0.7;">(Knowledge base is in your workspace.)</p>`}
        <p>If this misrepresents what you sell, edit it now - every reply, every campaign message, every content idea downstream uses this as ground truth.</p>
        <p style="margin:24px 0;">${btn("Open knowledge base", `${APP_URL}/knowledge`)}</p>
        <p style="font-size:13px;opacity:0.65;">Coming next: your LinkedIn audit.</p>
      `);
    },
  },

  // ── T+44h: Strategy doc reveal ────────────────────────────────────────────
  {
    key: "reveal_strategy",
    phase: "trial",
    stream: "reveals",
    minHours: 43,
    maxHours: 50,
    subject: () => `Your 60-day plan, day by day - open it now`,
    html: (c) => {
      const preview = (c.strategy?.content || "").slice(0, 600);
      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Most founders fail at outbound because they have no plan. They wing it for 2 weeks, get demoralized, and quit. We wrote a 60-day plan tailored to ${c.icp ? escapeHtml(c.icp.name.split(" ")[0]) : "your buyer"} so you don't have to guess what to do on any given Tuesday.</p>
        ${preview ? asset("Your 60-day plan - opening section", [
          `<div style="font-size:13px;white-space:pre-wrap;opacity:0.88;">${escapeHtml(preview)}${(c.strategy?.content || "").length > 600 ? "…" : ""}</div>`,
        ]) : `<p style="opacity:0.7;">(Strategy doc is in your workspace.)</p>`}
        <p>Days 1-14 are about foundation. Days 15-30 are about first contact. Days 31-45 about conversion. Days 46-60 about compounding what works. Brutal-but-actionable, calibrated for your offer.</p>
        <p style="margin:24px 0;">${btn("Open my 60-day plan", `${APP_URL}/library/strategies`)}</p>
        <p style="font-size:13px;opacity:0.65;">Tomorrow: meet your AI booking agent.</p>
      `);
    },
  },

  // ── T+60h: 12-hour mid-urgency ────────────────────────────────────────────
  {
    key: "trial_12h_left",
    phase: "trial",
    stream: "checkins",
    minHours: 58,
    maxHours: 65,
    skipIf: (c) => !!c.org.stripe_subscription_id,
    subject: () => `12 hours left - and the prospects you haven't enrolled yet`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Quick check - your trial ends in about 12 hours.</p>
      <p>The interesting question isn't "will you keep ACA" - it's "what would the next 7 days look like if you actually ran what's already built?"</p>
      <ul style="padding-left:20px;line-height:1.65;">
        <li><strong>${c.hasLeads ? "✅" : "⬜"} Prospects loaded</strong>${!c.hasLeads ? ` - <a href="${APP_URL}/leads/lists">import 10 now</a> and the sequence starts going out tonight` : ""}</li>
        <li><strong>${c.hasUnipile ? "✅" : "⬜"} LinkedIn connected</strong>${!c.hasUnipile ? ` - <a href="${APP_URL}/senders">pair your account</a> so the campaign can enroll them` : ""}</li>
        <li><strong>${c.hasOpenRouter ? "✅" : "⬜"} OpenRouter key</strong>${!c.hasOpenRouter ? ` - <a href="${APP_URL}/settings?tab=integrations">connect a key</a> so the agent can actually draft replies` : ""}</li>
      </ul>
      <p>If two of those are still empty, the trial's not really being tested. Spend 15 minutes filling the gaps, then decide.</p>
      <p style="margin:24px 0;">${btn("Open my workspace", `${APP_URL}/jobs`)}</p>
    `),
  },

  // ═════════════════════════════════════════════════════════════════════════
  // WINBACK - trial expired, no Stripe subscription. Anchored on
  // trial_ends_at. We get ~9 days before the workspace gets archived/cooled.
  // ═════════════════════════════════════════════════════════════════════════

  // ── T+2h after trial end: workspace paused notice + 7-day grace ─────────
  {
    key: "winback_paused",
    phase: "winback",
    stream: "winback",
    minHours: 0,
    maxHours: 22,
    subject: (c) => `Your workspace is paused - we'll keep it for 7 days`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Your trial just ended without a card on file. No problem - but we wanted to be transparent about what happens to everything we built you.</p>
      <p>Right now your workspace is <strong>paused, not deleted</strong>. We'll hold it intact for 7 days:</p>
      <ul style="padding-left:20px;line-height:1.65;">
        ${c.icp ? `<li>Your buyer profile (${escapeHtml(c.icp.name)})</li>` : ""}
        <li>Your 5-touch sequence</li>
        <li>Your LinkedIn campaign graph</li>
        <li>30 days of content angles</li>
        ${c.agent?.name ? `<li>${escapeHtml(c.agent.name)} - your reply agent</li>` : "<li>Your AI booking agent</li>"}
        <li>Your 60-day plan</li>
      </ul>
      <p>If you reactivate within 7 days, everything wakes up exactly where you left it - no re-onboarding. After that, we archive the org and you start fresh.</p>
      <p style="margin:24px 0;">${btn("Reactivate my workspace", `${APP_URL}/settings/billing`)}</p>
      <p style="font-size:13px;opacity:0.65;">No card. No commitment. Cancel anytime.</p>
    `),
  },

  // ── Day 4 after trial end (~T+24h): feedback ask ────────────────────────
  {
    key: "winback_feedback",
    phase: "winback",
    stream: "winback",
    minHours: 22,
    maxHours: 50,
    subject: (c) => `${c.firstName || "Quick"} - one question, takes 30 seconds`,
    html: (c) => wrap(`
      <p>Hey ${c.firstName || "there"},</p>
      <p>Cedric here. I'm the founder. I look at every trial that didn't convert, personally, because I'm trying to figure out what we got wrong.</p>
      <p>One question, real answer, no follow-up sales pressure:</p>
      <p style="font-size:17px;font-weight:600;padding:16px 0;border-left:3px solid #D4361A;padding-left:14px;background:#FFF8F4;margin:18px 0;">What was the one thing missing that would have made you stay?</p>
      <p>Hit reply. Two sentences is plenty. I read every one and the answers shape what we build next.</p>
      <p style="margin-top:20px;"> - Cedric</p>
      <p style="font-size:13px;opacity:0.65;margin-top:24px;">PS: workspace is still paused, still recoverable - but no pressure either way.</p>
    `),
  },

  // ── Day 5 after trial end (~T+48h): comeback offer ──────────────────────
  {
    key: "winback_offer",
    phase: "winback",
    stream: "winback",
    minHours: 50,
    maxHours: 80,
    subject: () => `Try it for real - 50% off month 1 if you come back this week`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>3 days isn't a real test. Most members say it takes ~10 days to see the first reply land - your workspace was barely warm by the time the trial ended.</p>
      <p>So here's an honest do-over: come back within the next 4 days and your first month is <strong>$33.50 instead of $67</strong>. Half off. No catches, no upsell, no annual lock-in.</p>
      <p>Use code <strong style="font-family:ui-monospace,Menlo,monospace;background:#FFF8F4;padding:3px 8px;border-radius:4px;border:1px solid rgba(212,54,26,0.2);">COMEBACK50</strong> at checkout.</p>
      <p style="margin:24px 0;">${btn("Reactivate · 50% off month 1", `${APP_URL}/settings/billing?coupon=COMEBACK50`)}</p>
      <p style="font-size:13px;opacity:0.65;">Code expires in 4 days. Workspace archives in 3.</p>
    `),
  },

  // ── Day 7 after trial end (~T+120h): last chance ────────────────────────
  {
    key: "winback_last_chance",
    phase: "winback",
    stream: "winback",
    minHours: 110,
    maxHours: 144,
    subject: () => `Tomorrow we archive - last call`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Tomorrow at this time we permanently archive your workspace. Buyer profile, sequences, campaign graph, content plan, agent config - all gone.</p>
      <p>Not gone-gone (we keep cold backups for compliance), but you'd be starting from a blank /get-started instead of picking up where you left off.</p>
      <p>If there's a chance you'll come back in the next month or two, reactivate today and skip the rebuild.</p>
      <p style="margin:24px 0;">${btn("Reactivate · COMEBACK50 still works", `${APP_URL}/settings/billing?coupon=COMEBACK50`)}</p>
      <p style="font-size:13px;opacity:0.65;">After tomorrow this email goes away too.</p>
    `),
  },

  // ── Day 14 after trial end: founder personal note ───────────────────────
  {
    key: "winback_personal",
    phase: "winback",
    stream: "winback",
    minHours: 280,
    maxHours: 340,
    subject: (c) => `${c.firstName || "Hey"} - just keeping in touch`,
    html: (c) => wrap(`
      <p>Hey ${c.firstName || "there"},</p>
      <p>This is just from me. Not the system, not a sequence. I noticed your workspace got archived last week and wanted to send one last note.</p>
      <p>If you're still wrestling with whatever brought you to ACA in the first place - the outbound that doesn't reply, the inbound that doesn't book, the content that doesn't pull - I'd genuinely love to hear what you ended up doing instead. Sometimes the answer is "we just hired an SDR" or "we gave up on outbound for now" or "we tried X tool" and that's all useful signal to me.</p>
      <p>Reply if you feel like it. If not, no worries - good luck with the goal.</p>
      <p style="margin-top:20px;"> - Cedric</p>
    `),
  },

  // ═════════════════════════════════════════════════════════════════════════
  // POST-CONVERSION - user added a card. Drive first-week activation, then
  // weekly check-ins for the first 30 days. Anchored on conversion time.
  // ═════════════════════════════════════════════════════════════════════════

  // ── T+15min after Stripe success: "you're in" + first action ────────────
  {
    key: "pc_welcome",
    phase: "post_conversion",
    stream: "checkins",
    minHours: 0,
    maxHours: 22,
    subject: (c) => `You're in, ${c.firstName || "welcome"}. Here's the first thing to do today.`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>You're officially in. Card on file, workspace unlocked, all the assets we built are yours to actually run now.</p>
      <p>One ask for today - <strong>do not over-think it</strong>:</p>
      <p style="font-size:17px;font-weight:600;padding:16px 0;border-left:3px solid #D4361A;padding-left:14px;background:#FFF8F4;margin:18px 0;">Import 10 prospects. Enroll them in the sequence. That's it.</p>
      <p>Why 10: it's enough signal to see if the sequence works for ${c.icp ? escapeHtml(c.icp.name.split(" ")[0]) : "your buyer"} without burning your reputation. If you get 1-2 replies in the first week, scale to 50. If you get zero, we figure out why together.</p>
      <p style="margin:24px 0;">${btn("Import 10 prospects now", `${APP_URL}/leads/lists`)}</p>
      <p style="font-size:13px;opacity:0.65;">Tomorrow I'll send the 3 settings most members regret not dialing in early. Watch for it.</p>
    `),
  },

  // ── Day 1 post-conversion: 3 settings to dial ────────────────────────────
  {
    key: "pc_settings",
    phase: "post_conversion",
    stream: "checkins",
    minHours: 22,
    maxHours: 38,
    subject: () => `The 3 settings members wish they'd dialed in day 1`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>You're 24 hours in. Three things that members consistently say they regret not setting up earlier:</p>
      <p><strong>1. Your sending hours.</strong> The default is 9am-5pm in your prospects' timezone. If you target US-only and you're in Europe, ACA already adjusts - but double-check the timezone on your sequence. <a href="${APP_URL}/sequences">Check sequence settings</a></p>
      <p><strong>2. Your agent's escalation triggers.</strong> By default the agent escalates anything it's <70% confident on. Bump that down to 50% the first week - better to over-escalate than send a wrong-tone reply.</p>
      <p><strong>3. Your daily send cap.</strong> If you're brand new on a domain, cap at 25-30/day per inbox. Ramp gradually. <a href="${APP_URL}/email/infrastructure">Check infra settings</a></p>
      <p style="margin:24px 0;">${btn("Dial in my settings", `${APP_URL}/settings`)}</p>
      <p style="font-size:13px;opacity:0.65;">Day 4 I'll send the 50-prospect framework. That's when this starts compounding.</p>
    `),
  },

  // ── Day 4 post-conversion: 50-prospect framework ─────────────────────────
  {
    key: "pc_50_framework",
    phase: "post_conversion",
    stream: "education",
    minHours: 90,
    maxHours: 110,
    subject: () => `The 50-prospect framework - what to load next`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Day 4. If you loaded the first 10 like I asked, you've probably seen at least one reply, or some bounces, or maybe some real signal on who actually engages with the messaging.</p>
      <p>Here's the framework to scale to the next 50:</p>
      <ul style="padding-left:20px;line-height:1.7;">
        <li><strong>15 prospects who fit your ICP exactly</strong> - same role, same company size, same trigger as the buyer profile.</li>
        <li><strong>15 prospects in adjacent roles</strong> - same company, different title (maybe a level above or below your ICP). Tests if you're targeting the wrong person.</li>
        <li><strong>15 prospects in adjacent industries</strong> - same role + size, but in a different vertical. Tests if your offer translates.</li>
        <li><strong>5 wildcards</strong> - companies you'd love to land but aren't a perfect fit. You only learn the edges by testing them.</li>
      </ul>
      <p>After this batch, you'll have real signal on what to scale and what to drop.</p>
      <p style="margin:24px 0;">${btn("Load my next 50", `${APP_URL}/leads/lists`)}</p>
    `),
  },

  // ── Day 7 post-conversion: "what hit 10 meetings in week 1" ─────────────
  {
    key: "pc_week1_review",
    phase: "post_conversion",
    stream: "checkins",
    minHours: 160,
    maxHours: 200,
    subject: () => `Members who hit 10 meetings in week 1 did these 3 things`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>You've had ACA for a week. Some members are at 0 meetings, some are at 10+. Here's what the top decile actually did:</p>
      <p><strong>1. They edited the first cold email.</strong> Not rewrote - edited. Took the AI draft, made it 30% shorter, swapped one specific reference, hit send. The voice was theirs, not the LLM's.</p>
      <p><strong>2. They replied to inbound within 4 hours.</strong> The booking agent drafts; they approve. The lag matters more than the wording. People who book have momentum and lose it fast.</p>
      <p><strong>3. They added a second sender within 5 days.</strong> One inbox caps your volume. Two inboxes = 2× the at-bats with the same sequence + same agent.</p>
      <p>None of this is magic. It's just doing the thing the system already built for you.</p>
      <p style="margin:24px 0;">${btn("Review my week 1 numbers", `${APP_URL}/analytics`)}</p>
      <p style="font-size:13px;opacity:0.65;">Hit reply if you're stuck on any of these. I'll personally help you debug.</p>
    `),
  },

  // ── Day 14 post-conversion: two-week check-in ────────────────────────────
  {
    key: "pc_2week_checkin",
    phase: "post_conversion",
    stream: "checkins",
    minHours: 330,
    maxHours: 380,
    subject: () => `Two weeks in - what's your number?`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Two weeks in. By now you have real data: prospects sent, reply rate, meetings booked, deals in motion. That's the floor we work up from.</p>
      <p>Three numbers that matter at this stage:</p>
      <ul style="padding-left:20px;line-height:1.7;">
        <li><strong>Reply rate.</strong> Anything above 6% is solid. Below 3% means the messaging is off (or the list is wrong).</li>
        <li><strong>Positive reply rate.</strong> Of the replies, how many are "yes, tell me more" vs "remove me"? Aim for 50%+.</li>
        <li><strong>Meeting-to-prospect ratio.</strong> A good system books 1-2 meetings per 100 prospects in the first month. Top 10% hit 4-5.</li>
      </ul>
      <p>Pull your dashboard, compare to those, and reply with where you're at. I'll tell you what to optimize next.</p>
      <p style="margin:24px 0;">${btn("Open my analytics", `${APP_URL}/analytics`)}</p>
      <p style="margin-top:20px;"> - Cedric</p>
    `),
  },

  // ── Day 30 post-conversion: month-1 retrospective ────────────────────────
  {
    key: "pc_month1",
    phase: "post_conversion",
    stream: "checkins",
    minHours: 700,
    maxHours: 760,
    skipIf: (c) => c.org.subscription_status !== "active",
    subject: () => `Month 1 - the retrospective question every operator should ask`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>You've been with us 30 days. Most subscriptions auto-renewed in your inbox without any reflection - let's not let this one slip past.</p>
      <p>One question:</p>
      <p style="font-size:17px;font-weight:600;padding:16px 0;border-left:3px solid #D4361A;padding-left:14px;background:#FFF8F4;margin:18px 0;">Is what's happening in your pipeline this month worth $67 - or is it worth way more, or way less?</p>
      <p>If "way more": consider switching to annual. You'll save $314 and lock in this rate. <a href="${APP_URL}/settings/billing">Switch to yearly →</a></p>
      <p>If "way less": tell me why. We're cheaper than the cheapest SDR, but $67/mo for nothing is still $67/mo for nothing. Reply and we'll figure out what's broken.</p>
      <p>Either way - you crossed the line from trial to operator. That's not nothing.</p>
      <p style="margin-top:20px;"> - Cedric</p>
    `),
  },

  // ═════════════════════════════════════════════════════════════════════════
  // TRIAL - STRATEGIC EDUCATION (add real plays they can run today)
  // ═════════════════════════════════════════════════════════════════════════

  // ── T+8h: Comment-to-DM - LLM-personalized example for their niche ────────
  {
    key: "edu_comment_to_dm",
    phase: "trial",
    stream: "education",
    minHours: 7.5,
    maxHours: 11,
    subject: () => `The "comment-to-DM" play - your highest-leverage 30 min today`,
    html: async (c) => {
      const icpBlock = c.icp ? `
Buyer: ${c.icp.name}
Buyer summary: ${c.icp.summary}
Top pain: ${c.icp.pains[0] || "(unknown)"}` : "Niche-agnostic.";

      const prompt = `Write the EXAMPLE COMMENT and EXAMPLE DM for the comment-to-DM play, tailored to this seller's buyer.

## Seller
Name: ${c.firstName || "founder"}
${icpBlock}

## Output format - HTML only, no fences, no preamble

Output this exact structure:

<div style="background:#FFF8F4;border:1px solid rgba(212,54,26,0.18);border-radius:10px;padding:14px 18px;margin:18px 0;">
<div style="font-size:10.5px;font-family:ui-monospace,Menlo,monospace;letter-spacing:0.06em;text-transform:uppercase;color:#D4361A;font-weight:600;margin-bottom:8px;">EXAMPLE FOR YOUR BUYER</div>

<p style="margin:6px 0;"><strong>Post you'd comment on:</strong></p>
<p style="margin:6px 0;font-style:italic;opacity:0.85;">"[a 2-3 sentence example LinkedIn post that your buyer would likely engage with - written as if from a thought leader they follow]"</p>

<p style="margin:14px 0 6px;"><strong>Your comment (substantive, with a frame):</strong></p>
<p style="margin:6px 0;font-style:italic;opacity:0.85;">"[a 3-4 sentence smart comment that adds a frame, disagrees intelligently, or shares a specific number. Reference the buyer's actual world.]"</p>

<p style="margin:14px 0 6px;"><strong>Follow-up DM (after they like/reply):</strong></p>
<p style="margin:6px 0;font-style:italic;opacity:0.85;">"[a 4-5 sentence DM that opens with their comment context, shares one insight, asks ONE specific question. Does not pitch.]"</p>
</div>

Make every line ring true for THIS specific buyer's world. Use their real vocabulary, real numbers if you can infer them, real pain.`;

      const example = await callLLMForEmail(prompt, 1400, 0.7, { voiceGuidance: c.voiceGuidance, stageFeedback: c.stageFeedback });

      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Outbound is one half. Inbound is the other. Today: the simplest inbound play that works without paid ads, without an audience, without a content factory.</p>
        <p><strong>The play:</strong></p>
        <ol style="padding-left:20px;line-height:1.7;">
          <li>Find 5 LinkedIn posts where your ICP commented yesterday.</li>
          <li>Drop a sharp, substantive comment on each - disagree intelligently, add a frame they didn't, share a number.</li>
          <li>When the post author or any commenter likes/replies - open the DM. Don't pitch. Reference their comment, share a one-line insight, ask one question.</li>
          <li>Track who responds. That's your inbound qualified list.</li>
        </ol>
        ${example || ""}
        <p>Most members get 1-2 meetings from this per week, zero outbound required. ACA's <strong>Magnets</strong> feature tracks the posts your ICP engages with and surfaces the live comment opportunities daily.</p>
        <p style="margin:24px 0;">${btn("Open Magnets · find live posts", `${APP_URL}/magnets`)}</p>
      `);
    },
  },

  // ── T+14h: Lead magnet ideas - LLM-personalized per ICP ──────────────────
  {
    key: "edu_lead_magnets",
    phase: "trial",
    stream: "education",
    minHours: 13,
    maxHours: 17,
    subject: (c) => c.icp?.name
      ? `5 lead magnet ideas for ${c.icp.name.split(" ")[0]}`
      : `5 lead magnet ideas your buyer would actually download`,
    html: async (c) => {
      const icpBlock = c.icp ? `
Their buyer: ${c.icp.name}
Buyer summary: ${c.icp.summary}
Top pains: ${c.icp.pains.slice(0, 4).join(" | ")}` : `No specific ICP yet - make the ideas niche-agnostic but actionable.`;

      const prompt = `Write the BODY of an email from Cedric to a B2B founder. The email pitches 5 specific lead-magnet ideas tailored to THIS seller's ICP. Not generic ("the teardown", "the swipe file") - actual concrete examples that name the buyer's pain, the format, the title, and a 1-line reason it works.

## Seller
Name: ${c.firstName || "founder"}
${icpBlock}

## Output format (HTML, no fences, no preamble)
Write 5 lead-magnet ideas as a numbered list. Each idea:
  <li><strong>"[Specific title in quotes]"</strong> - [1 sentence explaining why this exact magnet would convert THIS buyer, referencing their pain by name. Then 1 fragment on format/length, e.g. "PDF, 6 pages, 1 hour to make".]</li>

Make every title concrete. Bad: "Ultimate Guide to X". Good: "The 3 reconciliation traps that cost €8M ARR SaaS CFOs 40 hours/month - and the 2 fixes that take a Tuesday".

After the 5 ideas, end with a 1-sentence push: which one to ship THIS WEEK given their stage, and why.`;

      const personalized = await callLLMForEmail(prompt, 1600, 0.65, { voiceGuidance: c.voiceGuidance, stageFeedback: c.stageFeedback });
      const body = personalized || `<ol style="padding-left:20px;line-height:1.75;">
        <li><strong>The teardown.</strong> "I audited 10 [ICP role]'s LinkedIn profiles - here's the pattern that's costing them meetings." Specific. Concrete. Steals their attention.</li>
        <li><strong>The swipe file.</strong> "The exact [thing] I used to [outcome]." 1 PDF, 6 examples, 30 min to make.</li>
        <li><strong>The calculator.</strong> "What's [your specific pain] actually costing you? Plug in your numbers." Notion template + 5 cells.</li>
        <li><strong>The checklist.</strong> Not generic. Pre-launch, pre-meeting, pre-renewal - whatever moment your ICP is anxious in.</li>
        <li><strong>The Loom teardown of their own thing.</strong> Personal, 90-second video reviewing their site / LinkedIn / offer. Costs you 5 min. Wins more meetings than any guide.</li>
      </ol>`;

      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Most lead magnets fail because they're "Ultimate Guide" PDFs nobody asked for. The ones that work solve <strong>one specific pain in one specific way</strong> for a real person - your ICP.</p>
        ${c.icp ? `<p>For ${escapeHtml(c.icp.name)}, here's what would actually convert:</p>` : "<p>Here's what works across B2B:</p>"}
        ${body}
        <p style="margin:18px 0 8px;">Gate it behind a comment-to-DM in your LinkedIn campaign and you'll have qualified opt-ins by end of week.</p>
        <p style="margin:24px 0;">${btn("Set up a lead magnet", `${APP_URL}/magnets`)}</p>
      `);
    },
  },

  // ── T+30h: Email infrastructure 101 ──────────────────────────────────────
  {
    key: "edu_infra",
    phase: "trial",
    stream: "education",
    minHours: 29,
    maxHours: 34,
    subject: () => `Email infrastructure 101 - what to set up BEFORE you send 100/day`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>One of the most expensive mistakes I see new operators make: <strong>they send 100 cold emails a day from their main domain, get marked as spam, and burn their company inbox for 6 months</strong>.</p>
      <p>Don't do that. Here's the right setup:</p>
      <p><strong>1. Buy 2-3 secondary domains.</strong> Variations of your main domain (e.g. tryacquist.com if yours is acquist.com). $12 each on Cloudflare. These are your sending domains - your main domain stays clean.</p>
      <p><strong>2. Set up DKIM + SPF + DMARC on each.</strong> ACA handles this automatically if you go through our infra. Otherwise: 15-min manual setup per domain.</p>
      <p><strong>3. Warm each inbox for 14-21 days BEFORE real sends.</strong> ACA auto-warms via our infrastructure. Manually it's a slog.</p>
      <p><strong>4. Cap each inbox at 25-30 sends/day for the first month.</strong> Ramp slowly. Top-of-mind goal: stay under spam thresholds, not maximize volume.</p>
      <p>You can do all of this yourself. Or you can use ACA's BYO M365 infrastructure: $0.66/inbox/month all-in, including warmup, DKIM/SPF/DMARC, and rotation. Most members spin up 3-5 senders in their first week.</p>
      <p style="margin:24px 0;">${btn("Provision email infrastructure", `${APP_URL}/email/infrastructure`)}</p>
    `),
  },

  // ═════════════════════════════════════════════════════════════════════════
  // POST-CONVERSION - OPERATING SYSTEM (daily briefs, weekly plays, content
  // drops, infrastructure prompts). Designed so people genuinely cannot fail
  // even if they barely log in.
  // ═════════════════════════════════════════════════════════════════════════

  // ── Day 2 post-conversion: today's 3 actions tailored to state ──────────
  {
    key: "pc_daily_brief_d2",
    phase: "post_conversion",
    stream: "daily_briefs",
    minHours: 46,
    maxHours: 60,
    subject: () => `Today's 3 actions (5-min playbook)`,
    html: (c) => {
      // Build the 3 actions from LIVE state - what's actually missing/needed
      // for THIS user right now, not generic "do X, Y, Z".
      const actions: string[] = [];

      // 1. Inbox: only matters if they have leads AND there's drafts waiting
      if (c.hasLeads) {
        actions.push(`<li><strong>Open the inbox.</strong> Approve any agent drafts waiting on you. Under 4h reply lag on positive replies = your highest-converting move. <a href="${APP_URL}/inbox">Open inbox →</a></li>`);
      }

      // 2. Prospects: priority shifts based on whether they've imported yet
      if (!c.hasLeads) {
        actions.push(`<li><strong>Load your first 10 prospects.</strong> Nothing happens until people are in the system. Paste a Sales Nav URL, drop a CSV, or pull from the 123M pool. <a href="${APP_URL}/leads/lists">Import now →</a></li>`);
      } else {
        actions.push(`<li><strong>Add 10 fresh prospects.</strong> Different vertical or seniority than yesterday - keeps your testing signal strong. <a href="${APP_URL}/leads/lists">Open lead lists →</a></li>`);
      }

      // 3. Channel - push the one they haven't connected yet
      if (!c.hasUnipile) {
        actions.push(`<li><strong>Connect LinkedIn.</strong> Without it your campaign can't enroll prospects. Takes 30 seconds. <a href="${APP_URL}/senders">Pair LinkedIn →</a></li>`);
      } else {
        actions.push(`<li><strong>Comment-to-DM: 3 LinkedIn posts.</strong> Open Magnets, find 3 posts ${c.icp ? escapeHtml(c.icp.name.split(" ")[0]) : "your ICP"} engaged with yesterday, drop a substantive comment on each. <a href="${APP_URL}/magnets">Open Magnets →</a></li>`);
      }

      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Five minutes, three things, tuned to where you actually are right now:</p>
        <ol style="padding-left:20px;line-height:1.8;">${actions.join("")}</ol>
        <p>If you do those three things M-F, you'll be at 10+ meetings in week 1. I'll send another check-in tomorrow.</p>
        <p style="font-size:13px;opacity:0.65;"> - Cedric</p>
      `);
    },
  },

  // ── Day 3: real LinkedIn post generated fresh per send ───────────────────
  {
    key: "pc_content_drop_d3",
    phase: "post_conversion",
    stream: "content_drops",
    minHours: 64,
    maxHours: 80,
    subject: (c) => c.blueprint?.themes?.[0]?.theme
      ? `Today's LinkedIn post - paste-ready · theme: ${c.blueprint.themes[0].theme}`
      : `Today's LinkedIn post - paste-ready`,
    html: async (c) => {
      const theme = c.blueprint?.themes?.[0];
      const icpBlock = c.icp ? `
Buyer to pull in: ${c.icp.name}
Buyer's #1 pain: ${c.icp.pains[0] || "(unknown)"}` : "";

      const prompt = `Write ONE real LinkedIn post for the seller to publish today. Paste-ready, no caveats.

## Seller
Name: ${c.firstName || "founder"}
${icpBlock}

## Today's theme
${theme?.theme || "general thought leadership"}
${theme?.hook_pattern ? `Hook pattern to follow: ${theme.hook_pattern}` : ""}
${theme?.example_post ? `Example tone (DON'T copy, just match the voice):\n${theme.example_post.slice(0, 400)}` : ""}

## Output - HTML only, no preamble

<div style="background:#FFF8F4;border:1px solid rgba(212,54,26,0.18);border-radius:10px;padding:18px 22px;margin:18px 0;font-size:14px;line-height:1.6;white-space:pre-wrap;">[the actual post, 180-280 words, written in the seller's voice, with line breaks for LinkedIn formatting. NO emojis unless they're natural for the niche. NO "What do you think?" CTA at the end. Open with a hook line that stops scroll. End with a sentence that invites comment without asking for it.]</div>

The post must reference a specific number, story, or example that feels real. Vague is the enemy.`;

      const post = await callLLMForEmail(prompt, 1400, 0.75, { voiceGuidance: c.voiceGuidance, stageFeedback: c.stageFeedback });

      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>Day 3. Outbound's running. Time to start the inbound flywheel.</p>
        <p>I wrote a post for you to ship today. Paste it, ship it, take a coffee.</p>
        ${theme?.theme ? `<p style="font-size:13px;opacity:0.7;">Theme: <strong>${escapeHtml(theme.theme)}</strong>${theme.hook_pattern ? ` · Hook: ${escapeHtml(theme.hook_pattern)}` : ""}</p>` : ""}
        ${post || `<p style="opacity:0.7;">(Open the blueprint - your themes are ready and there's a pre-drafted post for each.)</p>`}
        <p>Posts written for ${c.icp ? escapeHtml(c.icp.name.split(" ")[0]) : "your buyer"} compound. By week 3 the same person sees you 4-5 times and starts replying without you outbound-ing them.</p>
        <p style="margin:24px 0;">${btn("Ship to LinkedIn now", "https://www.linkedin.com/feed/?shareActive=true")}</p>
        <p style="font-size:13px;opacity:0.65;">Tomorrow: the connection request framework.</p>
      `);
    },
  },

  // ── Day 5: connection request framework ──────────────────────────────────
  {
    key: "pc_connection_req",
    phase: "post_conversion",
    stream: "education",
    minHours: 110,
    maxHours: 130,
    subject: () => `The connection request that gets accepted 60%+ of the time`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>If your connection-request acceptance rate is under 40%, your LinkedIn campaign is starting from behind. Here's the formula members use to push it to 60%+:</p>
      <p><strong>Structure:</strong></p>
      <ol style="padding-left:20px;line-height:1.7;">
        <li><strong>Specific signal in line 1.</strong> Not "saw your post". Reference WHAT. "Your post on [topic]" or "your role at [company]" or "your move from [old role] to [current]".</li>
        <li><strong>One concrete thing you share in line 2.</strong> "I work with ${c.icp ? escapeHtml(c.icp.name.split(" ")[0]) : "people like you"} on [outcome]." No pitch yet - just shared territory.</li>
        <li><strong>No CTA in the request itself.</strong> Just the connect. The DM lands after they accept - that's where you go specific.</li>
      </ol>
      <p>Bad: "Hi Sarah, I'd love to connect and share how my software can help your business grow."</p>
      <p>Good: "Sarah - saw your move from Series A to Series B last month. I work with VP Engs on cutting deployment-time-to-value during scale-up phases. Worth being connected."</p>
      <p>Your campaign's connection-request copy is already drafted. Open it, tighten the line-1 signal to be hyper-specific to each batch of prospects, ship.</p>
      <p style="margin:24px 0;">${btn("Tune my connection request", `${APP_URL}/campaigns`)}</p>
    `),
  },

  // ── Day 10: infrastructure check ─────────────────────────────────────────
  {
    key: "pc_infra_check",
    phase: "post_conversion",
    stream: "checkins",
    minHours: 230,
    maxHours: 260,
    subject: () => `Time to add a 2nd inbox - you're hitting volume ceiling`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Ten days in. If you've been running the playbook, you're probably bumping against the 25-30 send/day cap on your primary inbox.</p>
      <p>This is the right moment to add a 2nd sending inbox. Reasons:</p>
      <ul style="padding-left:20px;line-height:1.65;">
        <li><strong>Volume.</strong> 2 inboxes = 50-60 sends/day = ~5 meetings/month vs ~2.</li>
        <li><strong>Risk distribution.</strong> If one domain gets warmth issues, the other keeps shipping.</li>
        <li><strong>A/B testing.</strong> Run subject variants across the two - you'll learn what your ICP actually opens.</li>
      </ul>
      <p>ACA's BYO M365 setup: $0.66/inbox/month all-in (mailbox + warmup + DKIM/SPF/DMARC + auto-rotation). Provisioning takes ~10 minutes for the second inbox since your domain is already verified.</p>
      <p style="margin:24px 0;">${btn("Provision a 2nd inbox", `${APP_URL}/email/infrastructure`)}</p>
      <p style="font-size:13px;opacity:0.65;">Members who add a 2nd inbox in week 2 are 2.3× more likely to hit their first 10 meetings vs single-inbox operators.</p>
    `),
  },

  // ── Day 21: comment-to-DM as long-term play ─────────────────────────────
  {
    key: "pc_compound_play",
    phase: "post_conversion",
    stream: "education",
    minHours: 490,
    maxHours: 540,
    subject: () => `Your authority compound machine - the 21-day check-in`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Three weeks in. Outbound + content is now familiar. Here's what most members miss: <strong>the compound machine</strong>.</p>
      <p>Comment-to-DM isn't a one-off play. Run consistently for 90 days, it stops being outbound and becomes inbound. Pattern:</p>
      <ol style="padding-left:20px;line-height:1.7;">
        <li><strong>Days 1-30:</strong> Comment on your ICP's posts daily. Substantive, with-a-frame. You're showing up in their feed.</li>
        <li><strong>Days 31-60:</strong> Their followers notice you. You're "the person who keeps making the smart points in [X] comments." Now you start getting tagged in conversations.</li>
        <li><strong>Days 61-90:</strong> The DMs start flipping. Prospects who you'd cold-emailed at month 1 are now reaching out to YOU. Your reply rate doubles, your meeting-to-prospect ratio triples.</li>
      </ol>
      <p>Two things to check today:</p>
      <ul style="padding-left:20px;line-height:1.65;">
        <li>Are you commenting daily? (Check Magnets - should show your activity streak.)</li>
        <li>Are your comments getting likes/replies? If <em>nobody engages with your comments</em>, the comments themselves are the problem. Disagree harder. Add a frame nobody else did. Use a number.</li>
      </ul>
      <p style="margin:24px 0;">${btn("Open Magnets · review activity", `${APP_URL}/magnets`)}</p>
    `),
  },

  // ═════════════════════════════════════════════════════════════════════════
  // WIN-BACK - STRATEGIC FREE VALUE (give first, ask later)
  // ═════════════════════════════════════════════════════════════════════════

  // ── Day 6 after trial end: "what we'd do if we were you" ─────────────────
  {
    key: "winback_play",
    phase: "winback",
    stream: "winback",
    minHours: 75,
    maxHours: 110,
    subject: () => `What we'd do in your first 30 days, even without ACA`,
    html: (c) => wrap(`
      <p>Hey ${c.firstName || "there"},</p>
      <p>Selfishly, I'd rather you came back. Honestly, I'd rather you actually solve the problem that brought you to us.</p>
      <p>So here's the 30-day plan I'd run if you were doing this without any tools at all:</p>
      <p><strong>Days 1-7:</strong> Define ONE ICP. Not "founders" - "${c.icp ? escapeHtml(c.icp.name) : "Bootstrap SaaS CFOs at €5-15M ARR"}." Find 50 of them on LinkedIn. Connect with a specific-signal first line. Aim 60%+ acceptance.</p>
      <p><strong>Days 8-21:</strong> DM the connections that accepted. Reference their actual situation (look at their profile/posts). One question. Track which ones reply.</p>
      <p><strong>Days 22-30:</strong> Comment on the posts of 3 thought leaders your ICP follows, daily. Substantive comments only. The ones that get likes are your inbound feeders for month 2.</p>
      <p>That's it. No software needed. Whether you do it manually or come back to ACA, the playbook works.</p>
      <p>If you do want the system to handle the boring parts (warmup, rotation, agent replies, content drops) - workspace is still warm.</p>
      <p style="margin:24px 0;">${btn("Come back - your workspace is paused not deleted", `${APP_URL}/settings/billing?coupon=COMEBACK50`)}</p>
      <p style="margin-top:20px;"> - Cedric</p>
    `),
  },
];

// ─── Asset loading ─────────────────────────────────────────────────────────
async function loadAssets(supabase: SupabaseClient, orgId: string): Promise<{
  icp: DripCtx["icp"];
  audit: DripCtx["audit"];
  sequence: DripCtx["sequence"];
  blueprint: DripCtx["blueprint"];
  agent: DripCtx["agent"];
  knowledge: DripCtx["knowledge"];
  strategy: DripCtx["strategy"];
  hasLeads: boolean;
  hasUnipile: boolean;
  hasOpenRouter: boolean;
}> {
  const [icpQ, auditQ, seqQ, bpQ, agentQ, knowQ, stratQ, leadsQ, unipileQ, openrouterQ] = await Promise.all([
    supabase.from("library_icps").select("name, summary, pain_points").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("linkedin_audits").select("overall_score, headline_rewrite, about_rewrite, summary, status, recommendations, headline_score, about_score, banner_score, activity_score").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("email_sequences").select("name, steps").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("blueprints").select("name, structure").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("ai_agent_profiles").select("name, config").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("library_strategy_documents").select("content").eq("organization_id", orgId).eq("document_type", "knowledge").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("library_strategy_documents").select("content").eq("organization_id", orgId).eq("document_type", "strategy").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("crm_contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("unipile_accounts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("api_keys").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("provider", "openrouter").eq("is_valid", true),
  ]);

  const icp = icpQ.data ? {
    name: (icpQ.data.name as string) || "",
    summary: (icpQ.data.summary as string) || "",
    pains: (icpQ.data.pain_points as string[]) || [],
  } : null;

  const audit = auditQ.data ? {
    overall: (auditQ.data.overall_score as number | null) ?? null,
    headline: (auditQ.data.headline_rewrite as string | null) ?? null,
    about: (auditQ.data.summary as string | null) ?? (auditQ.data.about_rewrite as string | null) ?? null,
    status: (auditQ.data.status as string | null) ?? null,
    summary: (auditQ.data.summary as string | null) ?? null,
    aboutRewrite: (auditQ.data.about_rewrite as string | null) ?? null,
    recommendations: (auditQ.data.recommendations as string[] | null) ?? [],
    headlineScore: (auditQ.data.headline_score as number | null) ?? null,
    aboutScore: (auditQ.data.about_score as number | null) ?? null,
    bannerScore: (auditQ.data.banner_score as number | null) ?? null,
    activityScore: (auditQ.data.activity_score as number | null) ?? null,
  } : null;

  const steps = (seqQ.data?.steps as Array<Record<string, unknown>>) || [];
  const firstStep = steps[0] ? {
    subject: steps[0].subject as string | undefined,
    body: steps[0].body as string | undefined,
  } : null;
  const sequence = seqQ.data ? {
    name: (seqQ.data.name as string | null) ?? null,
    firstStep,
  } : null;

  const themes = ((bpQ.data?.structure as Record<string, unknown> | null)?.themes as Array<Record<string, unknown>>) || [];
  const blueprint = bpQ.data ? {
    themes: themes.map((t) => ({
      theme: t.theme as string | undefined,
      hook_pattern: t.hook_pattern as string | undefined,
    })),
  } : null;

  const agentConfig = (agentQ.data?.config as Record<string, unknown> | null) || {};
  const agent = agentQ.data ? {
    name: (agentQ.data.name as string | null) ?? null,
    toneTraits: (agentConfig.tone_traits as string[]) || [],
  } : null;

  const knowledge = knowQ.data ? { content: (knowQ.data.content as string | null) ?? null } : null;
  const strategy  = stratQ.data ? { content: (stratQ.data.content as string | null) ?? null } : null;

  return {
    icp,
    audit,
    sequence,
    blueprint,
    agent,
    knowledge,
    strategy,
    hasLeads: (leadsQ.count ?? 0) > 0,
    hasUnipile: (unipileQ.count ?? 0) > 0,
    hasOpenRouter: (openrouterQ.count ?? 0) > 0,
  };
}

// ─── Resend send ───────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[drip] RESEND_API_KEY missing, skipping send to", to);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("[drip] resend failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[drip] send error", e);
    return false;
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Pull every onboarded org from the last 45 days. We need a wide window
    // because the post-conversion drip runs out to day 30 and the win-back
    // sequence runs to day 14 after trial end.
    const cutoff = new Date(Date.now() - 45 * 24 * 3600 * 1000).toISOString();
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, name, created_at, subscription_status, trial_ends_at, stripe_subscription_id")
      .gte("created_at", cutoff);
    if (error) throw error;

    let sent = 0;
    let scanned = 0;
    for (const org of orgs || []) {
      scanned += 1;
      const now = Date.now();
      const createdAt = new Date(org.created_at as string).getTime();
      const ageHours = (now - createdAt) / 3_600_000;
      const trialEndsAt = org.trial_ends_at ? new Date(org.trial_ends_at as string).getTime() : null;
      const hasSub = !!org.stripe_subscription_id;

      // Determine which phase this org is currently in.
      let phase: Phase;
      if (hasSub) {
        phase = "post_conversion";
      } else if (trialEndsAt && now > trialEndsAt) {
        phase = "winback";
      } else {
        phase = "trial";
      }

      // Idempotence + phase anchor lookup.
      const { data: state } = await supabase
        .from("onboarding_drip_state")
        .select("stages_sent, converted_at, last_sent_at")
        .eq("organization_id", org.id)
        .maybeSingle();
      const stagesSent: string[] = (state?.stages_sent as string[]) || [];

      // For post_conversion anchor: track when we first observed the
      // subscription. Persisted in onboarding_drip_state.converted_at so
      // later cron ticks compute "hours since conversion" consistently.
      let convertedAt: number | null = state?.converted_at ? new Date(state.converted_at as string).getTime() : null;
      if (phase === "post_conversion" && !convertedAt) {
        convertedAt = now;
        await supabase.from("onboarding_drip_state").upsert({
          organization_id: org.id,
          stages_sent: stagesSent,
          converted_at: new Date(convertedAt).toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      // Pick the "hours" anchor that matches this phase.
      let phaseHours: number;
      if (phase === "trial") {
        phaseHours = ageHours;
      } else if (phase === "winback") {
        phaseHours = trialEndsAt ? (now - trialEndsAt) / 3_600_000 : 0;
      } else {
        phaseHours = convertedAt ? (now - convertedAt) / 3_600_000 : 0;
      }

      const stage = STAGES.find(
        (s) => s.phase === phase && phaseHours >= s.minHours && phaseHours <= s.maxHours,
      );
      if (!stage) continue;
      if (stagesSent.includes(stage.key)) continue;

      // Consult drip_preferences - users can mute streams, specific stages,
      // or hit the universal pause kill-switch.
      const { data: prefs } = await supabase
        .from("drip_preferences")
        .select("paused, stream_education, stream_reveals, stream_content_drops, stream_daily_briefs, stream_checkins, stream_winback, muted_stages, voice_guidance, weekly_cap, stage_feedback")
        .eq("organization_id", org.id)
        .maybeSingle();

      if (prefs?.paused) continue;
      if (prefs?.muted_stages && (prefs.muted_stages as string[]).includes(stage.key)) continue;

      const streamColMap: Record<Stream, keyof typeof prefs | "alerts"> = {
        reveals: "stream_reveals",
        education: "stream_education",
        content_drops: "stream_content_drops",
        daily_briefs: "stream_daily_briefs",
        checkins: "stream_checkins",
        winback: "stream_winback",
        alerts: "alerts", // not used here (alerts-tick handles)
      };
      if (prefs) {
        const col = streamColMap[stage.stream] as keyof typeof prefs;
        if (col && col !== "alerts" && prefs[col] === false) continue;
      }

      // Weekly cap: count emails sent in the last 7 days. Skip if at cap.
      const weeklyCap = (prefs?.weekly_cap as number) || 0;
      if (weeklyCap > 0) {
        const since = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
        // We approximate by counting stages_sent entries with their last_sent_at
        // - for now, use the simple count of stages_sent timestamps in state.
        const lastSent = state?.last_sent_at ? new Date(state.last_sent_at as string).getTime() : 0;
        if (lastSent && (now - lastSent) < (7 * 24 * 3600 * 1000 / weeklyCap)) continue;
      }

      // Resolve member.
      const { data: member } = await supabase
        .from("users")
        .select("id, email, full_name")
        .eq("organization_id", org.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!member?.email) continue;

      // Don't drip unconfirmed accounts - an unconfirmed signup means nobody
      // has proven they own that inbox yet (bot/harvested-email signups sit
      // here forever), so sending marketing email would go to a stranger.
      const { data: authUser } = await supabase.auth.admin.getUserById(member.id as string);
      if (!authUser?.user?.email_confirmed_at) continue;

      const firstName = ((member.full_name as string) || "").split(" ")[0] || "";
      const assets = await loadAssets(supabase, org.id as string);

      const hoursSinceTrialEnd = trialEndsAt ? (now - trialEndsAt) / 3_600_000 : -1;
      const hoursSinceConversion = convertedAt ? (now - convertedAt) / 3_600_000 : -1;

      const stageFeedbackMap = (prefs?.stage_feedback as Record<string, string> | null) || {};
      const ctx: DripCtx = {
        org: org as OrgRow,
        member: member as MemberRow,
        firstName,
        ageHours,
        hoursSinceTrialEnd,
        hoursSinceConversion,
        phase,
        ...assets,
        voiceGuidance: (prefs?.voice_guidance as string | null) ?? null,
        stageFeedback: stageFeedbackMap[stage.key] ?? null,
      };

      // Action-based skip (e.g., don't push "import leads" if already done).
      if (stage.skipIf?.(ctx)) {
        // Still record we evaluated this stage so we don't re-skip forever.
        await supabase.from("onboarding_drip_state").upsert({
          organization_id: org.id,
          stages_sent: [...stagesSent, stage.key],
          last_stage: stage.key,
          last_sent_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        continue;
      }

      const rawHtml = await Promise.resolve(stage.html(ctx));
      let renderedHtml = rawHtml.replaceAll("{{STAGE_KEY}}", encodeURIComponent(stage.key));

      // Personalized Notion "setup plan" doc: created on first trial touch,
      // updated (checklist + a running Updates log) on every stage after.
      // Best-effort - a Notion hiccup must never block the email itself.
      if (stage.phase === "trial") {
        try {
          const doc = await ensureOnboardingDoc(supabase, ctx.org.id, ctx.org.name || "Your workspace", ctx);
          if (doc) {
            await syncOnboardingDoc(supabase, doc, ctx, buildNotionUpdate(stage.key, ctx) || []);
            const planLink = `<div style="margin:20px 0; padding:14px 18px; background:#F5F3EE; border-radius:10px; text-align:center;"><a href="${doc.notion_url}" style="color:#D4361A; font-weight:600; text-decoration:none; font-size:13px;">📋 Open your full setup plan →</a></div>`;
            const footerAnchor = '<div style="max-width:540px; margin:14px auto 0; text-align:center; font-size:11px; color:#888;">';
            if (renderedHtml.includes(footerAnchor)) {
              renderedHtml = renderedHtml.replace(footerAnchor, `${planLink}${footerAnchor}`);
            }
          }
        } catch (e) {
          console.warn("[onboarding-drip-tick] notion doc sync failed:", e);
        }
      }

      const ok = await sendEmail(member.email as string, stage.subject(ctx), renderedHtml);
      if (!ok) continue;

      await supabase.from("onboarding_drip_state").upsert({
        organization_id: org.id,
        stages_sent: [...stagesSent, stage.key],
        last_stage: stage.key,
        last_sent_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      sent += 1;
    }

    return new Response(JSON.stringify({ ok: true, sent, scanned }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[onboarding-drip-tick] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
