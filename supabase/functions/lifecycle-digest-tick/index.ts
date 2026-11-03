// ============================================================================
// lifecycle-digest-tick
// ----------------------------------------------------------------------------
// The two retention emails that had no owner:
//
//   1. WEEKLY DIGEST  - what your pipeline actually did in the last 7 days
//                       (sent, replies, conversations opened), plus the one
//                       thing to do next. Goes to orgs that are actually
//                       running, once a week.
//   2. DORMANCY NUDGE - an org that HAS sent before and then went 7 days
//                       silent. Sent at most once a fortnight so it stays a
//                       nudge rather than nagging.
//
// Both respect drip_preferences (paused / stream_digest). Cadence anchors live
// in lifecycle_digest_state so a redeploy or a double-fire can't double-send.
//
// Designed to be run hourly - it picks its own moment per org based on the
// stored anchors, rather than relying on the cron firing at an exact time.
// ============================================================================

import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";
import { APP_URL, PUBLIC_SITE_DISPLAY, fromAddress } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Default must be the host the app actually serves from. app.* is not
// wired up (404s), so an unset APP_URL used to make every link dead.
const FROM = Deno.env.get("ONBOARDING_DRIP_FROM") ||
  fromAddress("cedric");

const WEEK_MS = 7 * 24 * 3600 * 1000;
const DORMANCY_SILENCE_MS = 7 * 24 * 3600 * 1000;   // no sends for this long
const DORMANCY_COOLDOWN_MS = 14 * 24 * 3600 * 1000; // don't re-nudge sooner

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const wrap = (innerHtml: string) => `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.55; color:#1a1a1a; background:#fafaf7; margin:0; padding:24px 0;">
  <div style="max-width:540px; margin:0 auto; background:#fff; padding:32px 28px; border-radius:14px; border:1px solid #efeae0;">
    ${innerHtml}
  </div>
  <div style="max-width:540px; margin:14px auto 0; text-align:center; font-size:11px; color:#888;">
    ACA · ${PUBLIC_SITE_DISPLAY}<br>
    <a href="${APP_URL}/settings?tab=notifications" style="color:#888;text-decoration:underline;">Turn these off</a>
  </div>
</body></html>`;

const btn = (label: string, href: string) =>
  `<a href="${href}" style="display:inline-block;padding:11px 22px;background:#D4361A;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">${label} →</a>`;

const stat = (value: string, label: string) =>
  `<td style="padding:14px 10px;text-align:center;background:#FBFAF6;border-radius:10px;">
     <div style="font-size:26px;font-weight:700;color:#15140F;line-height:1.1;">${value}</div>
     <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#6B6759;margin-top:4px;">${label}</div>
   </td>`;

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[lifecycle-digest] RESEND_API_KEY missing, skipping send to", to);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("[lifecycle-digest] resend failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[lifecycle-digest] send error", e);
    return false;
  }
}

type Supa = SupabaseClient<any>;

async function countSends(supabase: Supa, orgId: string, sinceIso: string): Promise<number> {
  const { count } = await supabase
    .from("email_send_log")
    .select("organization_id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .gte("sent_at", sinceIso);
  return count ?? 0;
}

async function lastSendAt(supabase: Supa, orgId: string): Promise<number | null> {
  const { data } = await supabase
    .from("email_send_log")
    .select("sent_at")
    .eq("organization_id", orgId)
    .order("sent_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const v = (data as { sent_at?: string } | null)?.sent_at;
  return v ? new Date(v).getTime() : null;
}

async function countReplies(supabase: Supa, orgId: string, sinceIso: string): Promise<number> {
  const { count } = await supabase
    .from("crm_conversations")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", orgId)
    .eq("has_inbound_message", true)
    .not("is_system", "is", true)
    .gte("last_message_at", sinceIso);
  return count ?? 0;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // dryRun reports what would go out without sending or moving the cadence
  // anchors. Use it for any manual poke - this function emails real customers.
  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = !!body?.dryRun;
  } catch { /* no body is fine */ }

  try {
    const now = Date.now();
    const weekAgoIso = new Date(now - WEEK_MS).toISOString();

    // Only orgs that have ever sent are candidates for either email - there is
    // nothing to report on for an org that never started, and the onboarding
    // drip already owns that population.
    const { data: senders } = await supabase
      .from("email_send_log")
      .select("organization_id")
      .not("organization_id", "is", null)
      .limit(5000);
    const orgIds = [...new Set(((senders || []) as Array<{ organization_id: string }>).map((r) => r.organization_id))];

    const { data: states } = await supabase
      .from("lifecycle_digest_state")
      .select("organization_id, last_weekly_at, last_dormancy_at");
    const stateByOrg = new Map(
      ((states || []) as Array<{ organization_id: string; last_weekly_at: string | null; last_dormancy_at: string | null }>)
        .map((s) => [s.organization_id, s])
    );

    let weekly = 0;
    let dormancy = 0;

    for (const orgId of orgIds) {
      const { data: prefs } = await supabase
        .from("drip_preferences")
        .select("paused, stream_digest")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (prefs?.paused || prefs?.stream_digest === false) continue;

      const { data: member } = await supabase
        .from("users")
        .select("email, full_name")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!member?.email) continue;

      const firstName = ((member.full_name as string) || "").split(" ")[0] || "";
      const state = stateByOrg.get(orgId);
      const lastWeekly = state?.last_weekly_at ? new Date(state.last_weekly_at).getTime() : 0;
      const lastDormancy = state?.last_dormancy_at ? new Date(state.last_dormancy_at).getTime() : 0;

      const sent7 = await countSends(supabase, orgId, weekAgoIso);
      const lastSend = await lastSendAt(supabase, orgId);
      const silentFor = lastSend ? now - lastSend : Infinity;

      // ── Dormancy: they used to send, and then stopped.
      if (
        sent7 === 0 &&
        silentFor >= DORMANCY_SILENCE_MS &&
        now - lastDormancy >= DORMANCY_COOLDOWN_MS
      ) {
        const days = Math.floor(silentFor / 86_400_000);
        const html = wrap(`
          <p style="margin-top:0;">${firstName ? `${escapeHtml(firstName)},` : "Hey,"}</p>
          <p>Nothing has gone out of your workspace in <strong>${days} days</strong>. Your sequences, your buyer profile and your lists are all still there - the machine is just switched off.</p>
          <p>The usual reason is one of three things:</p>
          <ul style="padding-left:18px;">
            <li>a sending channel disconnected and nobody noticed</li>
            <li>the list ran dry and needs topping up</li>
            <li>you paused during a busy week and never un-paused</li>
          </ul>
          <p>All three take about two minutes to fix.</p>
          <p style="margin:24px 0;">${btn("Check my automations", `${APP_URL}/campaigns`)}</p>
          <p style="font-size:13px;opacity:0.7;">If you've deliberately stopped, ignore this - I won't chase you again for a couple of weeks.</p>
        `);
        if (dryRun) {
          console.log(`[lifecycle-digest][dry] dormancy → ${member.email} (${days}d silent)`);
          dormancy += 1;
          continue;
        }
        if (await sendEmail(member.email as string, `Your outreach has been quiet for ${days} days`, html)) {
          dormancy += 1;
          await supabase.from("lifecycle_digest_state").upsert({
            organization_id: orgId,
            last_dormancy_at: new Date(now).toISOString(),
            updated_at: new Date(now).toISOString(),
          }, { onConflict: "organization_id" });
        }
        continue; // never both in the same tick
      }

      // ── Weekly digest: only worth sending if something actually happened.
      if (sent7 > 0 && now - lastWeekly >= WEEK_MS) {
        const replies = await countReplies(supabase, orgId, weekAgoIso);
        const replyRate = sent7 > 0 ? ((replies / sent7) * 100).toFixed(1) : "0.0";

        const verdict = replies === 0
          ? "No replies yet this week. That is usually copy or targeting, not volume - the fastest lever is a sharper first line on step 1."
          : replies / sent7 >= 0.03
            ? "That reply rate is healthy. The lever now is volume: more of the same people, same message."
            : "Replies are coming but thin. Worth rewriting step 1 for the segment that did respond.";

        const html = wrap(`
          <p style="margin-top:0;">${firstName ? `${escapeHtml(firstName)},` : "Hey,"}</p>
          <p>Your last 7 days:</p>
          <table role="presentation" width="100%" cellspacing="8" cellpadding="0" style="margin:18px 0;"><tr>
            ${stat(String(sent7), "sent")}
            ${stat(String(replies), "replies")}
            ${stat(`${replyRate}%`, "reply rate")}
          </tr></table>
          <p>${verdict}</p>
          <p style="margin:24px 0;">${btn("Open my automations", `${APP_URL}/campaigns`)}</p>
        `);

        const subject = replies > 0
          ? `${replies} ${replies === 1 ? "reply" : "replies"} from ${sent7} sends this week`
          : `${sent7} sends, no replies yet - here's the fix`;

        if (dryRun) {
          console.log(`[lifecycle-digest][dry] weekly → ${member.email}: ${subject}`);
          weekly += 1;
          continue;
        }
        if (await sendEmail(member.email as string, subject, html)) {
          weekly += 1;
          await supabase.from("lifecycle_digest_state").upsert({
            organization_id: orgId,
            last_weekly_at: new Date(now).toISOString(),
            updated_at: new Date(now).toISOString(),
          }, { onConflict: "organization_id" });
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, dryRun, orgs: orgIds.length, weekly, dormancy }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[lifecycle-digest-tick] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
