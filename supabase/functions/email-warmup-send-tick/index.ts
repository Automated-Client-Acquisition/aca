/**
 * Email Warmup Send Tick
 *
 * Sends real mailbox-to-mailbox warmup traffic across the platform-wide mesh.
 *
 * This is the function ACA never had. `email-warmup-tick` (which still runs, and
 * still owns the cold-send daily_limit ramp) contains zero send calls — which is
 * why, as of 2026-08-03, this query returned 0:
 *
 *   select count(*) from email_send_log l
 *    where lower(l.recipient_email) in (select lower(email_address) from email_mailboxes)
 *
 * ...while 2,473 mailboxes simultaneously reported an advancing warmup_day.
 *
 * Runs on a short cron with a bounded batch: at full ramp the estate needs roughly
 * 47k warmup sends/day (~2k/hour), far beyond one edge-function invocation.
 *
 * Partner selection and daily accounting live in Postgres (pick_warmup_partners /
 * warmup_today_counts). That is deliberate: a client-side select silently caps at
 * 1000 rows, which during the first pilot invisibly hid 1,358 of 2,358 mailboxes
 * from the mesh.
 *
 * But moving work into Postgres does NOT buy immunity from that cap — an earlier
 * version of this comment claimed it did, and the claim cost 63,682 sends in a
 * single day. PostgREST truncates set-returning RPCs at 1000 rows exactly as it
 * truncates table selects. Every read here must be an aggregate, explicitly
 * paginated, or chunked-and-asserted (see warmupCountsFor).
 *
 * Volume is bounded twice: by the mesh ramp, and by the mailbox's share of its
 * daily_limit — warmup is a slice of the estate's send allocation, never an
 * addition to it (see warmupCeilingFor).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { sendEmailViaSMTP, extractSMTPCredentials } from '../_shared/smtp-client.ts';
import { sendEmailViaGraph } from '../_shared/m365-client.ts';
import {
  buildWarmupMessage,
  domainMeshCapFor,
  isWarmupSendDay,
  meshQuotaForDay,
  newWarmupRef,
  MAX_WARMUP_RECEIVES_PER_DAY,
  PAIR_COOLDOWN_DAYS,
  SEED_MAX_RECEIVES_PER_DAY,
  WARMUP_HEADER,
  type WarmupMailbox,
} from '../_shared/warmup-engine.ts';

import {
  allocateWarmupOpportunities,
  createWarmupClaimQueue,
  oldestWarmupFirst,
  recordWarmupSchedulerDay,
  warmupBudgetKey,
  warmupUsageFromLedger,
  type WarmupClaimQueue,
  type WarmupLedgerUsage,
  type WarmupSchedulerObservation,
} from '../_shared/warmup-scheduling.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Max sends per invocation. Keeps the run inside the edge function time budget. */
const DEFAULT_BATCH = 250;
/** Senders assigned a partner per round. Bounds the RPC array and the follow-up fetch. */
const ROUND_SIZE = 200;
/** Parallel sends. Small enough to stay under per-tenant Graph throttling. */
const SEND_CONCURRENCY = 8;
/** PostgREST page size for paginated reads. */
const PAGE = 1000;

const MAILBOX_COLS = `
  id, organization_id, email_address, display_name, provider, status,
  sending_domain_id, warmup_day, warmup_max_daily, warmup_reply_rate_target,
  warmup_daily_reply_target, warmup_weekdays_only, warmup_randomize,
  warmup_randomize_range, warmup_tag, metadata,
  daily_limit, daily_sent, daily_sent_reset_at, warmup_last_send_at
`;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let batchLimit = DEFAULT_BATCH;
  // dry_run: report what is due now and each domain's cap, send nothing.
  let dryRun = false;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.batch === 'number') batchLimit = Math.min(body.batch, 1000);
    dryRun = body?.dry_run === true;
  } catch { /* no body */ }

  try {
    // ── Senders ──────────────────────────────────────────────────────────────
    // 'paused' is included deliberately. The hourly health job in email-warmup-tick
    // auto-pauses mailboxes on elevated bounce rates — which is precisely the
    // population that needs warming. Excluding them would mean a mailbox can never
    // warm its way back out of the state that paused it, and it would fail silently
    // (the mailbox just stops appearing in the mesh). Warmup mail only ever goes to
    // mailboxes we own, so it cannot bounce and cannot worsen the rate that paused it.
    // 'disconnected' and 'burned' stay out: no working transport / written off.
    const senders = await fetchAllPages<WarmupMailbox>(supabase, (from, to) =>
      supabase
        .from('email_mailboxes')
        .select(MAILBOX_COLS)
        .eq('warmup_enabled', true)
        .in('status', ['ready', 'warming', 'paused'])
        .order('id', { ascending: true })
        .range(from, to),
    );

    // Paused is included on purpose (a resting domain keeps warming), but not a
    // mailbox whose TENANT cannot send at all — every attempt just fails and
    // counts against the mesh.
    const observations = new Map<string, WarmupSchedulerObservation>(senders.map((s) => [s.id, { mailbox_id: s.id, reason: 'ineligible', had_opportunity: false }]));
    const CANNOT_SEND_REASONS = new Set(['tenant_outbound_blocked', 'tenant_mail_send_missing']);
    for (let i = senders.length - 1; i >= 0; i--) {
      const reason = (senders[i].metadata as Record<string, unknown> | null)?.paused_reason;
      const probe = (senders[i].metadata as Record<string, unknown> | null)?.capability_probe as Record<string, unknown> | undefined;
      if (
        probe?.mail_send === false ||
        (senders[i].status === 'paused' && typeof reason === 'string' && CANNOT_SEND_REASONS.has(reason))
      ) {
        senders.splice(i, 1);
      }
    }

    if (senders.length === 0) {
      if (!dryRun) await recordWarmupSchedulerDay(supabase, [...observations.values()]);
      return json({ success: true, sent: 0, note: 'no capable mailboxes have warmup_enabled' });
    }

    // Org timezones for the weekdays-only check (mirrors email-warmup-tick).
    const orgIds = [...new Set(senders.map((m) => m.organization_id))];
    const tzByOrg = new Map<string, string>();
    for (let i = 0; i < orgIds.length; i += 200) {
      const { data, error: timezoneErr } = await supabase
        .from('organization_channel_limits')
        .select('organization_id, timezone')
        .in('organization_id', orgIds.slice(i, i + 200));
      if (timezoneErr) throw new Error(`Warmup timezone lookup failed: ${timezoneErr.message}`);
      for (const s of data || []) tzByOrg.set(s.organization_id, s.timezone || 'UTC');
    }

    // Tenant GUIDs for the Graph path, resolved once instead of per send.
    const tenants = await fetchAllPages<{ organization_id: string; admin_email: string; tenant_id: string }>(
      supabase,
      (from, to) =>
        supabase
          .from('m365_tenants')
          .select('organization_id, admin_email, tenant_id')
          .order('tenant_id', { ascending: true })
          .range(from, to),
    );
    const tenantByOrgAdmin = new Map(
      tenants.map((t) => [`${t.organization_id}:${t.admin_email}`, t.tenant_id]),
    );

    // ── Remaining quota ──────────────────────────────────────────────────────
    // Domain time slots are assigned to the longest-waiting capable mailboxes.
    // A mailbox's own random send time can no longer let newer mailboxes consume
    // its turn. Reply activity updates last-send and participates in rotation.
    const eligible = senders
      .filter((s) =>
        isWarmupSendDay(s.warmup_weekdays_only ?? true, tzByOrg.get(s.organization_id) || 'UTC'),
      )
      .sort(oldestWarmupFirst);

    const senderById = new Map(eligible.map((s) => [s.id, s]));

    // Senders whose DOMAIN has demonstrably stopped delivering (see
    // warmup_endpoint_health / refresh_warmup_endpoint_health): throttled to ONE
    // warmup mail a day. Not zero — a daily probe is what lets the hourly refresh
    // notice recovery; excluding them would make "dead" permanent. Before this,
    // automated-clients-acquisition.com sent ~91/day for six weeks after Microsoft
    // restricted its tenant, with zero Inbox placements since 4 Aug.
    const deadSenders = new Set(
      (await fetchAllPages<{ mailbox_id: string }>(supabase, (from, to) =>
        supabase
          .from('warmup_endpoint_health')
          .select('mailbox_id')
          .eq('dead_as_sender', true)
          .order('mailbox_id', { ascending: true })
          .range(from, to),
      )).map((r) => r.mailbox_id),
    );
    const now = new Date();
    const domainWarmupDay = new Map<string, number>();
    const budgetCaps = new Map<string, number>();
    const quotas = new Map<string, number>();
    for (const s of senders) observations.get(s.id)!.reason = 'off_day';
    for (const s of eligible) {
      const quota = Math.min(meshQuotaForDay(s), deadSenders.has(s.id) ? 1 : Infinity);
      quotas.set(s.id, quota);
      const key = warmupBudgetKey(s);
      if (s.sending_domain_id) {
        const day = Math.max(domainWarmupDay.get(s.sending_domain_id) ?? 0, s.warmup_day ?? 0);
        domainWarmupDay.set(s.sending_domain_id, day);
        budgetCaps.set(key, domainMeshCapFor(day));
      } else budgetCaps.set(key, quota);
    }

    // Pending ledger rows reserve volume too: both workers claim atomically in
    // Postgres before transport. Failed attempts release their capacity.
    const dayStart = `${now.toISOString().split('T')[0]}T00:00:00Z`;
    const todaySends = await fetchAllPages<WarmupLedgerUsage>(supabase, (from, to) =>
      supabase.from('email_warmup_sends')
        .select('from_mailbox_id, from_mailbox:email_mailboxes!from_mailbox_id(sending_domain_id)')
        .neq('status', 'failed')
        .or(`sent_at.gte.${dayStart},and(status.eq.pending,created_at.gte.${dayStart})`)
        .order('id', { ascending: true })
        .range(from, to),
    );
    const { mailboxUsed: sentToday, budgetUsed } = warmupUsageFromLedger(todaySends);
    const { remaining, budgets: domainRemaining } = allocateWarmupOpportunities(
      eligible, quotas, sentToday, budgetCaps, budgetUsed, now,
    );
    const domainsCapped = [...budgetCaps].filter(([key, cap]) => key.startsWith('domain:') && (budgetUsed.get(key) ?? 0) >= cap).length;
    for (const s of eligible) {
      const observation = observations.get(s.id)!;
      const key = warmupBudgetKey(s);
      const allocation = s.daily_limit ?? 30;
      if (s.daily_sent_reset_at === now.toISOString().split('T')[0] && (s.daily_sent ?? 0) >= allocation) observation.reason = 'campaign_capacity';
      else if ((sentToday.get(s.id) ?? 0) >= (quotas.get(s.id) ?? 0)) observation.reason = 'mailbox_capacity';
      else if ((budgetUsed.get(key) ?? 0) >= (budgetCaps.get(key) ?? 0)) observation.reason = 'domain_capacity';
      else if ((remaining.get(s.id) ?? 0) > 0) observation.reason = 'scheduled'; else observation.reason = 'waiting_for_domain_slot';
    }

    const dueNow = [...remaining.values()].reduce((a, n) => a + n, 0);
    console.log(
      `[Warmup Send] ${senders.length} enabled, ${eligible.length} eligible today, ${dueNow} send(s) due now, ${domainsCapped} domain(s) at mesh cap, ${deadSenders.size} dead sender(s) on daily probe, batch=${batchLimit}`,
    );

    if (dryRun) {
      const domains = [...domainWarmupDay.entries()].map(([id, day]) => ({
        sending_domain_id: id,
        domain_warmup_day: day,
        cap: domainMeshCapFor(day),
        sent_today: budgetUsed.get(`domain:${id}`) ?? 0,
        paced_remaining: domainRemaining.get(`domain:${id}`) ?? 0,
      }));
      return json({
        success: true,
        dry_run: true,
        enabled: senders.length,
        eligibleToday: eligible.length,
        dueNow,
        sendersDue: [...remaining.values()].filter((n) => n > 0).length,
        domainsAtMeshCap: domainsCapped,
        domains,
        observations: [...observations.values()],
      });
    }

    // ── Round-based send loop ────────────────────────────────────────────────
    // One partner per sender per round. Ledger rows are written as we go, so the
    // next round's cooldown filter already accounts for this round's pairings —
    // no client-side reservation bookkeeping to drift out of sync.
    let sent = 0;
    let failed = 0;
    const errors: Record<string, number> = {};
    let placementless = 0;
    const deferred: Record<string, number> = {};
    const claimQueue = createWarmupClaimQueue();

    while (sent + failed < batchLimit) {
      const hungry = [...remaining.entries()]
        .filter(([, n]) => n > 0)
        .slice(0, ROUND_SIZE)
        .map(([id]) => id);

      if (hungry.length === 0) break;

      const { data: pairs, error: pairErr } = await supabase.rpc('pick_warmup_partners', {
        p_sender_ids: hungry,
        p_cooldown_days: PAIR_COOLDOWN_DAYS,
        p_max_receives_per_day: MAX_WARMUP_RECEIVES_PER_DAY,
        p_seed_max_receives_per_day: SEED_MAX_RECEIVES_PER_DAY,
      });
      if (pairErr) throw new Error(`pick_warmup_partners failed: ${pairErr.message}`);
      const pairedSenders = new Set((pairs || []).map((p: { sender_id: string }) => p.sender_id));
      for (const id of hungry) if (!pairedSenders.has(id)) {
        observations.get(id)!.reason = 'no_partner';
        observations.get(id)!.had_opportunity = false;
      }
      if (!pairs || pairs.length === 0) {
        console.warn('[Warmup Send] No partners available — mesh exhausted for this round');
        break;
      }

      const partnerIds = [...new Set(pairs.map((p: { partner_id: string }) => p.partner_id))];
      const partnerById = new Map<string, WarmupMailbox>();
      for (let i = 0; i < partnerIds.length; i += 200) {
        const { data, error: partnerErr } = await supabase
          .from('email_mailboxes')
          .select(MAILBOX_COLS)
          .in('id', partnerIds.slice(i, i + 200));
        if (partnerErr) throw new Error(`Partner mailbox lookup failed: ${partnerErr.message}`);
        for (const m of (data || []) as WarmupMailbox[]) partnerById.set(m.id, m);
      }

      // Sends run through a bounded pool. A Graph send plus its two ledger writes
      // is ~0.75s, so 250 sequential sends is ~190s and would blow the edge
      // function's time budget — the tick would be killed mid-batch and quietly
      // deliver a fraction of its quota. Each sender appears at most once per
      // round, so parallel sends never contend over the same `remaining` entry.
      const senderPriority = new Map(hungry.map((id, i) => [id, i]));
      const round = (pairs as Array<{ sender_id: string; partner_id: string }>)
        .sort((a, b) => (senderPriority.get(a.sender_id) ?? Infinity) - (senderPriority.get(b.sender_id) ?? Infinity))
        .slice(0, Math.max(0, batchLimit - (sent + failed)));

      await mapWithConcurrency(round, SEND_CONCURRENCY, async (pair) => {
        const sender = senderById.get(pair.sender_id);
        const recipient = partnerById.get(pair.partner_id);
        if (!sender || !recipient) return;

        // Reserve domain budget BEFORE the first await: JS runs this
        // synchronously, so parallel dispatches can't double-spend the last
        // slot. Refunded below if the send fails.
        const domain = warmupBudgetKey(sender);
        if ((domainRemaining.get(domain) ?? 0) <= 0) {
          remaining.set(sender.id, 0);
          observations.get(sender.id)!.reason = 'waiting_for_domain_slot';
          observations.get(sender.id)!.had_opportunity = false;
          return;
        }
        domainRemaining.set(domain, (domainRemaining.get(domain) ?? 1) - 1);

        const outcome = await sendOne(supabase, sender, recipient, tenantByOrgAdmin, claimQueue);
        const observation = observations.get(sender.id)!;
        observation.had_opportunity = outcome.kind !== 'deferred';
        if (outcome.kind === 'sent') {
          sent++;
          observation.reason = 'sent';
          if (outcome.ledgerError) placementless++;
          remaining.set(sender.id, (remaining.get(sender.id) ?? 1) - 1);
        } else {
          remaining.set(sender.id, 0);
          if (outcome.kind === 'deferred') {
            observation.reason = outcome.reason;
            observation.had_opportunity = false;
            deferred[outcome.reason] = (deferred[outcome.reason] ?? 0) + 1;
            domainRemaining.set(domain, (domainRemaining.get(domain) ?? 0) + 1);
          } else {
            failed++;
            observation.reason = outcome.kind === 'ledger' ? 'ledger_error' : 'failed';
            if (outcome.kind === 'ledger') placementless++;
            else errors[outcome.reason] = (errors[outcome.reason] ?? 0) + 1;
            // A confirmed failed delivery releases the reservation. An uncertain
            // ledger/transport outcome retains it to prevent a second send.
            if (!outcome.reserved) domainRemaining.set(domain, (domainRemaining.get(domain) ?? 0) + 1);
          }
        }
      });
    }

    await recordWarmupSchedulerDay(supabase, [...observations.values()]);

    console.log(`[Warmup Send] Complete: ${sent} sent, ${failed} failed`);

    return json({
      success: true,
      enabled: senders.length,
      eligibleToday: eligible.length,
      domainsAtMeshCap: domainsCapped,
      sent,
      failed,
      ledgerErrors: placementless,
      errors,
      deferred,
    });
  } catch (error) {
    console.error('[Warmup Send] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Page through a PostgREST query until exhausted.
 *
 * Non-negotiable here: an unbounded select silently returns only the first 1000
 * rows, which is exactly how the first pilot lost 3 of its 6 mailboxes without
 * raising a single error.
 */
async function fetchAllPages<T>(
  _supabase: SupabaseClient,
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await page(offset, offset + PAGE - 1);
    if (error) throw new Error((error as { message?: string }).message || 'paged fetch failed');
    const rows = (data || []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * Run `fn` over `items` with at most `limit` in flight. Workers pull from a shared
 * cursor, so one slow mailbox cannot leave the other workers idle.
 */
async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      try {
        await fn(items[index]);
      } catch (e) {
        console.error('[Warmup Send] send threw:', e);
      }
    }
  });
  await Promise.all(workers);
}

type SendOutcome =
  | { kind: 'sent'; ledgerError?: boolean }
  | { kind: 'deferred'; reason: string }
  | { kind: 'failed' | 'ledger'; reason: string; reserved: boolean };

async function sendOne(
  supabase: SupabaseClient,
  sender: WarmupMailbox,
  recipient: WarmupMailbox,
  tenantByOrgAdmin: Map<string, string>,
  claimQueue: WarmupClaimQueue,
): Promise<SendOutcome> {
  const warmupRef = newWarmupRef();
  const senderName = sender.display_name || sender.email_address.split('@')[0];
  const msg = buildWarmupMessage(senderName, warmupRef);

  const { data: claims, error: claimErr } = await claimQueue(warmupBudgetKey(sender), () => supabase.rpc('claim_warmup_send', {
    p_from_mailbox_id: sender.id,
    p_to_mailbox_id: recipient.id,
    p_warmup_ref: warmupRef,
    p_subject: msg.subject,
  }));
  if (claimErr) {
    console.error('[Warmup Send] ledger claim failed:', claimErr.message);
    return { kind: 'ledger', reason: claimErr.message, reserved: true };
  }
  const claim = claims?.[0] as { send_id: string | null; deferred_reason: string | null } | undefined;
  if (!claim?.send_id) return { kind: 'deferred', reason: claim?.deferred_reason || 'ineligible' };

  let result: DeliverResult;
  try {
    result = await deliver(sender, recipient, msg, warmupRef, tenantByOrgAdmin);
  } catch (e) {
    // A transport exception can follow acceptance. Keep the pending reservation;
    // do not refund uncertain volume or blindly retry it.
    console.error('[Warmup Send] uncertain delivery:', e instanceof Error ? e.message : String(e));
    return { kind: 'ledger', reason: 'uncertain transport outcome', reserved: true };
  }
  const { error: writeErr } = await supabase.from('email_warmup_sends').update({
    status: result.success ? 'sent' : 'failed',
    transport: result.transport,
    message_id: result.messageId ?? null,
    error: result.success ? null : (result.error?.slice(0, 500) ?? 'unknown'),
    sent_at: new Date().toISOString(),
  }).eq('id', claim.send_id);
  if (writeErr) console.error('[Warmup Send] ledger settlement failed:', writeErr.message);
  if (result.success) return { kind: 'sent', ledgerError: !!writeErr };
  return { kind: 'failed', reason: (result.error || 'unknown').slice(0, 60), reserved: !!writeErr };
}

interface DeliverResult {
  success: boolean;
  transport: 'graph' | 'smtp';
  messageId?: string;
  error?: string;
}

/**
 * Route a warmup send. Graph for M365 (95% of the estate) because it needs no
 * per-mailbox password and is immune to the stored-credential drift and Basic-auth
 * blocks that break SMTP; SMTP for everything else.
 */
async function deliver(
  sender: WarmupMailbox,
  recipient: WarmupMailbox,
  msg: { subject: string; html: string; text: string },
  warmupRef: string,
  tenantByOrgAdmin: Map<string, string>,
): Promise<DeliverResult> {
  const meta = (sender.metadata || {}) as Record<string, unknown>;
  const adminEmail = meta.m365_admin_email as string | undefined;
  const senderUserId = (meta.m365_user_id as string | undefined) || sender.email_address;
  const tenantId = adminEmail
    ? tenantByOrgAdmin.get(`${sender.organization_id}:${adminEmail}`)
    : undefined;

  if (tenantId) {
    const graph = await sendEmailViaGraph({
      tenantId,
      senderUserId,
      toEmail: recipient.email_address,
      subject: msg.subject,
      html: msg.html,
      saveToSentItems: true,
      headers: { [WARMUP_HEADER]: warmupRef },
    });
    // Graph 202-Accepts with no Message-Id, so correlation falls to the receive
    // tick's sender+subject+window match (see findWarmupMessage).
    return graph.success
      ? { success: true, transport: 'graph' }
      : { success: false, transport: 'graph', error: graph.error };
  }

  try {
    const creds = await extractSMTPCredentials((sender.metadata || {}) as Record<string, unknown>);
    if (!creds) {
      return { success: false, transport: 'smtp', error: 'no usable SMTP credentials' };
    }
    const res = await sendEmailViaSMTP({
      credentials: creds,
      from_name: sender.display_name || sender.email_address.split('@')[0],
      from_email: sender.email_address,
      to_email: recipient.email_address,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: { [WARMUP_HEADER]: warmupRef },
    });
    return res.success
      ? { success: true, transport: 'smtp', messageId: res.message_id }
      : { success: false, transport: 'smtp', error: res.error };
  } catch (e) {
    return {
      success: false,
      transport: 'smtp',
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
