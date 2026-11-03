/**
 * Microsoft Graph Mail Subscription Lifecycle
 *
 * Creates/renews/cleans up the Graph `/subscriptions` push notifications that
 * back graph-mail-webhook — without one per mailbox, Graph has nothing to
 * notify and that mailbox stays on the poll-only reconciliation sweep
 * (aca-imap-poller keeps working regardless either way, this is additive).
 *
 * Three invocation shapes:
 *   1. `{ mailboxId }` — targeted single-mailbox create. Used for the initial
 *      pilot test; synchronous, returns the created subscription inline.
 *   2. `{ organizationId }` — fleet sync scoped to one org.
 *   3. `{ scope: "all" }` — fleet sync across every org's m365 mailboxes.
 *   For (2) and (3): for every m365 mailbox in scope, create a subscription
 *      if missing, renew if expiring within 24h, backfill metadata.graph_user_id
 *      if a healthy subscription predates that field, or skip. Also deletes
 *      subscriptions belonging to mailboxes that are no longer
 *      ready/active/warming (disconnected, paused, burned), so we don't leak
 *      Graph subscription quota on dead mailboxes. Runs in the background via
 *      EdgeRuntime.waitUntil() (a 1,000+ mailbox scope can take several
 *      minutes — Graph gets one POST per mailbox, there's no bulk-subscribe
 *      endpoint), writes progress to worker_heartbeats
 *      (worker='graph-subscription-sync') every 50 mailboxes so a run's
 *      status is inspectable without tailing logs, and responds 202
 *      immediately.
 *
 * Idempotent/resumable by design: re-running against the same scope only acts
 * on mailboxes that still need creating/renewing, so a run that gets cut off
 * (edge function background-execution limits — observed in practice: a run
 * reliably advances a few hundred mailboxes before being cut off, so a cron
 * ticking every few minutes is what actually completes a large scope) is
 * safe to just re-invoke.
 *
 * Auth: cron/admin-invoked, not a public webhook — gated by the same
 * x-internal-secret header aca-imap-poller's own internal endpoints use
 * (INTERNAL_WEBHOOK_SECRET), matching the in-function-auth pattern used by
 * pool-enrich-tick/pool-classify-tick rather than requiring a JWT.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getM365Token, resolveUserIdByEmail } from '../_shared/m365-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// Graph's documented max lifetime for Outlook mail-resource subscriptions is
// 4230 minutes (~2.94 days). Stay a little under it rather than exactly at
// it, to leave margin for clock skew between us and Graph.
const SUBSCRIPTION_MINUTES = 4200;
const RENEW_WITHIN_MS = 24 * 60 * 60 * 1000; // renew anything expiring within 24h
const PAGE_SIZE = 1000; // PostgREST max-rows — paginate explicitly, same reason as the poller's fetchAllPollableMailboxes
const BETWEEN_CALLS_MS = 150; // pace Graph calls across mailboxes/tenants

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

  const configuredSecret = Deno.env.get('INTERNAL_WEBHOOK_SECRET');
  if (!configuredSecret || req.headers.get('x-internal-secret') !== configuredSecret) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  let body: { mailboxId?: string; organizationId?: string; scope?: 'all' };
  try {
    body = await req.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  if (body.mailboxId) {
    try {
      const result = await createSubscriptionForMailbox(supabase, new Map(), body.mailboxId);
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    } catch (err) {
      console.error('[Graph Subscription Sync] Single-mailbox failed:', err);
      return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  }

  if (body.organizationId || body.scope === 'all') {
    const processingPromise = syncFleet(supabase, body.organizationId);
    try {
      (globalThis as any).EdgeRuntime?.waitUntil(processingPromise);
    } catch (_) {
      await processingPromise;
    }
    return new Response(JSON.stringify({ status: 'started', scope: body.organizationId || 'all' }), {
      status: 202,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ error: 'mailboxId, organizationId, or scope="all" is required' }), {
    status: 400,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});

type TokenCache = Map<string, string>;

async function getCachedToken(cache: TokenCache, tenantId: string): Promise<string> {
  const cached = cache.get(tenantId);
  if (cached) return cached;
  const token = await getM365Token(tenantId);
  cache.set(tenantId, token);
  return token;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveTenantId(supabase: SupabaseClient, sendingDomainId: string): Promise<string | null> {
  const { data: domain } = await supabase
    .from('email_sending_domains')
    .select('m365_tenant_id')
    .eq('id', sendingDomainId)
    .maybeSingle();
  if (!domain?.m365_tenant_id) return null;

  const { data: tenant } = await supabase
    .from('m365_tenants')
    .select('tenant_id')
    .eq('id', domain.m365_tenant_id)
    .maybeSingle();
  return tenant?.tenant_id || null;
}

async function createSubscriptionForMailbox(
  supabase: SupabaseClient,
  tokenCache: TokenCache,
  mailboxId: string,
) {
  const { data: mailbox, error: mailboxError } = await supabase
    .from('email_mailboxes')
    .select('id, email_address, connection_type, sending_domain_id')
    .eq('id', mailboxId)
    .maybeSingle();

  if (mailboxError || !mailbox) {
    throw new Error(`Mailbox not found: ${mailboxError?.message || mailboxId}`);
  }
  if (mailbox.connection_type !== 'm365') {
    throw new Error(`Mailbox ${mailbox.email_address} is connection_type=${mailbox.connection_type}, not m365`);
  }
  if (!mailbox.sending_domain_id) {
    throw new Error(`Mailbox ${mailbox.email_address} has no sending_domain_id`);
  }

  const tenantId = await resolveTenantId(supabase, mailbox.sending_domain_id);
  if (!tenantId) {
    throw new Error(`No tenant_id for mailbox ${mailbox.email_address}`);
  }

  const clientState = Deno.env.get('GRAPH_WEBHOOK_CLIENT_STATE');
  const notificationUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/graph-mail-webhook`;
  if (!clientState) {
    throw new Error('GRAPH_WEBHOOK_CLIENT_STATE is not configured');
  }

  const token = await getCachedToken(tokenCache, tenantId);
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();

  const graphRes = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      changeType: 'created',
      notificationUrl,
      resource: `/users/${mailbox.email_address}/mailFolders('inbox')/messages`,
      expirationDateTime,
      clientState,
    }),
    signal: AbortSignal.timeout(20_000),
  });

  const graphBody = await graphRes.json();
  if (!graphRes.ok) {
    throw new Error(`Graph subscription creation failed (${graphRes.status}): ${JSON.stringify(graphBody)}`);
  }

  // Graph accepts the email address in the resource path at subscription-
  // creation time, but change NOTIFICATIONS echo the resource canonicalized
  // to the user's immutable object ID (a GUID), not the UPN/email — confirmed
  // against a real notification during the pilot (graph-mail-webhook logged
  // "No mailbox found" for a GUID it couldn't match against email_address).
  // Resolve and store it now so graph-mail-webhook can match incoming
  // notifications correctly.
  let graphUserId: string | null = null;
  try {
    graphUserId = await resolveUserIdByEmail(token, mailbox.email_address);
  } catch (err) {
    console.warn(`[Graph Subscription Sync] Could not resolve Graph user id for ${mailbox.email_address}: ${err instanceof Error ? err.message : err}`);
  }

  await supabase.rpc('apply_mailbox_metadata_patch', {
    p_id: mailbox.id,
    p_set: {
      graph_subscription_id: graphBody.id,
      graph_subscription_expires_at: graphBody.expirationDateTime,
      ...(graphUserId ? { graph_user_id: graphUserId } : {}),
    },
  });

  return {
    mailboxId: mailbox.id,
    emailAddress: mailbox.email_address,
    subscriptionId: graphBody.id,
    expirationDateTime: graphBody.expirationDateTime,
    notificationUrl,
    resource: graphBody.resource,
  };
}

async function renewSubscription(
  supabase: SupabaseClient,
  tokenCache: TokenCache,
  tenantId: string,
  mailboxId: string,
  subscriptionId: string,
): Promise<void> {
  const token = await getCachedToken(tokenCache, tenantId);
  const expirationDateTime = new Date(Date.now() + SUBSCRIPTION_MINUTES * 60_000).toISOString();

  const graphRes = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expirationDateTime }),
    signal: AbortSignal.timeout(20_000),
  });

  if (!graphRes.ok) {
    const errBody = await graphRes.text();
    // 404 here means the subscription is gone on Graph's side (expired
    // already, or removed) — fall through to a fresh create rather than
    // erroring, since renewal and creation converge to the same end state.
    if (graphRes.status === 404) {
      throw Object.assign(new Error(`Subscription ${subscriptionId} not found on Graph, needs recreation`), { code: 'NOT_FOUND' });
    }
    throw new Error(`Graph subscription renewal failed (${graphRes.status}): ${errBody}`);
  }

  await supabase.rpc('apply_mailbox_metadata_patch', {
    p_id: mailboxId,
    p_set: { graph_subscription_expires_at: expirationDateTime },
  });
}

async function deleteSubscription(tokenCache: TokenCache, tenantId: string, subscriptionId: string): Promise<void> {
  const token = await getCachedToken(tokenCache, tenantId);
  const graphRes = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  // 404 = already gone on Graph's side — fine, that's the end state we want.
  if (!graphRes.ok && graphRes.status !== 404) {
    const errBody = await graphRes.text();
    throw new Error(`Graph subscription deletion failed (${graphRes.status}): ${errBody}`);
  }
}

interface FleetRow {
  id: string;
  email_address: string;
  organization_id: string;
  status: string;
  sending_domain_id: string | null;
  metadata: Record<string, unknown> | null;
}

// Some M365 mailbox rows get created without sending_domain_id (a real,
// previously-hit gap — see the identical fallback in
// workers/imap-poller/src/index.ts's pollGraphMailboxes, which those rows
// were "permanently skipped" by before that fix). Mirror the same repair
// here rather than silently skipping: infer the domain from the mailbox's
// own email address, look it up against email_sending_domains for this org,
// and persist the backfill so future runs don't have to infer it again.
async function inferAndBackfillSendingDomainId(
  supabase: SupabaseClient,
  mailboxId: string,
  emailAddress: string,
  organizationId: string,
): Promise<string | null> {
  const domainName = emailAddress.split('@')[1]?.toLowerCase();
  if (!domainName) return null;

  const { data: domain, error } = await supabase
    .from('email_sending_domains')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('domain', domainName)
    .maybeSingle();
  if (error || !domain?.id) return null;

  const { error: updateError } = await supabase
    .from('email_mailboxes')
    .update({ sending_domain_id: domain.id })
    .eq('id', mailboxId);
  if (updateError) {
    console.warn(`[Graph Subscription Sync] Failed to backfill sending_domain_id for ${emailAddress}: ${updateError.message}`);
    return null;
  }

  console.log(`[Graph Subscription Sync] Backfilled sending_domain_id for ${emailAddress}`);
  return domain.id;
}

// Filters the "needs attention" set at the SQL level rather than pulling the
// whole fleet and skipping in memory. At a few hundred mailboxes, skipping
// already-healthy rows in JS was fine; at ~2,000, re-scanning the entire
// fleet every 3-minute catch-up tick meant each run spent more and more of
// its execution-time budget just skipping past prior work, and less on new
// work — progress dropped from ~350/8min to ~20/8min as the "done" set grew.
// Filtering server-side means a run's row count scales with remaining work,
// not with total fleet size.
async function fetchActiveNeedingWork(
  supabase: SupabaseClient,
  organizationId: string | undefined,
  renewThresholdISO: string,
): Promise<FleetRow[]> {
  const all: FleetRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('email_mailboxes')
      .select('id, email_address, organization_id, status, sending_domain_id, metadata')
      .eq('connection_type', 'm365')
      .in('status', ['ready', 'active', 'warming'])
      .or(
        [
          'metadata->>graph_subscription_id.is.null',
          'metadata->>graph_user_id.is.null',
          'metadata->>graph_subscription_expires_at.is.null',
          `metadata->>graph_subscription_expires_at.lt.${renewThresholdISO}`,
        ].join(','),
      )
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (organizationId) query = query.eq('organization_id', organizationId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = data || [];
    all.push(...(page as FleetRow[]));
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function fetchInactiveWithSubscription(
  supabase: SupabaseClient,
  organizationId: string | undefined,
): Promise<FleetRow[]> {
  const all: FleetRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = supabase
      .from('email_mailboxes')
      .select('id, email_address, organization_id, status, sending_domain_id, metadata')
      .eq('connection_type', 'm365')
      .not('status', 'in', '(ready,active,warming)')
      .not('metadata->>graph_subscription_id', 'is', null)
      .order('created_at', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (organizationId) query = query.eq('organization_id', organizationId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);
    const page = data || [];
    all.push(...(page as FleetRow[]));
    if (page.length < PAGE_SIZE) break;
  }
  return all;
}

async function writeProgress(supabase: SupabaseClient, scopeLabel: string, summary: Record<string, unknown>) {
  const nowISO = new Date().toISOString();
  await supabase.from('worker_heartbeats').upsert({
    worker: 'graph-subscription-sync',
    last_run_at: nowISO,
    updated_at: nowISO,
    metrics: { scope: scopeLabel, ...summary, updatedAt: nowISO },
  }, { onConflict: 'worker' });
}

// organizationId omitted = whole fleet, across every org. Same logic either
// way — this just widens the row set the queries below pull.
async function syncFleet(supabase: SupabaseClient, organizationId?: string): Promise<void> {
  const scopeLabel = organizationId || 'all';
  const tokenCache: TokenCache = new Map();
  const renewThresholdISO = new Date(Date.now() + RENEW_WITHIN_MS).toISOString();
  const [active, inactiveWithSub] = await Promise.all([
    fetchActiveNeedingWork(supabase, organizationId, renewThresholdISO),
    fetchInactiveWithSubscription(supabase, organizationId),
  ]);

  console.log(`[Graph Subscription Sync] Scope ${scopeLabel}: ${active.length} active needing attention, ${inactiveWithSub.length} inactive-with-subscription to clean up`);

  let created = 0, renewed = 0, deleted = 0, skipped = 0;
  const errors: Array<{ mailbox: string; error: string }> = [];

  for (let i = 0; i < active.length; i++) {
    const row = active[i];
    try {
      if (!row.sending_domain_id) {
        row.sending_domain_id = await inferAndBackfillSendingDomainId(supabase, row.id, row.email_address, row.organization_id);
      }
      if (!row.sending_domain_id) {
        skipped++;
        continue;
      }
      const meta = (row.metadata || {}) as any;
      const subId = meta.graph_subscription_id as string | undefined;
      const expiresAt = meta.graph_subscription_expires_at as string | undefined;

      if (!subId) {
        await createSubscriptionForMailbox(supabase, tokenCache, row.id);
        created++;
      } else if (!expiresAt || new Date(expiresAt).getTime() - Date.now() < RENEW_WITHIN_MS) {
        const tenantId = await resolveTenantId(supabase, row.sending_domain_id);
        if (!tenantId) { skipped++; continue; }
        try {
          await renewSubscription(supabase, tokenCache, tenantId, row.id, subId);
          renewed++;
        } catch (renewErr) {
          if ((renewErr as any).code === 'NOT_FOUND') {
            await createSubscriptionForMailbox(supabase, tokenCache, row.id);
            created++;
          } else {
            throw renewErr;
          }
        }
      } else {
        // Healthy subscription. Backfill graph_user_id if this mailbox
        // predates that field being captured (e.g. subscriptions created
        // before the resource-identifier fix) — a single Graph GET, far
        // cheaper than recreating the subscription itself.
        if (!meta.graph_user_id) {
          const tenantId = await resolveTenantId(supabase, row.sending_domain_id);
          if (tenantId) {
            try {
              const token = await getCachedToken(tokenCache, tenantId);
              const graphUserId = await resolveUserIdByEmail(token, row.email_address);
              await supabase.rpc('apply_mailbox_metadata_patch', {
                p_id: row.id,
                p_set: { graph_user_id: graphUserId },
              });
            } catch (backfillErr) {
              console.warn(`[Graph Subscription Sync] graph_user_id backfill failed for ${row.email_address}: ${backfillErr instanceof Error ? backfillErr.message : backfillErr}`);
            }
          }
        }
        skipped++;
      }
    } catch (err) {
      errors.push({ mailbox: row.email_address, error: err instanceof Error ? err.message : String(err) });
    }

    if ((i + 1) % 50 === 0 || i === active.length - 1) {
      await writeProgress(supabase, scopeLabel, {
        phase: 'active', processed: i + 1, total: active.length, created, renewed, deleted, skipped, errorCount: errors.length,
      });
    }
    await sleep(BETWEEN_CALLS_MS);
  }

  for (let i = 0; i < inactiveWithSub.length; i++) {
    const row = inactiveWithSub[i];
    try {
      const meta = (row.metadata || {}) as any;
      const subId = meta.graph_subscription_id as string;
      if (!row.sending_domain_id) { skipped++; continue; }
      const tenantId = await resolveTenantId(supabase, row.sending_domain_id);
      if (tenantId) {
        await deleteSubscription(tokenCache, tenantId, subId);
      }
      await supabase.rpc('apply_mailbox_metadata_patch', {
        p_id: row.id,
        p_set: {},
        p_unset: ['graph_subscription_id', 'graph_subscription_expires_at'],
      });
      deleted++;
    } catch (err) {
      errors.push({ mailbox: row.email_address, error: err instanceof Error ? err.message : String(err) });
    }
    await sleep(BETWEEN_CALLS_MS);
  }

  console.log(`[Graph Subscription Sync] Scope ${scopeLabel} done: created=${created} renewed=${renewed} deleted=${deleted} skipped=${skipped} errors=${errors.length}`);
  await writeProgress(supabase, scopeLabel, {
    phase: 'done', total: active.length, created, renewed, deleted, skipped, errorCount: errors.length,
    errors: errors.slice(0, 20), // cap what we persist — this is a status summary, not a full log
  });
}
