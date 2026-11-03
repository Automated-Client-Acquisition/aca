// ============================================================================
// submit-site-lead
// ----------------------------------------------------------------------------
// Public endpoint (no auth). Receives contact-form submissions from the
// cold-email domain landing pages (see outbound-sites/) and writes them into
// crm_contacts for the owning organization.
//
// The caller is the Next.js route handler at outbound-sites/app/api/contact,
// which holds the shared secret. Keeping the secret server-side there means the
// browser never sees a Supabase key.
//
// Reuses _shared/bulk-contacts.ts so a form submission produces exactly the same
// contact shape as the CLI, the REST API and the MCP server.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";
import { insertContactsBulk } from "../_shared/bulk-contacts.ts";
import { isDisposableEmail } from "../_shared/disposable-domains.ts";
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

/** Organization the landing-page leads belong to. Override per deployment. */
const TARGET_ORG_ID = Deno.env.get("SITE_LEAD_ORG_ID") ?? HOUSE_ORG_ID;

/** Shared secret with the Next.js route handler. Required — no anonymous writes. */
const SHARED_SECRET = Deno.env.get("SITE_LEAD_SHARED_SECRET") ?? "";

/** Optional founder notification. Skipped silently when unset. */
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const NOTIFY_TO = Deno.env.get("SITE_LEAD_NOTIFY_TO") ?? "";
const NOTIFY_FROM = Deno.env.get("SITE_LEAD_NOTIFY_FROM") ?? "";

interface Payload {
  name?: string;
  email?: string;
  phone?: string;
  company?: string;
  website?: string;
  message?: string;
  /** Answers carried over from the on-page quote calculator, if it was used. */
  quote?: {
    meetings?: number | string;
    budget?: number | string;
    ltv?: number | string;
    closeRate?: number | string;
  };
  /** Sending domain the form was served from — becomes a tag and the source. */
  brandDomain?: string;
  brandName?: string;
}

/** Digits, spaces and the usual separators. Deliberately permissive — international. */
const PHONE_RE = /^[+()\-.\s\d]{7,25}$/;

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/**
 * Returns a short status string rather than void, and the caller puts it in the
 * response. The caller is our own server holding the shared secret, so this
 * leaks nothing — and it means "did the notification actually send" is
 * answerable without digging through the log stream.
 */
async function notify(p: Payload): Promise<string> {
  if (!RESEND_API_KEY || !NOTIFY_TO || !NOTIFY_FROM) {
    console.warn("submit-site-lead: notification skipped — RESEND_API_KEY / NOTIFY_TO / NOTIFY_FROM not all set");
    return "skipped:not_configured";
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: NOTIFY_FROM,
        to: [NOTIFY_TO],
        reply_to: p.email,
        subject: `New enquiry on ${p.brandDomain ?? "a landing page"} — ${p.name ?? p.email}`,
        text: [
          `Domain:  ${p.brandDomain ?? "-"} (${p.brandName ?? "-"})`,
          `Name:    ${p.name ?? "-"}`,
          `Email:   ${p.email ?? "-"}`,
          `Phone:   ${p.phone ?? "-"}`,
          `Company: ${p.company ?? "-"}`,
          `Website: ${p.website ?? "-"}`,
          "",
          p.quote
            ? [
                "From the quote calculator:",
                `  Meetings wanted (6 months): ${p.quote.meetings ?? "-"}`,
                `  Monthly budget:             ${p.quote.budget ?? "-"}`,
                `  A customer is worth:        ${p.quote.ltv ?? "-"}`,
                `  Close rate:                 ${p.quote.closeRate ?? "-"}%`,
                "",
              ].join("\n")
            : "",
          p.message ?? "(no message)",
        ].join("\n"),
      }),
    });

    // Resend rejects an unverified from-domain with a 4xx, not by throwing, so
    // the status has to be checked explicitly or a silent non-delivery looks
    // exactly like a success.
    if (!res.ok) {
      const detail = await res.text();
      console.error(`submit-site-lead: Resend rejected the notification (${res.status}): ${detail}`);
      return `failed:${res.status}:${detail.slice(0, 200)}`;
    }
    const body = await res.json().catch(() => ({}));
    console.log(`submit-site-lead: notification sent, resend id ${body?.id ?? "unknown"}`);
    return `sent:${body?.id ?? "unknown"}`;
  } catch (err) {
    // A failed notification must never fail the submission — the contact is saved.
    console.error("submit-site-lead: notification request failed", err);
    return `failed:network:${String(err).slice(0, 120)}`;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!SHARED_SECRET) {
    console.error("submit-site-lead: SITE_LEAD_SHARED_SECRET is not configured");
    return json({ error: "Endpoint not configured" }, 503);
  }
  if (req.headers.get("x-site-secret") !== SHARED_SECRET) {
    return json({ error: "Unauthorized" }, 401);
  }

  let p: Payload;
  try {
    p = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const email = (p.email ?? "").trim().toLowerCase();
  const name = (p.name ?? "").trim();
  const phone = (p.phone ?? "").trim();
  const website = (p.website ?? "").trim();

  if (!name) return json({ error: "Name is required" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "A valid email address is required" }, 400);
  if (isDisposableEmail(email)) return json({ error: "Please use your work email address" }, 400);
  if (!PHONE_RE.test(phone)) return json({ error: "A valid phone number is required" }, 400);
  if (!website) return json({ error: "Your website is required" }, 400);

  const domain = (p.brandDomain ?? "").trim().toLowerCase();
  const q = p.quote ?? {};
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const result = await insertContactsBulk(
      supabase,
      TARGET_ORG_ID,
      [
        {
          display_name: name,
          primary_email: email,
          primary_phone: phone,
          company: (p.company ?? "").trim() || undefined,
          company_website: website,
          source: domain ? `site:${domain}` : "site",
          tags: [
            "inbound",
            "website-lead",
            ...(domain ? [domain] : []),
            ...(p.quote ? ["used-calculator"] : []),
          ],
          custom_fields: {
            enquiry_message: (p.message ?? "").slice(0, 4000),
            enquiry_domain: domain,
            enquiry_brand: p.brandName ?? null,
            submitted_at: new Date().toISOString(),
            // Stored as numbers rather than buried in the message text, so these
            // are filterable and can drive the quote without re-reading prose.
            quote_meetings_target: num(q.meetings),
            quote_monthly_budget: num(q.budget),
            quote_customer_value: num(q.ltv),
            quote_close_rate_pct: num(q.closeRate),
          },
        },
      ],
      { defaultSource: "site", dedupeOnEmail: true },
    );

    // Deduped contacts still deserve a notification — a repeat enquiry from a
    // known address is a stronger signal than a new one, not a weaker one.
    const notified = await notify(p);

    return json({ ok: true, created: result.created, deduped: result.skipped > 0, notified });
  } catch (err) {
    console.error("submit-site-lead: insert failed", err);
    return json({ error: "Could not save your enquiry. Please email us directly." }, 500);
  }
});
