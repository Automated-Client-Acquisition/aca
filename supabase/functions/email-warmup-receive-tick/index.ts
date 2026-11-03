/**
 * Email Warmup Receive Tick
 *
 * The half of warmup that actually builds reputation.
 *
 * Sending mail between mailboxes proves nothing on its own — a message that
 * silently lands in Junk is worse than not sending it. This tick:
 *
 *   1. Locates each warmup send inside the RECIPIENT mailbox and records whether
 *      it landed in the Inbox or in Junk. That per-domain inbox-placement rate is
 *      the only honest measure of sending reputation.
 *   2. Moves anything in Junk to the Inbox and marks it read — the "not spam"
 *      signal that teaches the receiving provider the sending domain is wanted.
 *   3. Replies to a share of delivered mail, because sustained two-way engagement
 *      is what providers actually score.
 *
 * Only step 1 promotes a send to status='delivered', and only 'delivered' sends
 * advance warmup_day. If verification breaks, the ramp stalls instead of
 * pretending progress — that is deliberate.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { sendEmailViaSMTP, extractSMTPCredentials } from '../_shared/smtp-client.ts';
import { locateAndRescueWarmup } from '../_shared/imap-client.ts';
import {
  findWarmupMessage,
  moveMessageToInbox,
  markMessageRead,
  sendEmailViaGraph,
} from '../_shared/m365-client.ts';
import {
  buildWarmupReply,
  newWarmupRef,
  replyQuotaForDay,
  isWarmupSeed,
  seedReplyDelayMs,
  warmupCountsFor,
  WARMUP_HEADER,
  type WarmupMailbox,
} from '../_shared/warmup-engine.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** Give the message time to actually arrive before hunting for it. */
const DELIVERY_GRACE_MS = 3 * 60_000;
/** After this long with no sighting, call it missing and stop retrying. */
const GIVE_UP_MS = 24 * 60 * 60_000;
const MAX_PLACEMENT_ATTEMPTS = 6;
/** A single placement lookup may never hold the worker longer than this. */
const PLACEMENT_LOOKUP_TIMEOUT_MS = 20_000;
/** Only reply to recent mail — a real inbox doesn't answer week-old messages. */
const REPLY_WINDOW_MS = 36 * 60 * 60_000;

const DEFAULT_PLACEMENT_BATCH = 400;
const DEFAULT_REPLY_BATCH = 80;
/** Reserve some receive capacity for Junk messages whose first rescue failed. */
const RESCUE_BATCH_SHARE = 0.25;
/** Parallel placement checks. Small enough to stay under per-tenant Graph throttling. */
const PLACEMENT_CONCURRENCY = 8;

const MAILBOX_COLS = `
  id, organization_id, email_address, display_name, provider, status,
  sending_domain_id, warmup_day, warmup_max_daily, warmup_reply_rate_target,
  warmup_daily_reply_target, warmup_weekdays_only, warmup_randomize,
  warmup_randomize_range, warmup_tag, metadata,
  daily_limit, daily_sent, daily_sent_reset_at, tags
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

  let placementBatch = DEFAULT_PLACEMENT_BATCH;
  let replyBatch = DEFAULT_REPLY_BATCH;
  try {
    const body = await req.json().catch(() => ({}));
    if (typeof body?.placementBatch === 'number') placementBatch = Math.min(body.placementBatch, 500);
    if (typeof body?.replyBatch === 'number') replyBatch = Math.min(body.replyBatch, 500);
  } catch { /* no body */ }

  try {
    const now = Date.now();

    const { data: tenants, error: tenantErr } = await supabase
      .from('m365_tenants')
      .select('organization_id, admin_email, tenant_id');
    if (tenantErr) throw new Error(`Warmup tenant lookup failed: ${tenantErr.message}`);
    const tenantByOrgAdmin = new Map(
      (tenants || []).map((t) => [`${t.organization_id}:${t.admin_email}`, t.tenant_id]),
    );

    // ══ Phase 1: placement + rescue ════════════════════════════════════════
    // A message can be successfully located in Junk while the follow-up move
    // fails (Graph throttling and transient IMAP errors are both common). Those
    // rows used to be marked delivered and then dropped from this queue forever.
    // Reserve bounded capacity to retry them, without letting an old rescue
    // backlog starve fresh placement checks.
    const rescueBatch = Math.max(1, Math.floor(placementBatch * RESCUE_BATCH_SHARE));
    const { data: rescuePending } = await supabase
      .from('email_warmup_sends')
      .select('id, from_mailbox_id, to_mailbox_id, subject, sent_at, placement_attempts, rescue_attempts')
      .eq('status', 'delivered')
      .eq('placement', 'junk')
      .is('rescued_at', null)
      .order('placement_checked_at', { ascending: true })
      .limit(rescueBatch);

    const { data: pending } = await supabase
      .from('email_warmup_sends')
      .select('id, from_mailbox_id, to_mailbox_id, subject, sent_at, placement_attempts, rescue_attempts')
      .eq('status', 'sent')
      .is('placement_checked_at', null)
      .lte('sent_at', new Date(now - DELIVERY_GRACE_MS).toISOString())
      .order('sent_at', { ascending: true })
      .limit(placementBatch - rescueBatch);

    const placementWork = [
      ...(rescuePending || []).map((send) => ({ ...send, needsRescue: true })),
      ...(pending || []).map((send) => ({ ...send, needsRescue: false })),
    ];

    const mailboxIds = new Set<string>();
    for (const s of placementWork) {
      mailboxIds.add(s.from_mailbox_id);
      mailboxIds.add(s.to_mailbox_id);
    }

    const mailboxById = await loadMailboxes(supabase, [...mailboxIds]);

    let checked = 0, inbox = 0, junk = 0, rescued = 0, missing = 0, deferred = 0;

    // Placement checks are network-bound (a Graph read is ~300-500ms, IMAP more),
    // so run them through a bounded pool. Sequentially, a 120-item batch takes ~60s
    // and the engine falls behind the ~2k/hour the estate needs at full ramp —
    // silently, which is the failure mode this whole project exists to eliminate.
    // The pool stays small so we do not trip per-tenant Graph throttling.
    await mapWithConcurrency(placementWork, PLACEMENT_CONCURRENCY, async (send) => {
      const sender = mailboxById.get(send.from_mailbox_id);
      const recipient = mailboxById.get(send.to_mailbox_id);
      if (!sender || !recipient) return;

      const sentAt = new Date(send.sent_at);

      // ── Resolve without a network call where the answer is already known ──
      // Everything below used to be decided only AFTER locatePlacement returned.
      // Three sends to archived ZapMail/Google recipients (1, 2 and 8 Sep) made the
      // IMAP lookup hang until the worker was killed, so the row was never updated
      // and — being oldest-first — was picked first again on every tick. From
      // 1 Sep every run 503'd in this phase and never reached Phase 2, which is
      // half of why warmup sent zero replies. Settle these rows up front instead.
      if (!send.needsRescue) {
        const inactiveRecipient = !['ready', 'warming', 'paused'].includes(recipient.status);
        const tooOld = now - sentAt.getTime() > GIVE_UP_MS;
        if (inactiveRecipient || tooOld) {
          await supabase
            .from('email_warmup_sends')
            .update({
              placement: 'missing',
              placement_attempts: (send.placement_attempts ?? 0) + 1,
              placement_checked_at: new Date().toISOString(),
              error: inactiveRecipient
                ? `recipient mailbox is ${recipient.status}; placement not checked`
                : 'gave up: older than the placement window, not checked again',
            })
            .eq('id', send.id);
          missing++;
          checked++;
          return;
        }
      }

      // A lookup that hangs must not take the worker — and every other row in the
      // batch — down with it. Time it out and treat it as a failed attempt, which
      // the retry/give-up logic below already knows how to count.
      const result = await withTimeout(
        locatePlacement(supabase, sender, recipient, send.subject, sentAt, tenantByOrgAdmin),
        PLACEMENT_LOOKUP_TIMEOUT_MS,
      ).catch((err) => ({
        placement: 'missing' as const,
        rescued: false,
        error: `placement lookup failed: ${err instanceof Error ? err.message : String(err)}`,
      }));

      if (send.needsRescue) {
        const rescueAttempts = (send.rescue_attempts ?? 0) + 1;
        const update = {
          rescue_attempts: rescueAttempts,
          last_rescue_attempt_at: new Date().toISOString(),
          // Keep `placement='junk'` as the original placement evidence even if
          // a human moved it before this retry. `rescued_at` records resolution.
          rescued_at: result.placement === 'inbox' || result.rescued
            ? new Date().toISOString()
            : null,
          error: result.placement === 'missing'
            ? result.error?.slice(0, 500) ?? 'not found while retrying Junk rescue'
            : result.error?.slice(0, 500) ?? null,
        };
        await supabase.from('email_warmup_sends').update(update).eq('id', send.id);

        checked++;
        junk++;
        if (update.rescued_at) rescued++;
        return;
      }

      const aged = now - sentAt.getTime() > GIVE_UP_MS;
      const attempts = (send.placement_attempts ?? 0) + 1;

      if (result.placement === 'missing') {
        // Not there yet is not the same as never arriving. Keep retrying until
        // the message is either found or old enough that it never will be.
        if (!aged && attempts < MAX_PLACEMENT_ATTEMPTS) {
          await supabase
            .from('email_warmup_sends')
            .update({ placement_attempts: attempts, error: result.error?.slice(0, 500) ?? null })
            .eq('id', send.id);
          deferred++;
          return;
        }
        await supabase
          .from('email_warmup_sends')
          .update({
            placement: 'missing',
            placement_attempts: attempts,
            placement_checked_at: new Date().toISOString(),
            error: result.error?.slice(0, 500) ?? 'not found in recipient mailbox',
          })
          .eq('id', send.id);
        missing++;
        checked++;
        return;
      }

      // Found it: this is a real, verified delivery. Only now does the send count
      // toward warmup_day (via trg_warmup_send_rollup).
      await supabase
        .from('email_warmup_sends')
        .update({
          status: 'delivered',
          placement: result.placement,
          placement_attempts: attempts,
          placement_checked_at: new Date().toISOString(),
          rescued_at: result.rescued ? new Date().toISOString() : null,
          error: null,
        })
        .eq('id', send.id);

      checked++;
      if (result.placement === 'inbox') inbox++;
      else {
        junk++;
        if (result.rescued) rescued++;
      }
    });

    console.log(
      `[Warmup Receive] placement: ${checked} checked (${inbox} inbox, ${junk} junk, ${rescued} rescued, ${missing} missing, ${deferred} deferred)`,
    );

    // ══ Phase 2: replies ═══════════════════════════════════════════════════
    // Engagement, not volume, is what moves reputation. Reply to a share of what
    // was delivered, honouring each mailbox's configured rate and daily cap.
    // NEWEST first, within a recent window. This used to take the OLDEST
    // unreplied deliveries with no window, and stalled replies completely from
    // 31 Aug: the head of that queue was 80,000+ sends from the 3 Aug oversend,
    // whose repliers received nothing today, so replyQuotaForDay gave each a
    // quota of 0 and every candidate was skipped — and the same unreachable
    // head came back first on every tick, so today's mail was never reached.
    // Replying to week-old warmup mail is also not what a real inbox does.
    const replyWindowStart = new Date(Date.now() - REPLY_WINDOW_MS).toISOString();
    const { data: replyCandidates, error: replyCandidatesErr } = await supabase
      .from('email_warmup_sends')
      .select('id, from_mailbox_id, to_mailbox_id, subject, sent_at')
      .eq('status', 'delivered')
      .is('replied_at', null)
      .eq('is_reply', false)
      .gte('sent_at', replyWindowStart)
      .order('sent_at', { ascending: false })
      .limit(replyBatch * 3);

    if (replyCandidatesErr) throw new Error(`Warmup reply lookup failed: ${replyCandidatesErr.message}`);
    const replyIds = new Set<string>();
    for (const c of replyCandidates || []) {
      replyIds.add(c.from_mailbox_id);
      replyIds.add(c.to_mailbox_id);
    }
    const replyMailboxes = await loadMailboxes(supabase, [...replyIds]);

    // Daily counters, scoped to the mailboxes in play and chunked below PostgREST's
    // 1000-row cap. Read unscoped this RPC silently truncated once the estate grew
    // past 1,000 active mailboxes, so mailboxes past the cut read as having replied
    // 0 times today and blew straight through their reply cap — the reply-side twin
    // of the send runaway (see warmupCountsFor).
    const replySentToday = await warmupCountsFor(supabase, [...replyIds], 'replies_today');
    const deliveredToMailboxToday = await warmupCountsFor(supabase, [...replyIds], 'delivered_in');

    let replied = 0, replyFailed = 0;
    const replyDeferred: Record<string, number> = {};

    for (const cand of replyCandidates || []) {
      if (replied >= replyBatch) break;

      // The replier is the ORIGINAL RECIPIENT — they are answering the sender.
      const replier = replyMailboxes.get(cand.to_mailbox_id);
      const target = replyMailboxes.get(cand.from_mailbox_id);
      if (!replier || !target) continue;
      if (isWarmupSeed(replier) && Date.now() - new Date(cand.sent_at).getTime() < seedReplyDelayMs(cand.id)) continue;
      // A replier whose tenant cannot send would only produce "Access is denied".
      const replierReason = (replier.metadata as Record<string, unknown> | null)?.paused_reason;
      const replierProbe = (replier.metadata as Record<string, unknown> | null)?.capability_probe as Record<string, unknown> | undefined;
      if (
        replierReason === 'tenant_outbound_blocked' ||
        replierReason === 'tenant_mail_send_missing' ||
        replierProbe?.mail_send === false
      ) continue;

      const quota = replyQuotaForDay(
        replier,
        deliveredToMailboxToday.get(replier.id) ?? 0,
      );
      if ((replySentToday.get(replier.id) ?? 0) >= quota) continue;

      const replierName = replier.display_name || replier.email_address.split('@')[0];
      const warmupRef = newWarmupRef();
      const msg = buildWarmupReply(replierName, warmupRef, cand.subject);

      // The same atomic ledger gate protects originals and replies. Original
      // claims reserve this pending conversation's capacity before new traffic.
      const { data: claims, error: claimErr } = await supabase.rpc('claim_warmup_send', {
        p_from_mailbox_id: replier.id,
        p_to_mailbox_id: target.id,
        p_warmup_ref: warmupRef,
        p_subject: msg.subject,
        p_parent_send_id: cand.id,
      });
      if (claimErr) throw new Error(`Reply ledger claim failed: ${claimErr.message}`);
      const claim = claims?.[0] as { send_id: string | null; deferred_reason: string | null } | undefined;
      if (!claim?.send_id) {
        const reason = claim?.deferred_reason || 'ineligible';
        replyDeferred[reason] = (replyDeferred[reason] ?? 0) + 1;
        continue;
      }

      // On an uncertain transport exception, keep the pending reservation and
      // its parent claim. Retrying could send the same reply twice.
      const sendResult = await deliverReply(replier, target, msg, warmupRef, tenantByOrgAdmin);
      const { error: settleErr } = await supabase.from('email_warmup_sends').update({
        status: sendResult.success ? 'sent' : 'failed',
        transport: sendResult.transport,
        message_id: sendResult.messageId ?? null,
        error: sendResult.success ? null : (sendResult.error?.slice(0, 500) ?? 'unknown'),
        sent_at: new Date().toISOString(),
      }).eq('id', claim.send_id);
      if (settleErr) throw new Error(`Reply ledger settlement failed: ${settleErr.message}`);
      if (sendResult.success) {
        const { error: parentErr } = await supabase.from('email_warmup_sends')
          .update({ replied_at: new Date().toISOString() }).eq('id', cand.id);
        if (parentErr) throw new Error(`Reply parent settlement failed: ${parentErr.message}`);
        replySentToday.set(replier.id, (replySentToday.get(replier.id) ?? 0) + 1);
        replied++;
      } else replyFailed++;

    }

    console.log(`[Warmup Receive] replies: ${replied} sent, ${replyFailed} failed`);

    return json({
      success: true,
      placement: { checked, inbox, junk, rescued, missing, deferred },
      replies: { replied, failed: replyFailed, deferred: replyDeferred },
    });
  } catch (error) {
    console.error('[Warmup Receive] Error:', error);
    return json({ error: error instanceof Error ? error.message : 'Unknown error' }, 500);
  }
});

// ============================================================================
// Helpers
// ============================================================================

/**
 * Run `fn` over `items` with at most `limit` in flight.
 *
 * Workers pull from a shared cursor rather than being handed fixed slices, so one
 * slow mailbox (an IMAP connect that drags) cannot leave the other workers idle.
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
        console.error('[Warmup Receive] placement check threw:', e);
      }
    }
  });
  await Promise.all(workers);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function loadMailboxes(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, WarmupMailbox>> {
  const out = new Map<string, WarmupMailbox>();
  // Chunked: a large .in() list blows the PostgREST URL limit
  // (see project_list_email_enrollments_unchunked_in).
  const CHUNK = 200;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const { data } = await supabase
      .from('email_mailboxes')
      .select(MAILBOX_COLS)
      .in('id', ids.slice(i, i + CHUNK));
    for (const m of (data || []) as WarmupMailbox[]) out.set(m.id, m);
  }
  return out;
}

function graphTenantFor(
  mailbox: WarmupMailbox,
  tenantByOrgAdmin: Map<string, string>,
): { tenantId: string; userId: string } | null {
  const meta = (mailbox.metadata || {}) as Record<string, unknown>;
  const adminEmail = meta.m365_admin_email as string | undefined;
  if (!adminEmail) return null;
  const tenantId = tenantByOrgAdmin.get(`${mailbox.organization_id}:${adminEmail}`);
  if (!tenantId) return null;
  return {
    tenantId,
    userId: (meta.m365_user_id as string | undefined) || mailbox.email_address,
  };
}

/**
 * Find the message in the recipient mailbox and rescue it from Junk.
 *
 * Graph first (95% of the estate, no per-mailbox password), IMAP otherwise. Graph
 * also falls through to IMAP on error, because the most likely Graph failure here
 * is a tenant that consented Mail.Send but not Mail.ReadWrite — every mailbox has
 * IMAP credentials stored, so placement checking degrades rather than breaks.
 */
async function locatePlacement(
  supabase: SupabaseClient,
  sender: WarmupMailbox,
  recipient: WarmupMailbox,
  subject: string,
  sentAt: Date,
  tenantByOrgAdmin: Map<string, string>,
): Promise<{ placement: 'inbox' | 'junk' | 'missing'; rescued: boolean; error?: string }> {
  // Small backdate so clock skew between us and the provider cannot hide the message.
  const since = new Date(sentAt.getTime() - 5 * 60_000);

  const graph = graphTenantFor(recipient, tenantByOrgAdmin);
  if (graph) {
    const { found, error } = await findWarmupMessage(graph.tenantId, graph.userId, {
      fromAddress: sender.email_address,
      subject,
      since: since.toISOString(),
    });

    if (!error) {
      if (!found) return { placement: 'missing', rescued: false };

      await markMessageRead(graph.tenantId, graph.userId, found.id).catch(() => {});

      if (found.folder === 'inbox') return { placement: 'inbox', rescued: false };

      const move = await moveMessageToInbox(graph.tenantId, graph.userId, found.id);
      return { placement: 'junk', rescued: move.moved, error: move.error };
    }
    console.warn(`[Warmup Receive] Graph read failed for ${recipient.email_address}, falling back to IMAP: ${error}`);
  }

  const creds = await extractSMTPCredentials((recipient.metadata || {}) as Record<string, unknown>);
  if (!creds?.imap_host) {
    return { placement: 'missing', rescued: false, error: 'no Graph tenant and no IMAP credentials' };
  }

  return await locateAndRescueWarmup(
    {
      imap_host: creds.imap_host,
      imap_port: creds.imap_port || 993,
      imap_username: creds.imap_username || creds.smtp_username,
      imap_password: creds.imap_password || creds.smtp_password,
    },
    { fromAddress: sender.email_address, subject, since },
  );
}

interface SendOutcome {
  success: boolean;
  transport: 'graph' | 'smtp';
  messageId?: string;
  error?: string;
}

async function deliverReply(
  replier: WarmupMailbox,
  target: WarmupMailbox,
  msg: { subject: string; html: string; text: string },
  warmupRef: string,
  tenantByOrgAdmin: Map<string, string>,
): Promise<SendOutcome> {
  const graph = graphTenantFor(replier, tenantByOrgAdmin);
  if (graph) {
    const res = await sendEmailViaGraph({
      tenantId: graph.tenantId,
      senderUserId: graph.userId,
      toEmail: target.email_address,
      subject: msg.subject,
      html: msg.html,
      saveToSentItems: true,
      headers: { [WARMUP_HEADER]: warmupRef },
    });
    return res.success
      ? { success: true, transport: 'graph' }
      : { success: false, transport: 'graph', error: res.error };
  }

  try {
    const creds = await extractSMTPCredentials((replier.metadata || {}) as Record<string, unknown>);
    if (!creds) return { success: false, transport: 'smtp', error: 'no usable SMTP credentials' };

    const res = await sendEmailViaSMTP({
      credentials: creds,
      from_name: replier.display_name || replier.email_address.split('@')[0],
      from_email: replier.email_address,
      to_email: target.email_address,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      headers: { [WARMUP_HEADER]: warmupRef },
    });
    return res.success
      ? { success: true, transport: 'smtp', messageId: res.message_id }
      : { success: false, transport: 'smtp', error: res.error };
  } catch (e) {
    return { success: false, transport: 'smtp', error: e instanceof Error ? e.message : String(e) };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
