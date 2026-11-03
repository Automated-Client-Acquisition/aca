// ============================================================================
// reply-notification-tick
// ----------------------------------------------------------------------------
// A prospect replied. Tell the human.
//
// For an outreach product this is the single strongest reason to open the app,
// and until now nothing sent it - replies landed in the inbox and sat there
// until someone happened to look.
//
// Runs every 5 minutes. Per org it batches whatever came in during the window
// into ONE email, so a burst of five replies is one useful nudge rather than
// five pings. Dedupe is by (conversation, last_message_at): a newer inbound
// message on the same thread alerts again, the same one never twice.
//
// Deliberately skips:
//   * system conversations (bounce / mailer-daemon threads)
//   * conversations matching the org's inbox keyword exclusions
//   * contacts already marked bounced or do_not_contact
//   * orgs that paused their emails or muted this stream in drip_preferences
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
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
  // Apex is unverified in Resend (403); only the `notifications.` subdomain sends.
  fromAddress("cedric");

// How far back to consider. Generous vs the 5-minute cadence so a cron blip
// or a redeploy doesn't silently drop a reply on the floor.
const LOOKBACK_MINUTES = 90;

const CHANNEL_LABEL: Record<string, string> = {
  email: "Email",
  linkedin: "LinkedIn",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  telegram: "Telegram",
  sms: "SMS",
};

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
    <a href="${APP_URL}/settings?tab=notifications" style="color:#888;text-decoration:underline;">Turn reply alerts off</a>
  </div>
</body></html>`;

const btn = (label: string, href: string) =>
  `<a href="${href}" style="display:inline-block;padding:11px 22px;background:#D4361A;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">${label} →</a>`;

interface ConversationRow {
  id: string;
  organization_id: string;
  contact_id: string | null;
  channel: string;
  last_message_at: string;
  last_message_preview: string | null;
  last_message_subject: string | null;
}

async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[reply-notify] RESEND_API_KEY missing, skipping send to", to);
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("[reply-notify] resend failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[reply-notify] send error", e);
    return false;
  }
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

  // dryRun reports exactly what would go out without sending or recording it.
  // Use it for any manual poke at this function - it emails real customers.
  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = !!body?.dryRun;
  } catch { /* no body is fine */ }

  try {
    const since = new Date(Date.now() - LOOKBACK_MINUTES * 60 * 1000).toISOString();

    const { data: convos, error } = await supabase
      .from("crm_conversations")
      .select("id, organization_id, contact_id, channel, last_message_at, last_message_preview, last_message_subject")
      .eq("last_message_direction", "inbound")
      .eq("has_inbound_message", true)
      .not("is_system", "is", true)
      .gte("last_message_at", since)
      .order("last_message_at", { ascending: false })
      .limit(500);
    if (error) throw error;

    const rows = (convos || []) as ConversationRow[];
    if (!rows.length) {
      return new Response(JSON.stringify({ ok: true, appUrl: APP_URL, scanned: 0, sent: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Drop the ones we've already alerted on for this exact message.
    const { data: stateRows } = await supabase
      .from("reply_notification_state")
      .select("conversation_id, notified_message_at")
      .in("conversation_id", rows.map((r) => r.id));
    const notifiedAt = new Map(
      ((stateRows || []) as Array<{ conversation_id: string; notified_message_at: string }>)
        .map((s) => [s.conversation_id, new Date(s.notified_message_at).getTime()])
    );
    const fresh = rows.filter((r) => {
      const prev = notifiedAt.get(r.id);
      return !prev || new Date(r.last_message_at).getTime() > prev;
    });
    if (!fresh.length) {
      return new Response(JSON.stringify({ ok: true, appUrl: APP_URL, scanned: rows.length, sent: 0 }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Contact names, and a filter for the ones that aren't real humans replying.
    const contactIds = [...new Set(fresh.map((r) => r.contact_id).filter(Boolean))] as string[];
    const { data: contacts } = await supabase
      .from("crm_contacts")
      .select("id, display_name, company_name, status, primary_email")
      .in("id", contactIds);
    const contactById = new Map(
      ((contacts || []) as Array<{ id: string; display_name: string; company_name: string | null; status: string | null; primary_email: string | null }>)
        .map((c) => [c.id, c])
    );

    const notifiable = fresh.filter((r) => {
      if (!r.contact_id) return false;
      const c = contactById.get(r.contact_id);
      if (!c) return false;
      // A bounce notification is not a reply, and a suppressed contact is not
      // someone we want to nudge the user to answer.
      return c.status !== "bounced" && c.status !== "do_not_contact";
    });

    // Group by org so a burst is one email.
    const byOrg = new Map<string, ConversationRow[]>();
    for (const r of notifiable) {
      const list = byOrg.get(r.organization_id) || [];
      list.push(r);
      byOrg.set(r.organization_id, list);
    }

    // Keyword exclusions, for every org in this batch at once.
    const orgIds = [...byOrg.keys()];
    const { data: kwRows } = await supabase
      .from("inbox_keyword_exclusions")
      .select("organization_id, normalized_keyword")
      .in("organization_id", orgIds);
    const keywordsByOrg = new Map<string, string[]>();
    for (const row of (kwRows || []) as Array<{ organization_id: string; normalized_keyword: string }>) {
      const kw = (row.normalized_keyword || "").trim().toLowerCase();
      if (!kw) continue;
      const list = keywordsByOrg.get(row.organization_id) || [];
      list.push(kw);
      keywordsByOrg.set(row.organization_id, list);
    }

    let sent = 0;
    let seeded = 0;
    let unsolicited = 0;
    let keywordExcluded = 0;

    const stampSeen = async (rows: ConversationRow[], orgId: string) => {
      if (!rows.length || dryRun) return;
      await supabase.from("reply_notification_state").upsert(
        rows.map((r) => ({
          conversation_id: r.id,
          organization_id: orgId,
          notified_message_at: r.last_message_at,
          notified_at: new Date().toISOString(),
        })),
        { onConflict: "conversation_id" },
      );
    };

    for (const [orgId, orgConvs] of byOrg) {
      // The org's own exclusion keywords, applied here rather than trusted to
      // have already landed on the row.
      //
      // is_system is set by the sweep and the per-message trigger, but neither
      // is a guarantee at alert time: the sweep runs out of band (a reply can
      // arrive and be alerted before the queue drains), the trigger only sees
      // what is on the message row when it is inserted, and a list that never
      // made it out of the browser's localStorage marks nothing at all. The
      // inbox meanwhile filters by keyword at query time - so the customer sees
      // a clean inbox and still gets mailed about every warmup thread in it.
      // Same haystack the inbox uses (preview, subject, contact name, address)
      // plus the inbound message bodies.
      const keywords = keywordsByOrg.get(orgId) || [];
      const allConvs = !keywords.length ? orgConvs : await (async () => {
        const hits = new Set<string>();
        const matches = (text: string | null | undefined) => {
          if (!text) return false;
          const hay = text.toLowerCase();
          return keywords.some((kw) => hay.includes(kw));
        };

        for (const r of orgConvs) {
          const c = r.contact_id ? contactById.get(r.contact_id) : null;
          if (
            matches(r.last_message_preview) ||
            matches(r.last_message_subject) ||
            matches(c?.display_name) ||
            matches(c?.company_name) ||
            matches(c?.primary_email)
          ) {
            hits.add(r.id);
          }
        }

        // Bodies, for the ones the headers did not settle. Bounded by this
        // tick's conversations, so it stays a small indexed lookup.
        const remaining = orgConvs.filter((r) => !hits.has(r.id)).map((r) => r.id);
        if (remaining.length) {
          const { data: msgs, error: msgErr } = await supabase
            .from("crm_messages")
            .select("conversation_id, content, email_subject")
            .eq("organization_id", orgId)
            .eq("direction", "inbound")
            .in("conversation_id", remaining)
            .limit(2000);
          // A lookup failure alerts rather than silences: a missed reply costs
          // more than a noisy one, and the header pass above already ran.
          if (!msgErr) {
            for (const m of (msgs || []) as Array<{ conversation_id: string; content: string | null; email_subject: string | null }>) {
              if (matches(m.content) || matches(m.email_subject)) hits.add(m.conversation_id);
            }
          }
        }

        if (!hits.size) return orgConvs;

        const dropped = orgConvs.filter((r) => hits.has(r.id));
        // Stamp them, or every tick re-scans the same excluded threads and a
        // later message on one re-enters this path from scratch.
        await stampSeen(dropped, orgId);
        keywordExcluded += dropped.length;
        return orgConvs.filter((r) => !hits.has(r.id));
      })();

      if (!allConvs.length) continue;

      // Opt-in per org: only alert on people we actually emailed.
      //
      // A sending mailbox receives more than our own outreach. Customers running
      // an external warmup network (Smartlead and friends) on the same mailboxes
      // get a continuous stream of human-looking filler from warmup peers.
      // detectWarmup() cannot catch it -- it matches a tag WE embed, and
      // third-party warmup carries none (0 of 1,626 recent inbound on one
      // workspace). It all lands in the CRM as genuine inbound, and every batch
      // became a "prospects replied" email: ~140 a day.
      //
      // This is NOT safe as a blanket rule. An org that sends its outbound
      // through another tool has no send-log row for its real prospects either,
      // so the same check would silence genuine replies. It only holds where
      // outbound actually runs through ACA -- hence the per-org flag, default
      // off. Keyword exclusions stay the general-purpose lever: per org, and
      // only ever the keywords that org listed.
      const { data: orgSettings } = await supabase
        .from("organization_settings")
        .select("hide_non_outreach_inbound")
        .eq("organization_id", orgId)
        .maybeSingle();
      const gateOn = orgSettings?.hide_non_outreach_inbound === true;

      const convs = !gateOn ? allConvs : await (async () => {
        const addrs = [...new Set(
          allConvs
            .map((r) => (r.contact_id ? contactById.get(r.contact_id)?.primary_email : null))
            .filter(Boolean)
            .map((e) => (e as string).toLowerCase()),
        )];
        if (!addrs.length) return [] as ConversationRow[];

        const { data: sends, error: sendErr } = await supabase
          .from("email_send_log")
          .select("recipient_email")
          .eq("organization_id", orgId)
          .in("recipient_email", [...addrs, ...addrs.map((a) => a.toUpperCase())]);
        // On a lookup failure, alerting is the safe side of the trade: a missed
        // reply costs more than a noisy one.
        if (sendErr) return allConvs;

        const emailed = new Set(
          ((sends || []) as Array<{ recipient_email: string | null }>)
            .map((s) => (s.recipient_email || "").toLowerCase())
            .filter(Boolean),
        );
        const kept: ConversationRow[] = [];
        const dropped: ConversationRow[] = [];
        for (const r of allConvs) {
          const addr = r.contact_id ? contactById.get(r.contact_id)?.primary_email : null;
          (addr && emailed.has(addr.toLowerCase()) ? kept : dropped).push(r);
        }

        // Stamp the dropped ones as seen. Without this every tick re-scans the
        // same warmup threads forever, and a later reply on one of them would
        // still be re-evaluated against a send log that by then may exist.
        await stampSeen(dropped, orgId);
        unsolicited += dropped.length;
        return kept;
      })();

      if (!convs.length) continue;

      const { data: prefs } = await supabase
        .from("drip_preferences")
        .select("paused, stream_reply_alerts")
        .eq("organization_id", orgId)
        .maybeSingle();
      if (prefs?.paused || prefs?.stream_reply_alerts === false) continue;

      // First run for this org: seed state silently instead of mailing the
      // whole backlog. An inbox poller that re-stamps last_message_at on a
      // batch of old threads would otherwise land as "47 prospects replied".
      // From the next genuinely-new inbound message on, they get alerted.
      const { count: priorState } = await supabase
        .from("reply_notification_state")
        .select("conversation_id", { count: "exact", head: true })
        .eq("organization_id", orgId);
      if (!priorState) {
        await stampSeen(convs, orgId);
        seeded += convs.length;
        continue;
      }

      // Sanity cap: a single alert should never claim a implausible burst.
      // If more than this arrives at once it is almost certainly a re-sync,
      // so seed those rows and move on rather than shouting about them.
      if (convs.length > 15) {
        await stampSeen(convs, orgId);
        console.warn(`[reply-notify] org ${orgId} had ${convs.length} inbound in one tick - treating as re-sync, not alerting`);
        seeded += convs.length;
        continue;
      }

      // Who gets it. Per-user opt-ins live in user_notification_preferences;
      // absence of a row means "inherit the legacy default", which was: the
      // oldest user row in the org, and nobody else. So with no rows at all
      // this resolves to exactly one recipient, same as before.
      //
      // The fallback user is only added when they have NO row of their own -
      // otherwise a second seat opting in would silently displace the person
      // who has been getting these all along, and an explicit opt-out would be
      // undone by the fallback.
      const { data: fallbackUser } = await supabase
        .from("users")
        .select("id, email, full_name")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: optRows } = await supabase
        .from("user_notification_preferences")
        .select("user_id, reply_alerts")
        .eq("organization_id", orgId);
      const optIn = new Map(
        ((optRows || []) as Array<{ user_id: string; reply_alerts: boolean }>)
          .map((r) => [r.user_id, r.reply_alerts !== false]),
      );

      const recipientIds = [...optIn.entries()].filter(([, on]) => on).map(([id]) => id);
      if (fallbackUser?.id && !optIn.has(fallbackUser.id)) recipientIds.push(fallbackUser.id);

      const { data: recipientRows } = recipientIds.length
        ? await supabase
          .from("users")
          .select("id, email, full_name")
          .in("id", [...new Set(recipientIds)])
          .limit(10)
        : { data: [] as Array<{ id: string; email: string | null; full_name: string | null }> };

      const recipients = ((recipientRows || []) as Array<{ id: string; email: string | null; full_name: string | null }>)
        .filter((u) => !!u.email);
      if (!recipients.length) continue;

      const items = convs.slice(0, 8);
      const who = (r: ConversationRow) => {
        const c = r.contact_id ? contactById.get(r.contact_id) : null;
        if (!c) return "A prospect";
        return c.company_name && c.company_name !== c.display_name
          ? `${c.display_name} · ${c.company_name}`
          : c.display_name;
      };

      const subject = convs.length === 1
        ? `${who(convs[0])} replied`
        : `${convs.length} prospects replied`;

      const cards = items.map((r) => {
        const preview = (r.last_message_preview || "").trim().slice(0, 220);
        return `<div style="margin:14px 0;padding:14px 18px;background:#FFF8F4;border:1px solid rgba(212,54,26,0.18);border-radius:10px;">
          <div style="font-size:10.5px;font-family:ui-monospace,Menlo,monospace;letter-spacing:0.06em;text-transform:uppercase;color:#D4361A;font-weight:600;margin-bottom:6px;">${escapeHtml(CHANNEL_LABEL[r.channel] || r.channel)}</div>
          <div style="font-weight:600;margin-bottom:4px;">${escapeHtml(who(r))}</div>
          ${r.last_message_subject ? `<div style="font-size:13px;opacity:0.7;margin-bottom:4px;">${escapeHtml(r.last_message_subject)}</div>` : ""}
          ${preview ? `<div style="color:#2A2818;">"${escapeHtml(preview)}"</div>` : ""}
          <div style="margin-top:10px;"><a href="${APP_URL}/inbox?conversation=${r.id}" style="color:#D4361A;font-weight:600;text-decoration:none;font-size:13px;">Open and reply →</a></div>
        </div>`;
      }).join("");

      // The body is identical for everyone except the greeting, so build it
      // per recipient rather than mailing one person a letter addressed to
      // someone else.
      const bodyFor = (fullName: string | null) => {
        const firstName = (fullName || "").split(" ")[0] || "";
        return wrap(`
        <p style="margin-top:0;">${firstName ? `${escapeHtml(firstName)},` : "Hey,"}</p>
        <p>${convs.length === 1
          ? "Someone you reached out to just wrote back."
          : `${convs.length} people you reached out to just wrote back.`} Replies go cold fast - the first hour is worth more than the next three days.</p>
        ${cards}
        ${convs.length > items.length ? `<p style="font-size:13px;opacity:0.7;">+ ${convs.length - items.length} more waiting in your inbox.</p>` : ""}
        <p style="margin:24px 0;">${btn("Open my inbox", `${APP_URL}/inbox`)}</p>
      `);
      };

      if (dryRun) {
        for (const u of recipients) {
          console.log(`[reply-notify][dry] would email ${u.email}: ${subject}`);
        }
        sent += recipients.length;
        continue;
      }

      let delivered = 0;
      for (const u of recipients) {
        if (await sendEmail(u.email as string, subject, bodyFor(u.full_name))) delivered += 1;
      }
      // Every recipient failing means nobody was told - leave the batch unstamped
      // so the next tick tries again rather than swallowing the replies.
      if (!delivered) continue;
      sent += delivered;

      await stampSeen(convs, orgId);
    }

    return new Response(JSON.stringify({ ok: true, dryRun, appUrl: APP_URL, scanned: rows.length, fresh: fresh.length, seeded, unsolicited, keywordExcluded, sent }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[reply-notification-tick] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
