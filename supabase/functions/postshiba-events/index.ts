/**
 * postshiba-events
 *
 * PostShiba delivery events for one connection. PostShiba POSTs a SendGrid-style
 * event array to postshiba-events/<postshiba_connections.webhook_token>, signed
 * with that connection's endpoint secret (X-Capsule-Signature, see
 * _shared/postshiba-webhook.ts). The endpoint is registered per connection,
 * scoped to its tenant, by postshiba-connect.
 *
 * Each event is matched to its send (unique_args.send_log_id, else the
 * Message-ID in smtp-id) and applied with the same rules the worker uses for
 * NDRs (imap-poller classifyNdr):
 *   processed    ignored
 *   delivered    sent -> delivered
 *   deferred     error_message only
 *   bounce       classifyDeliveryFailure: hard bounce -> bounced/hard_bounce (the
 *                trg_suppress_contact_on_hard_bounce trigger suppresses the
 *                contact), enrollment bounced, lead email_status bounced;
 *                reputation/tenant block -> blocked; content -> spam; else failed.
 *                A block never touches the lead.
 *   dropped      failed; a suppression drop mirrors it (bounce/complaint/unsubscribe)
 *   spamreport   spam/spam_complaint, contact do_not_contact, enrollments stopped
 *   unsubscribe  contact unsubscribed, enrollments stopped
 *
 * Events are recorded in postshiba_events before they're applied, so retries
 * never apply one twice; a failed event's row is removed so the retry applies it.
 * verify_jwt is off: PostShiba can't send a Supabase JWT; the signature is the auth.
 * Plan: tasks/postshiba-integration-2026-10-22.md (Phase 4).
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptValue } from '../_shared/encryption.ts';
import { verifyCapsuleSignature } from '../_shared/postshiba-webhook.ts';
import { classifyDeliveryFailure } from '../_shared/m365-trace.ts';
import { applyUnsubscribe } from '../_shared/unsubscribe.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A delivery event never overwrites a reply or an engagement signal.
const DELIVERY_PENDING = ['queued', 'pending', 'sending', 'sent'];
// A failure overwrites anything short of a reply.
const FAILURE_OVERWRITABLE = ['queued', 'pending', 'sending', 'sent', 'delivered', 'opened', 'clicked', 'failed'];

function respond(status: number, message?: string) {
  return new Response(message ?? null, { status, headers: message ? { 'Content-Type': 'text/plain' } : undefined });
}

// deno-lint-ignore no-explicit-any
type PostShibaEvent = Record<string, any>;

interface SendLog {
  id: string;
  organization_id: string;
  lead_id: string | null;
  sequence_id: string | null;
  recipient_email: string | null;
  status: string;
}

const SEND_LOG_COLUMNS = 'id, organization_id, lead_id, sequence_id, recipient_email, status';

async function findSendLog(supabase: SupabaseClient, organizationId: string, event: PostShibaEvent): Promise<SendLog | null> {
  const id = String(event.unique_args?.send_log_id ?? event.send_log_id ?? '');
  if (UUID_RE.test(id)) {
    const { data } = await supabase.from('email_send_log').select(SEND_LOG_COLUMNS).eq('id', id).eq('organization_id', organizationId).maybeSingle();
    if (data) return data as SendLog;
  }
  const smtpId = typeof event['smtp-id'] === 'string' ? event['smtp-id'].trim() : '';
  if (smtpId) {
    const bare = smtpId.replace(/^<|>$/g, '');
    const { data } = await supabase
      .from('email_send_log')
      .select(SEND_LOG_COLUMNS)
      .eq('organization_id', organizationId)
      .in('email_message_id', [bare, `<${bare}>`])
      .limit(1)
      .maybeSingle();
    if (data) return data as SendLog;
  }
  return null;
}

/** Suppress the contact for an address when there's no lead to cascade from (e.g. an inbox reply). */
async function suppressContactByEmail(
  supabase: SupabaseClient,
  organizationId: string,
  email: string,
  status: 'unsubscribed' | 'do_not_contact',
) {
  const { data, error } = await supabase.rpc('crm_contact_ids_by_email', { p_organization_id: organizationId, p_email: email });
  if (error) throw new Error(`Contact lookup failed: ${error.message}`);
  const ids = ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  if (ids.length === 0) return;
  const q = supabase.from('crm_contacts').update({ status, updated_at: new Date().toISOString() }).in('id', ids);
  await (status === 'unsubscribed' ? q.neq('status', 'do_not_contact') : q);
}

async function suppress(
  supabase: SupabaseClient,
  organizationId: string,
  sendLog: SendLog | null,
  email: string,
  status: 'unsubscribed' | 'do_not_contact',
) {
  if (sendLog?.lead_id) {
    await applyUnsubscribe(supabase, {
      organizationId,
      leadId: sendLog.lead_id,
      sendLogId: sendLog.id,
      contactStatus: status,
    });
  } else if (email) {
    await suppressContactByEmail(supabase, organizationId, email, status);
  }
}

async function applyFailure(
  supabase: SupabaseClient,
  sendLog: SendLog,
  detail: string,
  override?: { status: string; category: string },
): Promise<string> {
  const classification = classifyDeliveryFailure(detail);
  const hard = !override && classification.category === 'hard_bounce';
  const status = override?.status ??
    (hard ? 'bounced' : classification.isReputationBlock || classification.isTenantBlock ? 'blocked' : classification.category === 'content_block' ? 'spam' : 'failed');
  const category = override?.category ?? classification.category;

  await supabase
    .from('email_send_log')
    .update({
      status,
      error_category: category,
      error_message: (classification.diagnostic || detail || 'No diagnostic from PostShiba').slice(0, 2000),
      ...(hard ? { bounced_at: new Date().toISOString() } : {}),
    })
    .eq('id', sendLog.id)
    .in('status', FAILURE_OVERWRITABLE);

  if (hard) {
    if (sendLog.sequence_id && sendLog.lead_id) {
      await supabase
        .from('email_sequence_enrollments')
        .update({ status: 'bounced', updated_at: new Date().toISOString() })
        .eq('sequence_id', sendLog.sequence_id)
        .eq('lead_id', sendLog.lead_id)
        .eq('status', 'active');
    }
    if (sendLog.lead_id) {
      await supabase.from('leads').update({ email_status: 'bounced' }).eq('id', sendLog.lead_id);
    }
  }
  return `${status}/${category}`;
}

async function applyEvent(supabase: SupabaseClient, organizationId: string, event: PostShibaEvent, sendLog: SendLog | null): Promise<string> {
  const email = typeof event.email === 'string' ? event.email.trim().toLowerCase() : '';
  const detail = String(event.reason || event.response || event.status || '');

  switch (event.event) {
    case 'processed':
      return 'ignored';

    case 'delivered':
      if (!sendLog) return 'no_send_log';
      await supabase.from('email_send_log').update({ status: 'delivered' }).eq('id', sendLog.id).in('status', DELIVERY_PENDING);
      return 'delivered';

    case 'deferred':
      if (!sendLog) return 'no_send_log';
      await supabase.from('email_send_log').update({ error_message: `Deferred: ${detail}`.slice(0, 2000) }).eq('id', sendLog.id).in('status', DELIVERY_PENDING.concat('delivered'));
      return 'deferred';

    case 'bounce':
      if (!sendLog) return 'no_send_log';
      return await applyFailure(supabase, sendLog, detail);

    case 'dropped': {
      // PostShiba drops a send it won't attempt, usually because the address is on
      // the tenant's suppression list. Mirror why it's suppressed.
      if (/spam|complain/i.test(detail)) {
        await suppress(supabase, organizationId, sendLog, email, 'do_not_contact');
        if (sendLog) await applyFailure(supabase, sendLog, detail, { status: 'failed', category: 'suppressed_complaint' });
        return 'dropped/complaint';
      }
      if (/unsubscrib/i.test(detail)) {
        await suppress(supabase, organizationId, sendLog, email, 'unsubscribed');
        if (sendLog) await applyFailure(supabase, sendLog, detail, { status: 'failed', category: 'suppressed_unsubscribe' });
        return 'dropped/unsubscribe';
      }
      if (/bounce/i.test(detail)) {
        if (!sendLog) return 'no_send_log';
        return 'dropped/' + await applyFailure(supabase, sendLog, detail, { status: 'bounced', category: 'hard_bounce' });
      }
      if (!sendLog) return 'no_send_log';
      return 'dropped/' + await applyFailure(supabase, sendLog, detail, { status: 'failed', category: 'dropped' });
    }

    case 'spamreport':
      await suppress(supabase, organizationId, sendLog, email, 'do_not_contact');
      if (sendLog) {
        await supabase
          .from('email_send_log')
          .update({ status: 'spam', error_category: 'spam_complaint', error_message: 'Recipient marked the email as spam' })
          .eq('id', sendLog.id)
          .neq('status', 'replied');
      }
      return 'complaint';

    case 'unsubscribe':
      await suppress(supabase, organizationId, sendLog, email, 'unsubscribed');
      return 'unsubscribed';

    default:
      return 'unknown_event';
  }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return respond(405);

  const token = new URL(req.url).pathname.split('/').filter(Boolean).pop() ?? '';
  if (!/^[0-9a-f]{32,128}$/i.test(token)) return respond(404);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: connection } = await supabase
      .from('postshiba_connections')
      .select('id, organization_id, tenant_id, tenant_slug, events_webhook_secret_encrypted')
      .eq('webhook_token', token)
      .maybeSingle();
    if (!connection?.events_webhook_secret_encrypted) return respond(404);

    const rawBody = await req.text();
    const secret = await decryptValue(connection.events_webhook_secret_encrypted);
    const valid = await verifyCapsuleSignature(rawBody, req.headers.get('X-Capsule-Timestamp'), req.headers.get('X-Capsule-Signature'), secret);
    if (!valid) return respond(401, 'invalid signature');

    let events: PostShibaEvent[];
    try {
      const parsed = JSON.parse(rawBody);
      events = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return respond(400, 'invalid json');
    }

    let failed = 0;
    const counts: Record<string, number> = {};
    for (const event of events) {
      const eventId = typeof event.sg_event_id === 'string' ? event.sg_event_id : '';
      if (!eventId || typeof event.event !== 'string') continue;
      // The endpoint is already scoped to the tenant; this is a backstop. Events
      // may name the tenant by its slug or its public id, so accept either.
      const tenant = event.tenant_id == null ? '' : String(event.tenant_id);
      if (tenant && tenant !== connection.tenant_slug && tenant !== connection.tenant_id) {
        console.warn(`[postshiba-events] ${eventId}: tenant ${tenant} is not this connection's (${connection.tenant_slug})`);
        continue;
      }

      const { data: claimed, error: claimErr } = await supabase
        .from('postshiba_events')
        .upsert(
          {
            sg_event_id: eventId,
            connection_id: connection.id,
            organization_id: connection.organization_id,
            event: event.event,
            email: typeof event.email === 'string' ? event.email.toLowerCase() : null,
            occurred_at: Number.isFinite(Number(event.timestamp)) ? new Date(Number(event.timestamp) * 1000).toISOString() : null,
            payload: event,
          },
          { onConflict: 'sg_event_id', ignoreDuplicates: true },
        )
        .select('sg_event_id');
      if (claimErr) throw new Error(`Failed to record event: ${claimErr.message}`);
      if (!claimed || claimed.length === 0) continue; // already applied

      try {
        const sendLog = await findSendLog(supabase, connection.organization_id, event);
        const outcome = await applyEvent(supabase, connection.organization_id, event, sendLog);
        await supabase.from('postshiba_events').update({ send_log_id: sendLog?.id ?? null, outcome }).eq('sg_event_id', eventId);
        counts[outcome] = (counts[outcome] ?? 0) + 1;
      } catch (err) {
        failed += 1;
        console.error(`[postshiba-events] ${eventId} (${event.event}) failed:`, err);
        // Let PostShiba's retry apply it.
        await supabase.from('postshiba_events').delete().eq('sg_event_id', eventId);
      }
    }

    if (Object.keys(counts).length > 0) console.log(`[postshiba-events] org ${connection.organization_id}:`, JSON.stringify(counts));
    return failed > 0 ? respond(500, `${failed} event(s) failed`) : respond(204);
  } catch (err) {
    console.error('[postshiba-events] unhandled:', err);
    return respond(500);
  }
});
