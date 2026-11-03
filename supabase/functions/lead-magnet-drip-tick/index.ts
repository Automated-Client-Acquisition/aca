// ============================================================================
// lead-magnet-drip-tick
// ----------------------------------------------------------------------------
// Cron-driven (daily). Walks signals_subscribers who opted into a free agent
// build and sends the next "agent library tour" showcase - one per day. A lead
// is skipped past the agent they signed up for (they already got it), tours the
// rest one/day, then a final "whole library + offer" email closes it out.
//
// Idempotent via public.lead_magnet_drip_state.stages_sent + last_sent_at
// (one send per lead per ~day). Honors the existing unsubscribe (status flips
// to unsubscribed → the lead drops out of the query). Sends via Resend from a
// verified sending subdomain.
//
// Auth: deployed --no-verify-jwt; the pg_cron job sends x-cron-secret from
// Vault (cron_secret), compared to the CRON_SECRET function env (the project's
// established cron→edge scheme). Manual test: pass { only_email, dry } in the
// body with the same x-cron-secret header.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { renderFinal, renderShowcase, SHOWCASES } from "../_shared/lead-magnet-drip.ts";
import { unsubscribeUrl } from "../_shared/signals-email.ts";
import { fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const FROM =
  Deno.env.get("LEAD_MAGNET_FROM") || fromAddress("cedric", "Cedric @ ACA");
const REPLY_TO = Deno.env.get("LEAD_MAGNET_REPLY_TO") || "";
const THROTTLE_MS = 20 * 60 * 60 * 1000; // ~1/day, tolerant of cron jitter
const AGENT_SOURCES = SHOWCASES.map((s) => s.key);

async function sendEmail(to: string, subject: string, html: string, unsubUrl: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[lead-magnet-drip] RESEND_API_KEY missing, skipping send to", to);
    return false;
  }
  const payload: Record<string, unknown> = {
    from: FROM,
    to: [to],
    subject,
    html,
    headers: {
      "List-Unsubscribe": `<${unsubUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
  if (REPLY_TO) payload.reply_to = REPLY_TO;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error(`[lead-magnet-drip] resend failed ${res.status}: ${(await res.text()).slice(0, 200)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error("[lead-magnet-drip] send error:", e instanceof Error ? e.message : String(e));
    return false;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { only_email?: string; dry?: boolean; limit?: number } = {};
  try {
    body = await req.json();
  } catch { /* empty body = full run */ }
  const dry = body.dry === true;
  const limit = Math.min(Number(body.limit) || 300, 1000);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let query = supabase
    .from("signals_subscribers")
    .select("email, source, unsubscribe_token")
    .eq("status", "active")
    .in("source", AGENT_SOURCES)
    .limit(limit);
  if (body.only_email) query = query.eq("email", body.only_email);

  const { data: subs, error } = await query;
  if (error) {
    console.error("[lead-magnet-drip] subscriber query failed:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!subs?.length) {
    return new Response(JSON.stringify({ processed: 0, sent: 0 }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: states } = await supabase
    .from("lead_magnet_drip_state")
    .select("email, stages_sent, last_sent_at, completed_at, started_at")
    .in("email", subs.map((s) => s.email));
  const stateByEmail = new Map((states ?? []).map((s) => [s.email as string, s]));

  const now = Date.now();
  const nowIso = new Date().toISOString();
  let sent = 0;
  let completed = 0;
  let skipped = 0;
  const results: Array<Record<string, unknown>> = [];

  for (const sub of subs) {
    const st = stateByEmail.get(sub.email);
    if (st?.completed_at) { skipped++; continue; }
    if (st?.last_sent_at && now - new Date(st.last_sent_at as string).getTime() < THROTTLE_MS) {
      skipped++;
      continue;
    }
    const stagesSent: string[] = (st?.stages_sent as string[]) ?? [];
    const unsubUrl = unsubscribeUrl(sub.unsubscribe_token as string);

    // Next showcase: skip the agent they signed up for + anything already sent.
    const remaining = SHOWCASES.filter((s) => s.key !== sub.source && !stagesSent.includes(s.key));

    if (remaining.length === 0) {
      const { subject, html } = renderFinal({ unsubUrl });
      const ok = dry ? true : await sendEmail(sub.email, subject, html, unsubUrl);
      if (ok && !dry) {
        await supabase.from("lead_magnet_drip_state").upsert({
          email: sub.email,
          source: sub.source,
          stages_sent: [...stagesSent, "final"],
          last_sent_at: nowIso,
          completed_at: nowIso,
          started_at: (st?.started_at as string) || nowIso,
        }, { onConflict: "email" });
      }
      if (ok) { completed++; results.push({ email: sub.email, sent: "final" }); }
      continue;
    }

    const next = remaining[0];
    const nextNext = remaining[1];
    const otherTeasers = SHOWCASES
      .filter((s) => s.key !== sub.source && s.key !== next.key)
      .slice(0, 3)
      .map((s) => s.teaser);
    const { subject, html } = renderShowcase(next, { unsubUrl, nextTeaser: nextNext?.teaser, otherTeasers });
    const ok = dry ? true : await sendEmail(sub.email, subject, html, unsubUrl);
    if (ok && !dry) {
      await supabase.from("lead_magnet_drip_state").upsert({
        email: sub.email,
        source: sub.source,
        stages_sent: [...stagesSent, next.key],
        last_sent_at: nowIso,
        started_at: (st?.started_at as string) || nowIso,
      }, { onConflict: "email" });
    }
    if (ok) { sent++; results.push({ email: sub.email, sent: next.key, subject }); }
  }

  return new Response(
    JSON.stringify({ processed: subs.length, sent, completed, skipped, dry, results: results.slice(0, 20) }, null, 2),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
