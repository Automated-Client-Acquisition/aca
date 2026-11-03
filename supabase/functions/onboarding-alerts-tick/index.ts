// ============================================================================
// onboarding-alerts-tick
// ----------------------------------------------------------------------------
// Sister cron to onboarding-drip-tick. Fires *behavior-triggered* emails when
// a user's pipeline state crosses a meaningful threshold - not on the time
// dimension but on the operational one. Designed so users genuinely cannot
// fail without us nudging them into the next right move.
//
// Triggers shipped:
//
//   no_login_72h         No login in 72h post-conversion → "anything blocking?"
//   no_leads_d3          Day-3 post-conversion + still 0 prospects → guided import
//   low_reply_rate       2+ weeks of sending + reply rate < 3% → diagnosis email
//   inbox_volume_cap     Sending hit 80% of inbox cap → add a 2nd sender
//   stalled_replies      5+ replies waiting in inbox > 24h → nudge to approve
//   campaign_empty       Campaign hit 0 enrolled leads remaining → reload
//
// Each trigger has its own idempotence window (some fire once-ever, some
// fire monthly) tracked in onboarding_drip_state.alerts_fired.
// ============================================================================

import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@^2.39.0";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";
import { APP_URL, fromAddress } from "../_shared/site-config.ts";

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

interface AlertCtx {
  orgId: string;
  email: string;
  firstName: string;
  hasLeads: boolean;
  totalLeads: number;
  totalSentLast14d: number;
  totalRepliesLast14d: number;
  positiveRepliesLast14d: number;
  unrepliedInboxOver24h: number;
  daysSinceLastLogin: number;
  daysSinceConversion: number;
  inboxCount: number;
  campaignsActive: number;
  // Billing state
  subscriptionStatus: string | null;
  daysPastDue: number;          // -1 if not past_due
  // Live assets for personalization
  icpFirstName: string | null;
  // LinkedIn account health
  linkedinDisconnectedCount: number;
  linkedinActiveNeverSyncedCount: number;
  /** Age in hours of the *oldest* LinkedIn account that is active but has
   *  never synced its connections. 0 if no such account exists. Used to
   *  gate the never-synced alert without depending on conversion date,
   *  since many paid orgs are comped and have no converted_at timestamp. */
  linkedinNeverSyncedOldestAgeHours: number;
}

interface Alert {
  key: string;
  /** How often this alert can fire (in days). `null` = once ever. */
  cooldownDays: number | null;
  /** Required: behavior predicate. */
  shouldFire: (ctx: AlertCtx) => boolean;
  subject: (ctx: AlertCtx) => string;
  html: (ctx: AlertCtx) => string;
}

// ─── Email shell (matches drip-tick styling) ────────────────────────────────
const wrap = (innerHtml: string) => `
<!doctype html>
<html><body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; font-size:15px; line-height:1.55; color:#1a1a1a; background:#fafaf7; margin:0; padding:24px 0;">
  <div style="max-width:540px; margin:0 auto; background:#fff; padding:32px 28px; border-radius:14px; border:1px solid #efeae0;">
    ${innerHtml}
  </div>
  <div style="max-width:540px; margin:14px auto 0; text-align:center; font-size:11px; color:#888;">
    ACA · <a href="${APP_URL}/settings/notifications" style="color:#888;">manage emails</a>
  </div>
</body></html>`;

const btn = (label: string, href: string) =>
  `<a href="${href}" style="display:inline-block;padding:11px 22px;background:#D4361A;color:#fff;text-decoration:none;border-radius:999px;font-weight:600;font-size:14px;">${label} →</a>`;

// ─── Triggers ──────────────────────────────────────────────────────────────
const ALERTS: Alert[] = [
  {
    key: "no_leads_d3",
    cooldownDays: null, // once-ever
    shouldFire: (c) =>
      c.daysSinceConversion >= 3 &&
      c.daysSinceConversion <= 7 &&
      !c.hasLeads,
    subject: () => `You haven't loaded a single prospect yet - let's fix that`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>You've had ACA for 3 days. Your workspace is fully built - buyer profile, sequence, campaign, agent. But there are <strong>zero prospects in the system</strong>.</p>
      <p>It's like buying a car and never putting fuel in. Nothing's broken - there's just nothing to run.</p>
      <p>Three ways to get your first 10:</p>
      <ul style="padding-left:20px;line-height:1.75;">
        <li><strong>Paste a LinkedIn Sales Navigator URL</strong> - we'll pull the list in. Fastest if you already use Sales Nav.</li>
        <li><strong>Drop a CSV</strong> - names + companies + LinkedIn URLs. 5 minutes from spreadsheet to enrolled.</li>
        <li><strong>Use our 123M B2B pool</strong> - filter by ICP attributes (role, company size, geo). Built-in.</li>
      </ul>
      <p style="margin:24px 0;">${btn("Load 10 prospects now", `${APP_URL}/leads/lists`)}</p>
      <p style="font-size:13px;opacity:0.65;">Hit reply if something's blocking - I'll personally help unblock you.</p>
    `),
  },

  {
    key: "low_reply_rate",
    cooldownDays: 30,
    shouldFire: (c) => {
      if (c.totalSentLast14d < 50) return false; // not enough signal yet
      const rate = c.totalRepliesLast14d / c.totalSentLast14d;
      return rate < 0.03; // under 3%
    },
    subject: (c) => `Your reply rate is ${Math.round((c.totalRepliesLast14d / c.totalSentLast14d) * 1000) / 10}% - here's what's likely wrong`,
    html: (c) => {
      const rate = (c.totalRepliesLast14d / c.totalSentLast14d) * 100;
      return wrap(`
        <p>Hi ${c.firstName || "there"},</p>
        <p>You've sent ${c.totalSentLast14d} prospects over the last 14 days and gotten ${c.totalRepliesLast14d} replies. That's ${rate.toFixed(1)}%.</p>
        <p>Healthy reply rate at this stage is 6-12%. Yours is below 3%, which means <strong>something specific is broken</strong>. In rough order of likelihood:</p>
        <ol style="padding-left:20px;line-height:1.75;">
          <li><strong>Wrong list.</strong> The role/company-size/geo doesn't match what your offer solves. Open your campaign and check the actual prospects you enrolled - do they look like ${c.icpFirstName ? c.icpFirstName : "your ideal buyer"}?</li>
          <li><strong>Wrong message-to-list fit.</strong> Even right people get the wrong pitch. Pull 10 of your sent emails. Does the opening line reference something specific about THAT prospect, or could it have gone to anyone?</li>
          <li><strong>Spam folder.</strong> Open one of your sent emails in your own inbox (different domain). Where did it land? If spam, your domain warmth or DKIM/SPF is the issue, not the copy.</li>
          <li><strong>Wrong time.</strong> Check your sending hours. Cold emails sent 11pm-6am their time get half the reply rate.</li>
        </ol>
        <p>Reply to this email with which one resonates and I'll help you tune it.</p>
        <p style="margin:24px 0;">${btn("Open analytics", `${APP_URL}/analytics`)}</p>
      `);
    },
  },

  {
    key: "stalled_replies",
    cooldownDays: 3,
    shouldFire: (c) => c.unrepliedInboxOver24h >= 5,
    subject: (c) => `${c.unrepliedInboxOver24h} replies waiting on you - the lag is killing your conversion`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>${c.unrepliedInboxOver24h} replies have been sitting in your inbox over 24 hours without a response.</p>
      <p>Bookings are a momentum game. A "yes, tell me more" replied to within 2 hours converts at ~70%. Same reply at 48 hours: under 25%. The interest is real-time.</p>
      <p>Your booking agent already drafted answers in your voice. You just need to scan, approve, and send. Most people clear 5 drafts in 4 minutes.</p>
      <p style="margin:24px 0;">${btn("Approve drafts now", `${APP_URL}/inbox?filter=needs_approval`)}</p>
    `),
  },

  {
    key: "inbox_volume_cap",
    cooldownDays: 30,
    shouldFire: (c) => {
      // Sending more than 25/day per inbox → time to scale.
      const dailyAvg = c.totalSentLast14d / 14;
      const perInbox = c.inboxCount > 0 ? dailyAvg / c.inboxCount : dailyAvg;
      return c.inboxCount <= 1 && perInbox >= 20;
    },
    subject: () => `You're capped at ~25/day - time to add a 2nd sender`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Your single inbox is averaging ${Math.round((c.totalSentLast14d / 14))} sends/day. That's right at the safe ceiling for one inbox - push past it and you'll burn the domain.</p>
      <p>The fix is mechanical: add a second sending inbox on a secondary domain. ACA's BYO M365 setup is $0.66/inbox/month all-in (mailbox + DKIM/SPF/DMARC + warmup + auto-rotation).</p>
      <p>Members who hit this cap and added a 2nd inbox averaged a 2.3× lift in booked meetings within 14 days. The ones who pushed past 30/day on a single inbox usually burned 1-2 months of reputation.</p>
      <p style="margin:24px 0;">${btn("Add a 2nd inbox", `${APP_URL}/email/infrastructure`)}</p>
    `),
  },

  {
    key: "campaign_empty",
    cooldownDays: 7,
    shouldFire: (c) =>
      c.daysSinceConversion >= 5 &&
      c.totalLeads > 0 &&
      c.campaignsActive > 0 &&
      c.totalLeads <= 5, // running low
    subject: () => `Your campaign is running on fumes - 5 prospects or fewer left`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>You have ${c.totalLeads} prospect${c.totalLeads === 1 ? "" : "s"} left in your campaign. Once they run through, your pipeline goes quiet until you load more.</p>
      <p>This is the moment most people accidentally pause their growth. Don't.</p>
      <p>Load 20-50 fresh ones now so the sequence keeps shipping while you're sleeping. ACA's lead pool has 123M B2B contacts - filter by your ICP attributes and you'll have them queued in 5 minutes.</p>
      <p style="margin:24px 0;">${btn("Load next batch", `${APP_URL}/leads/lists`)}</p>
    `),
  },

  {
    key: "no_login_72h",
    cooldownDays: 14,
    shouldFire: (c) =>
      c.daysSinceConversion >= 3 &&
      c.daysSinceLastLogin >= 3,
    subject: (c) => `${c.firstName || "Hey"} - haven't seen you in 3 days. Anything blocking?`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Noticed you haven't logged in in 3 days. Not a guilt trip - I'm asking because <strong>9 out of 10 times this means something specific is unclear or blocking you</strong>, and most of those things take me 2 minutes to unblock.</p>
      <p>Common ones I see:</p>
      <ul style="padding-left:20px;line-height:1.65;">
        <li><em>"I don't know what list to start with."</em> Reply with your ICP - I'll send 50 verified prospects.</li>
        <li><em>"My OpenRouter key isn't working."</em> Common issue, takes me 30 sec to debug if you reply with the error.</li>
        <li><em>"I'm not sure if the sequence is good - I'm second-guessing."</em> Send me the LinkedIn URL of one prospect, I'll review your sequence for them in 5 min.</li>
        <li><em>"I forgot."</em> Honestly the most common. No judgment - open the workspace, do the 5-min daily playbook, you'll be back in flow.</li>
      </ul>
      <p>Hit reply with whatever's blocking. Even one word.</p>
      <p style="margin-top:20px;"> - Cedric</p>
    `),
  },

  // ── LinkedIn account health ─────────────────────────────────────────────
  {
    key: "linkedin_sender_disconnected",
    cooldownDays: 3,
    shouldFire: (c) => c.linkedinDisconnectedCount >= 1,
    subject: (c) =>
      c.linkedinDisconnectedCount === 1
        ? `Your LinkedIn sender just disconnected - campaigns are frozen`
        : `${c.linkedinDisconnectedCount} LinkedIn senders disconnected - campaigns are frozen`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>${c.linkedinDisconnectedCount === 1 ? "One of your" : `${c.linkedinDisconnectedCount} of your`} LinkedIn senders ${c.linkedinDisconnectedCount === 1 ? "lost" : "lost their"} session - LinkedIn periodically forces a re-auth and the cookie expired.</p>
      <p>What this means right now:</p>
      <ul style="padding-left:20px;line-height:1.65;">
        <li>Every lead that was about to send through ${c.linkedinDisconnectedCount === 1 ? "that sender" : "those senders"} is paused.</li>
        <li>Connection requests in flight are not being checked.</li>
        <li>Replies on LinkedIn aren't syncing to your inbox until ${c.linkedinDisconnectedCount === 1 ? "it's" : "they're"} back online.</li>
      </ul>
      <p>The fix takes 30 seconds: log into Settings → Integrations and hit Reconnect. Your paused leads automatically resume from exactly where they left off (we don't lose state).</p>
      <p style="margin:24px 0;">${btn("Reconnect now", `${APP_URL}/settings?tab=integrations`)}</p>
      <p style="font-size:13px;opacity:0.65;">If you're switching to a different LinkedIn account on purpose, just connect the new one - we'll migrate the campaigns over automatically.</p>
    `),
  },

  {
    key: "linkedin_never_synced",
    cooldownDays: null, // once-ever per org
    shouldFire: (c) =>
      c.linkedinActiveNeverSyncedCount >= 1 &&
      c.linkedinNeverSyncedOldestAgeHours >= 24,
    subject: () => `Your LinkedIn network isn't synced - campaigns can't see your connections`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Your LinkedIn account is connected but we haven't imported your network yet. Until that runs, ACA can't tell whether a prospect is already your 1st-degree connection - which means messages-to-existing-connections won't fire and connection requests get sent to people you're already connected to.</p>
      <p>It's a one-click backfill: open the Contacts page and hit <strong>Sync connections</strong>. Takes 2-5 minutes depending on network size, runs in the background, you can close the tab.</p>
      <p style="margin:24px 0;">${btn("Sync my LinkedIn network", `${APP_URL}/contacts`)}</p>
      <p style="font-size:13px;opacity:0.65;">From now on, any new account you connect auto-syncs - this is a one-time backfill for accounts connected before that change.</p>
    `),
  },

  // ── Billing alerts: past_due grace cycle ────────────────────────────────
  // Stripe attempts 4 dunning retries over ~7 days. We notify on the first
  // failure, then again at day 5 with stronger urgency. ProtectedRoute
  // hard-blocks on day 7. After the hard-block, the org sees the lock
  // screen on every page so further alerts are redundant.
  {
    key: "past_due_immediate",
    cooldownDays: null, // once-ever per past_due episode (cleared via
                        // alerts_fired on payment recovery would be ideal,
                        // but for now once-ever is safe enough)
    shouldFire: (c) =>
      c.subscriptionStatus === "past_due" &&
      c.daysPastDue >= 0 &&
      c.daysPastDue <= 1,
    subject: () => `Your card just failed - quick fix needed`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Quick heads up: Stripe just told us your most recent payment failed.</p>
      <p>This usually means one of: card expired, bank fraud alert, daily limit hit, or address mismatch. Almost always a 60-second fix.</p>
      <p>Your workspace stays fully active for the next <strong>7 days</strong> while we (and Stripe) retry the charge. After that, sending pauses until the card is sorted.</p>
      <p>Easiest path: update the card now, you'll never notice the interruption.</p>
      <p style="margin:24px 0;">${btn("Update payment method", `${APP_URL}/settings/billing`)}</p>
      <p style="font-size:13px;opacity:0.65;">If you wanted to cancel, just hit reply with "cancel" and I'll close it cleanly.</p>
    `),
  },

  {
    key: "past_due_day5",
    cooldownDays: null,
    shouldFire: (c) =>
      c.subscriptionStatus === "past_due" &&
      c.daysPastDue >= 5 &&
      c.daysPastDue < 7,
    subject: () => `2 days until your workspace locks`,
    html: (c) => wrap(`
      <p>Hi ${c.firstName || "there"},</p>
      <p>Your card has been declining for 5 days now. Stripe retried it twice automatically - neither went through.</p>
      <p>In about 48 hours your workspace will lock. Outbound stops sending. Your booking agent stops replying. Your campaigns pause.</p>
      <p>One click fixes this:</p>
      <p style="margin:24px 0;">${btn("Update payment now", `${APP_URL}/settings/billing`)}</p>
      <p>If you're not coming back, no worries - reply "cancel" and I'll close it without locking you out first.</p>
      <p style="margin-top:20px;"> - Cedric</p>
    `),
  },
];

// ─── Metric loader ──────────────────────────────────────────────────────────
async function loadAlertCtx(supabase: SupabaseClient, orgId: string): Promise<AlertCtx | null> {
  const since14d = new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString();
  const since24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();

  const [
    memberQ,
    icpQ,
    leadsTotalQ,
    sentQ,
    repliesQ,
    inboxNeedingApprovalQ,
    inboxOver24hQ,
    inboxesQ,
    campaignsQ,
    dripStateQ,
    sessionsQ,
    orgBillingQ,
    linkedinAccountsQ,
  ] = await Promise.all([
    supabase.from("users").select("email, full_name, last_login_at").eq("organization_id", orgId).order("created_at", { ascending: true }).limit(1).maybeSingle(),
    supabase.from("library_icps").select("name").eq("organization_id", orgId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    supabase.from("crm_contacts").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    supabase.from("email_events").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("event_type", "sent").gte("created_at", since14d),
    supabase.from("email_events").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("event_type", "replied").gte("created_at", since14d),
    supabase.from("inbox_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("agent_status", "draft"),
    supabase.from("inbox_messages").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("agent_status", "draft").lte("created_at", since24h),
    supabase.from("email_mailboxes").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active"),
    supabase.from("linkedin_campaigns").select("id", { count: "exact", head: true }).eq("organization_id", orgId).eq("status", "active"),
    supabase.from("onboarding_drip_state").select("converted_at, alerts_fired").eq("organization_id", orgId).maybeSingle(),
    supabase.from("users").select("last_login_at").eq("organization_id", orgId).order("last_login_at", { ascending: false, nullsFirst: false }).limit(1).maybeSingle(),
    supabase.from("organizations").select("subscription_status, past_due_since").eq("id", orgId).maybeSingle(),
    supabase.from("unipile_accounts").select("id, status, created_at").eq("organization_id", orgId).eq("provider", "LINKEDIN"),
  ]);

  if (!memberQ.data?.email) return null;

  const convertedAt = dripStateQ.data?.converted_at ? new Date(dripStateQ.data.converted_at as string).getTime() : null;
  const daysSinceConversion = convertedAt ? (Date.now() - convertedAt) / 86_400_000 : -1;

  const lastSignIn = (sessionsQ.data?.last_login_at as string | null)
                  || (memberQ.data.last_login_at as string | null);
  const daysSinceLastLogin = lastSignIn ? (Date.now() - new Date(lastSignIn).getTime()) / 86_400_000 : 999;

  const totalLeads = leadsTotalQ.count ?? 0;
  const firstName = ((memberQ.data.full_name as string) || "").split(" ")[0] || "";
  const icpName = (icpQ.data?.name as string | null) || null;

  // LinkedIn health: count disconnected accounts, and count active accounts
  // that have no linked contact identities - the ground truth the campaign
  // engine actually reads. connections_count and metadata.connections_sync_*
  // are unreliable (multiple sub-bugs in unipile-sync-connections), but
  // crm_contact_identities.linked_account_ids is what message routing checks.
  type LinkedinAcct = {
    id: string;
    status: string | null;
    created_at: string | null;
  };
  const linkedinAccts = (linkedinAccountsQ.data as LinkedinAcct[] | null) || [];
  const linkedinDisconnectedCount = linkedinAccts.filter((a) => a.status === "disconnected").length;

  // For each active LinkedIn account, ask the identities table directly.
  const activeLinkedinAccts = linkedinAccts.filter((a) => a.status === "active");
  const identityCounts = await Promise.all(
    activeLinkedinAccts.map(async (a) => {
      const { count } = await supabase
        .from("crm_contact_identities")
        .select("id", { count: "exact", head: true })
        .contains("linked_account_ids", [a.id]);
      return { acct: a, identitiesLinked: count ?? 0 };
    }),
  );
  const neverSyncedAccts = identityCounts.filter((r) => r.identitiesLinked === 0).map((r) => r.acct);
  const linkedinActiveNeverSyncedCount = neverSyncedAccts.length;
  const linkedinNeverSyncedOldestAgeHours = neverSyncedAccts.reduce((maxHours, a) => {
    if (!a.created_at) return maxHours;
    const ageHours = (Date.now() - new Date(a.created_at).getTime()) / 3_600_000;
    return Math.max(maxHours, ageHours);
  }, 0);

  const subscriptionStatus = (orgBillingQ.data?.subscription_status as string | null) ?? null;
  const pastDueSince = orgBillingQ.data?.past_due_since
    ? new Date(orgBillingQ.data.past_due_since as string).getTime()
    : null;
  const daysPastDue = pastDueSince
    ? Math.floor((Date.now() - pastDueSince) / 86_400_000)
    : -1;

  return {
    orgId,
    email: memberQ.data.email as string,
    firstName,
    hasLeads: totalLeads > 0,
    totalLeads,
    totalSentLast14d: sentQ.count ?? 0,
    totalRepliesLast14d: repliesQ.count ?? 0,
    positiveRepliesLast14d: 0,
    unrepliedInboxOver24h: inboxOver24hQ.count ?? 0,
    daysSinceLastLogin,
    daysSinceConversion,
    inboxCount: inboxesQ.count ?? 0,
    campaignsActive: campaignsQ.count ?? 0,
    subscriptionStatus,
    daysPastDue,
    icpFirstName: icpName ? icpName.split(" ")[0] || null : null,
    linkedinDisconnectedCount,
    linkedinActiveNeverSyncedCount,
    linkedinNeverSyncedOldestAgeHours,
  };
}

// ─── Send helper ───────────────────────────────────────────────────────────
async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) {
    console.warn("[alerts] RESEND_API_KEY missing");
    return false;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html }),
    });
    if (!res.ok) {
      console.error("[alerts] resend failed", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("[alerts] send error", e);
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

    // Run for every paid org (pro or enterprise), regardless of age or
    // Stripe linkage. Many paid orgs are comped or manually upgraded and
    // never get a stripe_subscription_id - gating on that field misses the
    // majority of paying users. Per-alert timing (e.g. daysSinceConversion
    // for onboarding alerts) is enforced inside each alert's shouldFire.
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, created_at, plan_tier")
      .in("plan_tier", ["pro", "enterprise"]);
    if (error) throw error;

    let sent = 0;
    let scanned = 0;

    for (const org of orgs || []) {
      scanned += 1;
      const ctx = await loadAlertCtx(supabase, org.id as string);
      if (!ctx) continue;

      // Respect drip_preferences - paused or alerts stream off = silent.
      const { data: prefs } = await supabase
        .from("drip_preferences")
        .select("paused, stream_alerts, muted_stages")
        .eq("organization_id", org.id)
        .maybeSingle();
      if (prefs?.paused) continue;
      if (prefs && prefs.stream_alerts === false) continue;

      // Load alerts_fired map: { alertKey: lastFiredISO }
      const { data: state } = await supabase
        .from("onboarding_drip_state")
        .select("alerts_fired")
        .eq("organization_id", org.id)
        .maybeSingle();
      const fired = ((state?.alerts_fired as Record<string, string> | null) || {});
      const mutedStages = (prefs?.muted_stages as string[] | undefined) || [];

      for (const alert of ALERTS) {
        if (mutedStages.includes(alert.key)) continue;
        if (!alert.shouldFire(ctx)) continue;

        const lastFired = fired[alert.key] ? new Date(fired[alert.key]).getTime() : null;
        if (lastFired) {
          if (alert.cooldownDays == null) continue; // once-ever, already done
          const ageDays = (Date.now() - lastFired) / 86_400_000;
          if (ageDays < alert.cooldownDays) continue;
        }

        const ok = await sendEmail(ctx.email, alert.subject(ctx), alert.html(ctx));
        if (!ok) continue;

        const nextFired = { ...fired, [alert.key]: new Date().toISOString() };
        await supabase.from("onboarding_drip_state").upsert({
          organization_id: org.id,
          alerts_fired: nextFired,
          updated_at: new Date().toISOString(),
        });
        sent += 1;
        break; // one alert per org per tick to avoid email-bombing
      }
    }

    return new Response(JSON.stringify({ ok: true, sent, scanned }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[onboarding-alerts-tick] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
