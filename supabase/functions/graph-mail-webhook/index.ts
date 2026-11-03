/**
 * Microsoft Graph Mail Webhook Receiver
 *
 * Real-time front door for M365 inbound reply ingestion. Graph POSTs here the
 * instant a mailbox we've subscribed to gets new mail. This function does the
 * minimum needed to ack fast and forward the trigger — it does NOT fetch or
 * process the email itself. The actual delta-fetch + reply-processing pipeline
 * (thread matching, bounce/auto-reply detection, classification, autopilot)
 * lives in the aca-imap-poller Fly worker and stays there unchanged; this
 * function just tells it which mailbox to poll, right now, instead of waiting
 * for the next reconciliation sweep.
 *
 * Two request shapes to handle:
 *   1. Validation handshake — Graph POSTs `?validationToken=xxx` when a
 *      subscription is created (or its notificationUrl changes) and expects
 *      that token echoed back as text/plain within ~10s. Checked before any
 *      body parsing, since these calls may carry no JSON body.
 *   2. Change notification — `{ value: [{ subscriptionId, clientState,
 *      resource, ... }] }`. `clientState` is Graph's actual authenticity
 *      mechanism for this webhook (an opaque secret we set at subscription
 *      creation, echoed back on every notification) — not a body signature.
 *      Notification content is never trusted for anything beyond "which
 *      mailbox changed"; the real content is fetched via the existing,
 *      already-audited delta-poll path.
 *
 * Graph expects a 2xx within a few seconds per notification, or it backs off
 * and eventually disables the subscription — so processing (including the
 * forward to the Fly worker) happens in the background via
 * EdgeRuntime.waitUntil(), matching the existing unipile-webhook-handler
 * pattern for the same reason.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  resource?: string;
  changeType?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  // Validation handshake — checked first, before any JSON parsing.
  const url = new URL(req.url);
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken !== null) {
    console.log('[Graph Webhook] Validation handshake received');
    return new Response(validationToken, {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'text/plain' },
    });
  }

  let payload: { value?: GraphNotification[] };
  try {
    payload = await req.json();
  } catch (err) {
    console.error('[Graph Webhook] Failed to parse JSON body:', err);
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const notifications = payload.value || [];
  console.log(`[Graph Webhook] Received ${notifications.length} notification(s)`);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const processingPromise = processNotifications(supabase, notifications);
  try {
    (globalThis as any).EdgeRuntime?.waitUntil(processingPromise);
  } catch (_) {
    // waitUntil not available (dev/test) — fall back to awaiting inline.
    await processingPromise;
  }

  // Ack immediately regardless of how the forward-to-worker calls below go —
  // Graph only cares that we accepted the notification, not that downstream
  // processing finished.
  return new Response(null, { status: 202 });
});

async function processNotifications(
  supabase: SupabaseClient,
  notifications: GraphNotification[],
): Promise<void> {
  const clientStateSecret = Deno.env.get('GRAPH_WEBHOOK_CLIENT_STATE');
  const workerUrl = Deno.env.get('IMAP_POLLER_WEBHOOK_URL'); // e.g. https://aca-imap-poller.fly.dev/webhook-poll
  const internalSecret = Deno.env.get('INTERNAL_WEBHOOK_SECRET');

  if (!workerUrl || !internalSecret) {
    console.error('[Graph Webhook] IMAP_POLLER_WEBHOOK_URL / INTERNAL_WEBHOOK_SECRET not configured — dropping all notifications this call');
    return;
  }

  for (const note of notifications) {
    if (clientStateSecret && note.clientState !== clientStateSecret) {
      console.warn('[Graph Webhook] Dropping notification with mismatched clientState');
      continue;
    }

    const resource = String(note.resource || '');
    // Observed shape: "Users/{id-or-upn}/Messages/{messageId}". Which form
    // Graph uses for {id-or-upn} is NOT yet confirmed against a real
    // notification — confirmed against a real pilot notification that Graph
    // echoes the resource canonicalized to the user's immutable object ID (a
    // GUID), not the UPN/email used when creating the subscription. Match on
    // that first (infra-graph-subscription-sync stores it as
    // metadata.graph_user_id at creation/backfill time); fall back to
    // email_address only for the identifier's rare email-shaped form, so a
    // mailbox that hasn't been backfilled yet still has a path to match.
    const match = resource.match(/[Uu]sers\/([^/]+)\//);
    const userIdentifier = match ? decodeURIComponent(match[1]).toLowerCase() : null;
    if (!userIdentifier) {
      console.warn('[Graph Webhook] Could not extract user identifier from resource:', resource);
      continue;
    }

    let mailbox: { id: string; email_address: string } | null = null;
    if (userIdentifier.includes('@')) {
      const { data } = await supabase
        .from('email_mailboxes')
        .select('id, email_address')
        .eq('connection_type', 'm365')
        .eq('email_address', userIdentifier)
        .maybeSingle();
      mailbox = data;
    } else {
      const { data } = await supabase
        .from('email_mailboxes')
        .select('id, email_address')
        .eq('connection_type', 'm365')
        .eq('metadata->>graph_user_id', userIdentifier)
        .maybeSingle();
      mailbox = data;
    }

    if (!mailbox) {
      console.warn(`[Graph Webhook] No mailbox found for identifier: ${userIdentifier} (resource: ${resource})`);
      continue;
    }

    try {
      await fetch(workerUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-internal-secret': internalSecret },
        body: JSON.stringify({ mailboxId: mailbox.id }),
        signal: AbortSignal.timeout(10_000),
      });
      console.log(`[Graph Webhook] Poked worker for ${mailbox.email_address}`);
    } catch (err) {
      // Non-fatal — the reconciliation sweep on the worker will still pick
      // this mailbox up on its own (slower) cadence.
      console.error(`[Graph Webhook] Failed to poke worker for ${mailbox.email_address}:`, err);
    }
  }
}
