import { PUBLIC_SITE_DISPLAY, PUBLIC_SITE_URL, fromAddress } from "./site-config.ts";
// ============================================================================
// signals-email.ts
// ----------------------------------------------------------------------------
// Shared helpers for the free daily buying-signals digest:
//   - fetchTodaySignals()  : pull the public feed, scope to the freshest day
//   - renderDigestEmail()  : the daily digest HTML
//   - renderWelcomeEmail() : the immediate "you're in" confirmation HTML
//   - sendResendBatch()    : batched Resend send with per-recipient unsubscribe
//
// Used by submit-playbook-lead (welcome) and signals-daily-digest (digest).
// ============================================================================

const FEED_URL =
  Deno.env.get("SIGNALS_FEED_URL") ||
  `${PUBLIC_SITE_URL}/signals/signals.json`;

const SITE_URL = PUBLIC_SITE_URL;
const SKOOL_URL = "https://www.skool.com/aca-xtreme/about";

// Brand palette (inlined — email clients don't read our CSS vars).
const INK = "#15140F";
const ACCENT = "#D4361A";
const MUTED = "#6B6759";
const BONE = "#F2EEE6";
const PAPER = "#EBE6DA";
const RULE = "#C9C2AE";

export interface DigestSignal {
  id: string;
  type_label: string;
  company: string;
  summary: string;
  amount?: string;
  source?: string;
  source_url?: string;
  why_it_matters?: string;
  verified?: boolean;
  quality_score?: number;
  collected_at?: string;
  date?: string;
}

export interface TodaySignals {
  day: string; // YYYY-MM-DD of the freshest batch
  total: number; // total companies in that batch
  top: DigestSignal[]; // best N, ranked
}

function escapeHtml(s: string): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function dayOf(s: DigestSignal): string {
  return (s.collected_at || s.date || "").slice(0, 10);
}

function formatDay(day: string): string {
  const parsed = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return day;
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(parsed);
}

// Pull the live public feed and reduce it to the freshest day's top signals,
// ranked verified-first then by quality. Returns null if the feed is empty or
// unreachable so callers can skip the send.
export async function fetchTodaySignals(limit = 12): Promise<TodaySignals | null> {
  let signals: DigestSignal[] = [];
  try {
    const res = await fetch(FEED_URL, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) throw new Error(`feed ${res.status}`);
    const data = await res.json();
    signals = Array.isArray(data) ? data : (data?.signals ?? []);
  } catch (e) {
    console.error("[signals-email] feed fetch failed:", e);
    return null;
  }
  if (!signals.length) return null;

  const days = signals.map(dayOf).filter(Boolean).sort();
  const latest = days[days.length - 1];
  const batch = latest ? signals.filter((s) => dayOf(s) === latest) : signals;

  const seen = new Set<string>();
  const top = batch
    .filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    })
    .sort((a, b) => {
      if (!!b.verified !== !!a.verified) return b.verified ? 1 : -1;
      return (b.quality_score || 0) - (a.quality_score || 0);
    })
    .slice(0, limit);

  return { day: latest || "", total: batch.length, top };
}

function signalRow(s: DigestSignal): string {
  const meta = [s.amount, s.verified ? "Verified" : ""].filter(Boolean).join(" · ");
  const why = s.why_it_matters || s.summary || "";
  const src = s.source_url
    ? `<a href="${escapeHtml(s.source_url)}" style="color:${ACCENT};text-decoration:none;">${escapeHtml(s.source || "source")} ↗</a>`
    : escapeHtml(s.source || "");
  return `
  <tr>
    <td style="padding:16px 0;border-bottom:1px solid ${RULE};">
      <div style="font:600 11px/1.2 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${ACCENT};margin-bottom:6px;">
        ${escapeHtml(s.type_label || "Signal")}${meta ? ` <span style="color:${MUTED};">· ${escapeHtml(meta)}</span>` : ""}
      </div>
      <div style="font:600 17px/1.3 Georgia,'Times New Roman',serif;color:${INK};margin-bottom:4px;">${escapeHtml(s.company)}</div>
      <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-bottom:6px;">${escapeHtml(why)}</div>
      <div style="font:400 12px/1.4 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">${src}</div>
    </td>
  </tr>`;
}

interface ShellOpts {
  /** Small-caps eyebrow in the email header. */
  kicker?: string;
  /** Footer "you're getting this because…" sentence (HTML allowed). */
  footerReason?: string;
}

function shell(inner: string, unsubUrl: string, opts: ShellOpts = {}): string {
  const kicker = opts.kicker
    ? opts.kicker
    : `ACA <span style="color:${ACCENT};">·</span> Buying Signals`;
  const footerReason = opts.footerReason
    ? opts.footerReason
    : `You're getting this because you signed up for free daily buying signals at
       <a href="${SITE_URL}/signals" style="color:${ACCENT};text-decoration:none;">${PUBLIC_SITE_DISPLAY}/signals</a>.`;
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BONE};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BONE};padding:28px 0;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid ${RULE};border-radius:14px;overflow:hidden;">
        <tr><td style="padding:28px 32px;">
          <div style="font:600 13px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.12em;text-transform:uppercase;color:${INK};">
            ${kicker}
          </div>
        </td></tr>
        ${inner}
        <tr><td style="padding:24px 32px 28px;background:${PAPER};border-top:1px solid ${RULE};">
          <div style="font:400 12px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
            ${footerReason}<br/>
            <a href="${escapeHtml(unsubUrl)}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a>
          </div>
        </td></tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
}

// Immediate delivery email for the free "Hermes LinkedIn Appointment Setter"
// lead magnet: a single, unmissable CTA to the guide, plus a 4-step "what
// you're getting" recap so the email itself reinforces the offer.
export function renderHermesDeliveryEmail(
  deliverableUrl: string,
  unsubUrl: string,
): { subject: string; html: string } {
  const subject = "Your Hermes LinkedIn Appointment Setter build is inside";
  const steps = [
    ["1", "Find what's working", "Hermes finds your competitors' best-performing posts automatically."],
    ["2", "Pull the audience", "It scrapes every commenter — warm, in-market people already raising their hand."],
    ["3", "Filter to your ICP", "Only the people who match your offer make it through. No spray-and-pray."],
    ["4", "You approve, it books", "Every message waits for your one-tap approval in Telegram — then it books the call."],
  ]
    .map(
      ([n, h, b]) => `
      <tr><td style="padding:10px 0;border-top:1px solid ${RULE};">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="width:30px;font:600 15px/1.4 'JetBrains Mono',ui-monospace,monospace;color:${ACCENT};">${n}</td>
          <td valign="top">
            <div style="font:600 15px/1.4 Georgia,'Times New Roman',serif;color:${INK};">${h}</div>
            <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:2px;">${b}</div>
          </td>
        </tr></table>
      </td></tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:8px 32px 4px;">
      <div style="font:600 27px/1.15 Georgia,'Times New Roman',serif;color:${INK};">It's all yours.</div>
      <div style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:8px;">
        Below is everything you need to build the exact LinkedIn appointment setter that books calls on autopilot —
        the full agent prompt and the step-by-step setup. Same system that runs <b>40%+ connection acceptance</b>,
        <b>30%+ reply rates</b>, and books meetings while you sleep.
      </div>
    </td></tr>
    <tr><td style="padding:22px 32px 6px;" align="center">
      <a href="${escapeHtml(deliverableUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:8px;text-decoration:none;">Get the prompt + setup guide →</a>
    </td></tr>
    <tr><td style="padding:18px 32px 4px;">
      <div style="font:600 12px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">What it does for you</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
    </td></tr>
    <tr><td style="padding:18px 32px 22px;">
      <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
        Want us to build it <i>with</i> you and scope it to your exact offer?
        <a href="${SKOOL_URL}" style="color:${ACCENT};text-decoration:none;">Come into the community →</a>
      </div>
    </td></tr>`;
  return {
    subject,
    html: shell(inner, unsubUrl, {
      kicker: `ACA <span style="color:${ACCENT};">·</span> Hermes Build`,
      footerReason: `You're getting this because you requested the free Hermes LinkedIn Appointment Setter build at
        <a href="${SITE_URL}" style="color:${ACCENT};text-decoration:none;">${PUBLIC_SITE_DISPLAY}</a>.`,
    }),
  };
}

// Immediate delivery email for the free "Hermes Google Maps Lead Scraper"
// lead magnet: one unmissable CTA to the list + system, plus a 4-step recap so
// the email itself reinforces the offer.
export function renderMapsDeliveryEmail(
  deliverableUrl: string,
  unsubUrl: string,
): { subject: string; html: string } {
  const subject = "Your 12M business list + Google Maps scraper is inside";
  const steps = [
    ["1", "Scrape the niche", "Point Hermes at any local niche + city — it pulls every matching business off Google Maps."],
    ["2", "Discover the angle", "It studies each business and surfaces a real, specific reason they'd want to hear from you."],
    ["3", "Find & verify the email", "Pulls the decision-maker's email and verifies it — clean list, protected domain."],
    ["4", "Fill your pipeline", "Verified contacts plus the angle flow into a ready-to-send pipeline. Rinse and repeat, unlimited."],
  ]
    .map(
      ([n, h, b]) => `
      <tr><td style="padding:10px 0;border-top:1px solid ${RULE};">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="width:30px;font:600 15px/1.4 'JetBrains Mono',ui-monospace,monospace;color:${ACCENT};">${n}</td>
          <td valign="top">
            <div style="font:600 15px/1.4 Georgia,'Times New Roman',serif;color:${INK};">${h}</div>
            <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:2px;">${b}</div>
          </td>
        </tr></table>
      </td></tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:8px 32px 4px;">
      <div style="font:600 27px/1.15 Georgia,'Times New Roman',serif;color:${INK};">It's all yours.</div>
      <div style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:8px;">
        Below is everything you need to turn Google Maps into an unlimited local lead pipeline —
        the <b>list of 12 million businesses</b> and the full <b>Hermes scraper system</b> that discovers companies,
        finds the decision-maker's email, verifies it, and fills your pipeline on autopilot.
      </div>
    </td></tr>
    <tr><td style="padding:22px 32px 6px;" align="center">
      <a href="${escapeHtml(deliverableUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:8px;text-decoration:none;">Get the list + scraper system →</a>
    </td></tr>
    <tr><td style="padding:18px 32px 4px;">
      <div style="font:600 12px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">How it works</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
    </td></tr>
    <tr><td style="padding:18px 32px 22px;">
      <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
        Want us to build it <i>with</i> you and scope it to your exact local niche?
        <a href="${SKOOL_URL}" style="color:${ACCENT};text-decoration:none;">Come into the community →</a>
      </div>
    </td></tr>`;
  return {
    subject,
    html: shell(inner, unsubUrl, {
      kicker: `ACA <span style="color:${ACCENT};">·</span> Maps Scraper`,
      footerReason: `You're getting this because you requested the free Google Maps lead scraper at
        <a href="${SITE_URL}" style="color:${ACCENT};text-decoration:none;">${PUBLIC_SITE_DISPLAY}</a>.`,
    }),
  };
}

export interface AgentDeliveryConfig {
  /** Agent name shown in the header kicker, e.g. "SEO Growth Agent". */
  agentLabel: string;
  /** Email subject line. */
  subject: string;
  /** Serif headline shown at the top of the email body. */
  headline: string;
  /** Paragraph under the headline — what they're getting and why it matters. */
  intro: string;
  /** CTA button label, e.g. "Get the agent build →". */
  ctaLabel: string;
  /** "How it works" recap steps: [number, heading, body]. */
  steps: Array<[string, string, string]>;
}

// Generic immediate-delivery email for the "free agent build" lead magnets
// (one per agent in the /agents curriculum). Same shell/CTA/recap pattern as
// renderHermesDeliveryEmail / renderMapsDeliveryEmail, parameterized so each
// new agent page doesn't need its own near-identical render function.
export function renderAgentDeliveryEmail(
  cfg: AgentDeliveryConfig,
  deliverableUrl: string,
  unsubUrl: string,
): { subject: string; html: string } {
  const steps = cfg.steps
    .map(
      ([n, h, b]) => `
      <tr><td style="padding:10px 0;border-top:1px solid ${RULE};">
        <table role="presentation" cellpadding="0" cellspacing="0"><tr>
          <td valign="top" style="width:30px;font:600 15px/1.4 'JetBrains Mono',ui-monospace,monospace;color:${ACCENT};">${n}</td>
          <td valign="top">
            <div style="font:600 15px/1.4 Georgia,'Times New Roman',serif;color:${INK};">${h}</div>
            <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:2px;">${b}</div>
          </td>
        </tr></table>
      </td></tr>`,
    )
    .join("");
  const inner = `
    <tr><td style="padding:8px 32px 4px;">
      <div style="font:600 27px/1.15 Georgia,'Times New Roman',serif;color:${INK};">${escapeHtml(cfg.headline)}</div>
      <div style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:8px;">
        ${cfg.intro}
      </div>
    </td></tr>
    <tr><td style="padding:22px 32px 6px;" align="center">
      <a href="${escapeHtml(deliverableUrl)}" style="display:inline-block;background:${ACCENT};color:#fff;font:600 16px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:16px 30px;border-radius:8px;text-decoration:none;">${escapeHtml(cfg.ctaLabel)}</a>
    </td></tr>
    <tr><td style="padding:18px 32px 4px;">
      <div style="font:600 12px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">How it works</div>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${steps}</table>
    </td></tr>
    <tr><td style="padding:18px 32px 22px;">
      <div style="font:400 14px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
        Want us to build it <i>with</i> you and scope it to your exact offer?
        <a href="${SKOOL_URL}" style="color:${ACCENT};text-decoration:none;">Come into the community →</a>
      </div>
    </td></tr>`;
  return {
    subject: cfg.subject,
    html: shell(inner, unsubUrl, {
      kicker: `ACA <span style="color:${ACCENT};">·</span> ${escapeHtml(cfg.agentLabel)}`,
      footerReason: `You're getting this because you requested the free ${escapeHtml(cfg.agentLabel)} build at
        <a href="${SITE_URL}" style="color:${ACCENT};text-decoration:none;">${PUBLIC_SITE_DISPLAY}</a>.`,
    }),
  };
}

export function renderDigestEmail(today: TodaySignals, unsubUrl: string): { subject: string; html: string } {
  const subject = `${today.total} ${today.total === 1 ? "company" : "companies"} with a reason to buy — ${formatDay(today.day)}`;
  const rows = today.top.map(signalRow).join("");
  const inner = `
    <tr><td style="padding:8px 32px 4px;">
      <div style="font:600 26px/1.2 Georgia,'Times New Roman',serif;color:${INK};">Today's buying signals</div>
      <div style="font:400 14px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:6px;">
        ${formatDay(today.day)} · ${today.total} companies tracked · showing the top ${today.top.length}.
      </div>
    </td></tr>
    <tr><td style="padding:8px 32px 0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
    </td></tr>
    <tr><td style="padding:24px 32px 8px;" align="center">
      <a href="${SITE_URL}/signals" style="display:inline-block;background:${ACCENT};color:#fff;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px 26px;border-radius:8px;text-decoration:none;">See all ${today.total} signals →</a>
    </td></tr>
    <tr><td style="padding:6px 32px 20px;" align="center">
      <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
        Want a signal scoped to your exact offer? <a href="${SKOOL_URL}" style="color:${ACCENT};text-decoration:none;">Build one with Hermes →</a>
      </div>
    </td></tr>`;
  return { subject, html: shell(inner, unsubUrl) };
}

export function renderWelcomeEmail(today: TodaySignals | null, unsubUrl: string): { subject: string; html: string } {
  const subject = "You're in — your first buying signals land tomorrow";
  const preview = today?.top.slice(0, 3).map(signalRow).join("") || "";
  const previewBlock = preview
    ? `<tr><td style="padding:8px 32px 0;">
         <div style="font:600 12px/1 'JetBrains Mono',ui-monospace,monospace;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">A taste of today</div>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${preview}</table>
       </td></tr>`
    : "";
  const inner = `
    <tr><td style="padding:8px 32px 4px;">
      <div style="font:600 26px/1.2 Georgia,'Times New Roman',serif;color:${INK};">You're in.</div>
      <div style="font:400 15px/1.6 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};margin-top:8px;">
        Every morning we'll send you the day's funding, hiring, and leadership moves — the companies with a real reason to buy, before your first coffee.
      </div>
    </td></tr>
    ${previewBlock}
    <tr><td style="padding:24px 32px 8px;" align="center">
      <a href="${SITE_URL}/signals" style="display:inline-block;background:${ACCENT};color:#fff;font:600 15px/1 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:14px 26px;border-radius:8px;text-decoration:none;">Browse the live feed →</a>
    </td></tr>
    <tr><td style="padding:6px 32px 20px;" align="center">
      <div style="font:400 13px/1.5 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:${MUTED};">
        Want signals scoped to your exact offer? <a href="${SKOOL_URL}" style="color:${ACCENT};text-decoration:none;">Learn to build your own with Hermes →</a>
      </div>
    </td></tr>`;
  return { subject, html: shell(inner, unsubUrl) };
}

export function unsubscribeUrl(token: string): string {
  const base = Deno.env.get("SUPABASE_URL") || "";
  return `${base}/functions/v1/signals-unsubscribe?token=${encodeURIComponent(token)}`;
}

interface BatchItem {
  to: string;
  subject: string;
  html: string;
  unsubUrl: string;
}

// Send each message individually via Resend's /emails endpoint (the batch
// endpoint doesn't accept per-message email headers, which we need for the
// per-recipient one-click List-Unsubscribe). Bounded concurrency keeps a large
// list from opening hundreds of sockets at once. Returns count sent.
export interface SendResult {
  sent: number;
  errors: string[];
}

export async function sendResendBatch(items: BatchItem[], concurrency = 8): Promise<SendResult> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[signals-email] RESEND_API_KEY missing — skipping send");
    return { sent: 0, errors: ["missing_api_key"] };
  }
  // The apex automatedclientacquisition.com is NOT verified in Resend and returns
  // 403 for every send. Only the `notifications.` subdomain is verified, so any
  // fallback must use it — an unverified fallback fails silently, because Resend
  // rejects with a status code rather than throwing.
  const from = Deno.env.get("SIGNALS_FROM") ||
    fromAddress("noreply", "ACA Buying Signals");

  let sent = 0;
  let cursor = 0;
  const errors: string[] = [];
  async function worker() {
    while (cursor < items.length) {
      const it = items[cursor++];
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            from,
            to: [it.to],
            subject: it.subject,
            html: it.html,
            headers: {
              "List-Unsubscribe": `<${it.unsubUrl}>`,
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            },
          }),
        });
        if (!res.ok) {
          const msg = `${res.status}: ${(await res.text()).slice(0, 200)}`;
          console.error(`[signals-email] send to ${it.to} failed ${msg}`);
          if (errors.length < 3) errors.push(msg);
          continue;
        }
        sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[signals-email] send to ${it.to} error:`, msg);
        if (errors.length < 3) errors.push(msg);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length || 1) }, worker));
  return { sent, errors };
}
