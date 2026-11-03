// ============================================================================
// signals-daily-digest
// ----------------------------------------------------------------------------
// Cron target (daily). Pulls the freshest day of public buying signals and
// emails the digest to every active signals_subscribers row, each with its own
// one-click unsubscribe link. No-ops cleanly if the feed is empty.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { fetchTodaySignals, renderDigestEmail, sendResendBatch, unsubscribeUrl } from "../_shared/signals-email.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  try {
    const today = await fetchTodaySignals(12);
    if (!today || !today.top.length) {
      console.log("[signals-daily-digest] no signals to send today");
      return json({ sent: 0, reason: "no_signals" });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: subs, error } = await supabase
      .from("signals_subscribers")
      .select("id, email, unsubscribe_token")
      .eq("status", "active");

    if (error) {
      console.error("[signals-daily-digest] subscriber fetch failed:", error);
      return json({ error: "subscriber_fetch_failed" }, 500);
    }
    if (!subs?.length) {
      console.log("[signals-daily-digest] no active subscribers");
      return json({ sent: 0, reason: "no_subscribers" });
    }

    const { subject } = renderDigestEmail(today, "");
    const items = subs.map((s) => {
      const unsubUrl = unsubscribeUrl(s.unsubscribe_token);
      const { html } = renderDigestEmail(today, unsubUrl);
      return { to: s.email, subject, html, unsubUrl };
    });

    const { sent, errors } = await sendResendBatch(items);

    // Best-effort send bookkeeping.
    await supabase
      .from("signals_subscribers")
      .update({ last_sent_at: new Date().toISOString() })
      .in("id", subs.map((s) => s.id));

    console.log(`[signals-daily-digest] day=${today.day} subscribers=${subs.length} sent=${sent}`);
    return json({ sent, subscribers: subs.length, day: today.day, signals: today.top.length, errors });
  } catch (e) {
    console.error("[signals-daily-digest] error:", e);
    return json({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
