/**
 * postshiba-connect
 *
 * Connects an org to its own PostShiba team (BYOK). ACA's own orgs connect ACA's
 * team; customers connect theirs. Actions:
 *   - validate:   check the team id + API key and list the team's clusters and tenants
 *   - connect:    pick a cluster and a tenant (an existing one, or a new one by name);
 *                 create the tenant's SMTP credential on that cluster and store
 *                 everything encrypted. Switching tenant moves the org's PostShiba
 *                 domains into the new tenant; switching tenant or cluster re-keys
 *                 the org's PostShiba senders with the new credential.
 *   - status:     the org's connection, re-validated against PostShiba every 6h
 *   - disconnect: disable the SMTP credential and remove the connection
 *
 * ACA never creates clusters on a team (each one is a paid PostShiba plan, so the
 * UI links to PostShiba instead). A tenant serves one ACA org: one already used by
 * another org's connection is refused, since suppressions and events are per tenant. Each
 * connection gets one delivery-events webhook (postshiba-events/<webhook_token>)
 * scoped to its tenant: registered on connect, added by status when missing,
 * removed on disconnect.
 * Plan: tasks/postshiba-integration-2026-10-22.md.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { encryptValue, decryptValue } from '../_shared/encryption.ts';
import { encryptCredentials } from '../_shared/smtp-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { checkFeatureAccess } from '../_shared/featureAccess.ts';
import {
  createPostShibaClient,
  describePostShibaError,
  PostShibaError,
  type PostShibaCluster,
  type PostShibaTenant,
} from '../_shared/postshiba-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const REVALIDATE_AFTER_MS = 6 * 60 * 60 * 1000;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function publicCluster(c: PostShibaCluster) {
  return {
    id: c.id,
    name: c.name,
    plan: c.plan,
    classification: c.classification,
    status: c.status,
    sending_ready: c.sending_ready,
    emails_per_day: c.emails_per_day,
    emails_per_hour: c.emails_per_hour,
  };
}

// deno-lint-ignore no-explicit-any
function publicConnection(row: any) {
  return {
    team_id: row.team_id,
    api_key_hint: row.api_key_hint,
    cluster_id: row.cluster_id,
    cluster_name: row.cluster_name,
    cluster_plan: row.cluster_plan,
    cluster_classification: row.cluster_classification,
    emails_per_day: row.emails_per_day,
    emails_per_hour: row.emails_per_hour,
    tenant_id: row.tenant_id,
    tenant_slug: row.tenant_slug,
    tenant_name: row.tenant_name,
    status: row.status,
    last_validated_at: row.last_validated_at,
    last_error: row.last_error,
    events_webhook_registered: !!row.events_webhook_id,
  };
}

function clusterColumns(c: PostShibaCluster) {
  return {
    cluster_name: c.name,
    cluster_plan: c.plan,
    cluster_classification: c.classification,
    emails_per_day: c.emails_per_day,
    emails_per_hour: c.emails_per_hour,
    smtp_endpoint: c.smtp_endpoint,
  };
}

/**
 * The team's tenants, each flagged when another org's connection already uses it.
 * PostShiba's list omits the team's default tenant.
 */
async function listTenantsFor(
  supabase: SupabaseClient,
  organizationId: string,
  teamId: string,
  tenants: PostShibaTenant[],
) {
  const { data: used } = await supabase
    .from('postshiba_connections')
    .select('organization_id, tenant_id')
    .eq('team_id', teamId)
    .not('tenant_id', 'is', null);
  const takenByOthers = new Set((used ?? []).filter((r) => r.organization_id !== organizationId).map((r) => r.tenant_id));
  const current = (used ?? []).find((r) => r.organization_id === organizationId)?.tenant_id ?? null;
  return tenants.map((t) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    suspended: t.suspended,
    in_use_elsewhere: takenByOthers.has(t.id),
    current: t.id === current,
  }));
}

function smtpHostPort(endpoint: string | null): { host: string; port: number } {
  const [host, port] = (endpoint ?? '').split(':');
  const parsedPort = parseInt(port ?? '', 10);
  return { host: host || 'smtp.postshiba.com', port: Number.isFinite(parsedPort) ? parsedPort : 587 };
}

/**
 * After the tenant or cluster changes: move the org's PostShiba domains into the
 * new tenant (same team only; a domain can't leave its team) and give every
 * PostShiba sender the new SMTP credential, which is bound to tenant + cluster.
 */
async function migrateDomainsAndSenders(
  supabase: SupabaseClient,
  // deno-lint-ignore no-explicit-any
  row: any,
  apiKey: string,
  smtpPassword: string,
  moveDomains: boolean,
) {
  const failed: Array<{ domain: string; error: string }> = [];
  let moved = 0;
  if (moveDomains) {
    const client = createPostShibaClient(apiKey, row.team_id);
    const { data: domains } = await supabase
      .from('email_sending_domains')
      .select('id, domain, postshiba_domain_id')
      .eq('organization_id', row.organization_id)
      .eq('infra_type', 'postshiba')
      .not('postshiba_domain_id', 'is', null);
    for (const d of domains ?? []) {
      try {
        await client.moveSendingDomain(d.postshiba_domain_id, row.tenant_id);
        moved++;
      } catch (err) {
        const message = describePostShibaError(err).error;
        failed.push({ domain: d.domain, error: message });
        await supabase
          .from('email_sending_domains')
          .update({ postshiba_last_error: `Could not move to tenant ${row.tenant_name ?? row.tenant_slug}: ${message}` })
          .eq('id', d.id);
      }
    }
  }

  const smtp = smtpHostPort(row.smtp_endpoint);
  const smtpCredentials = await encryptCredentials({
    smtp_host: smtp.host,
    smtp_port: smtp.port,
    smtp_username: row.smtp_username,
    smtp_password: smtpPassword,
  });
  const { data: mailboxes } = await supabase
    .from('email_mailboxes')
    .select('id, metadata')
    .eq('organization_id', row.organization_id)
    .eq('connection_type', 'postshiba');
  for (const m of mailboxes ?? []) {
    // deno-lint-ignore no-explicit-any
    const metadata = (m.metadata ?? {}) as Record<string, any>;
    await supabase
      .from('email_mailboxes')
      .update({
        metadata: {
          ...metadata,
          smtp_credentials: smtpCredentials,
          smtp_host: smtp.host,
          smtp_port: smtp.port,
          postshiba: { ...(metadata.postshiba ?? {}), tenant_id: row.tenant_id },
        },
        updated_at: new Date().toISOString(),
      })
      .eq('id', m.id);
  }
  return { domains_moved: moved, domains_failed: failed, senders_updated: (mailboxes ?? []).length };
}

/** Stable per-org tenant slug, so a re-run finds the tenant it created. */
function tenantSlug(organizationId: string): string {
  return `aca-${organizationId.replace(/-/g, '').slice(0, 12)}`;
}

/**
 * Make sure the connection has its tenant-scoped delivery-events webhook, and
 * store the endpoint id and signing secret (returned only on create). Best
 * effort: a failure leaves the connection working and is retried on the next status.
 */
// deno-lint-ignore no-explicit-any
async function ensureEventsWebhook(supabase: SupabaseClient, row: any, apiKey: string) {
  if (row.events_webhook_id || !row.tenant_id || !row.webhook_token) return row;
  try {
    const endpoint = await createPostShibaClient(apiKey, row.team_id).createWebhookEndpoint(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/postshiba-events/${row.webhook_token}`,
      row.tenant_id,
    );
    if (!endpoint.secret) throw new Error('PostShiba did not return the webhook secret.');
    const { data: updated } = await supabase
      .from('postshiba_connections')
      .update({ events_webhook_id: endpoint.id, events_webhook_secret_encrypted: await encryptValue(endpoint.secret) })
      .eq('id', row.id)
      .select('*')
      .single();
    return updated ?? row;
  } catch (err) {
    console.warn('[postshiba-connect] could not register the events webhook:', err instanceof Error ? err.message : err);
    return row;
  }
}

function keyHint(apiKey: string): string {
  return apiKey.length > 4 ? `••••${apiKey.slice(-4)}` : '••••';
}

function readCredentials(body: Record<string, unknown>) {
  const teamId = typeof body.team_id === 'string' ? body.team_id.trim() : '';
  const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';
  return { teamId, apiKey };
}

async function connect(
  supabase: SupabaseClient,
  organizationId: string,
  teamId: string,
  apiKey: string,
  clusterId: string,
  tenantChoice: { tenantId: string; newTenantName: string },
) {
  const client = createPostShibaClient(apiKey, teamId);
  const clusters = await client.listClusters();
  const cluster = clusters.find((c) => c.id === clusterId);
  if (!cluster) {
    return json({ error: 'That cluster is not in this PostShiba team.', error_code: 'cluster_not_ready' }, 400);
  }
  if (!cluster.sending_ready) {
    return json({ error: 'That cluster cannot send yet. Finish setting it up in PostShiba, then try again.', error_code: 'cluster_not_ready' }, 400);
  }

  const { data: existing } = await supabase
    .from('postshiba_connections')
    .select('team_id, cluster_id, api_key_encrypted, smtp_credential_id, tenant_id, events_webhook_id')
    .eq('organization_id', organizationId)
    .maybeSingle();
  const sameTeam = existing?.team_id === teamId;

  // Resolve the tenant: the one picked, a new one by name, else the org's current
  // tenant on this team, else the org's stable-slug tenant (found or created).
  const tenants = await client.listTenants();
  let tenant: PostShibaTenant | undefined;
  if (tenantChoice.tenantId) {
    tenant = tenants.find((t) => t.id === tenantChoice.tenantId);
    if (!tenant) {
      return json({ error: 'That tenant is not in this PostShiba team.', error_code: 'tenant_not_found' }, 400);
    }
    const { data: taken } = await supabase
      .from('postshiba_connections')
      .select('organization_id')
      .eq('team_id', teamId)
      .eq('tenant_id', tenant.id)
      .neq('organization_id', organizationId)
      .limit(1);
    if (taken?.length) {
      return json({
        error: `Tenant ${tenant.name} is already used by another ACA organization. Pick another tenant or create a new one.`,
        error_code: 'tenant_in_use',
      }, 409);
    }
  } else if (!tenantChoice.newTenantName && sameTeam && existing?.tenant_id) {
    tenant = tenants.find((t) => t.id === existing.tenant_id);
  }

  // Same team, cluster and tenant with a live credential: just refresh the key and cluster info.
  if (
    existing && sameTeam && existing.cluster_id === clusterId && existing.smtp_credential_id &&
    !tenantChoice.newTenantName && (!tenant || tenant.id === existing.tenant_id)
  ) {
    const { data: row, error } = await supabase
      .from('postshiba_connections')
      .update({
        api_key_encrypted: await encryptValue(apiKey),
        api_key_hint: keyHint(apiKey),
        ...clusterColumns(cluster),
        ...(tenant ? { tenant_name: tenant.name } : {}),
        status: 'active',
        last_validated_at: new Date().toISOString(),
        last_error: null,
      })
      .eq('organization_id', organizationId)
      .select('*')
      .single();
    if (error) throw new Error(`Failed to update connection: ${error.message}`);
    return json({ ok: true, connection: publicConnection(await ensureEventsWebhook(supabase, row, apiKey)) });
  }

  if (tenantChoice.newTenantName) {
    tenant = await client.createTenant(tenantChoice.newTenantName);
  } else if (!tenant) {
    const { data: org } = await supabase.from('organizations').select('name').eq('id', organizationId).maybeSingle();
    const slug = tenantSlug(organizationId);
    tenant = tenants.find((t) => t.slug === slug) ?? await client.createTenant(org?.name || slug, slug);
  }

  const credential = await client.createSmtpCredential(cluster.id, tenant.id);
  if (!credential.password) {
    throw new Error('PostShiba did not return the SMTP password for the new credential.');
  }

  // Switching team, cluster or tenant: retire the old credential and events endpoint
  // once the new credential exists (best effort).
  if (existing?.smtp_credential_id) {
    try {
      const oldKey = await decryptValue(existing.api_key_encrypted);
      const oldClient = createPostShibaClient(oldKey, existing.team_id);
      await oldClient.disableSmtpCredential(existing.cluster_id, existing.smtp_credential_id);
      if (existing.events_webhook_id) await oldClient.deleteWebhookEndpoint(existing.events_webhook_id);
    } catch (err) {
      console.warn('[postshiba-connect] could not disable the previous SMTP credential:', err instanceof Error ? err.message : err);
    }
  }

  const { data: row, error } = await supabase
    .from('postshiba_connections')
    .upsert(
      {
        organization_id: organizationId,
        team_id: teamId,
        api_key_encrypted: await encryptValue(apiKey),
        api_key_hint: keyHint(apiKey),
        cluster_id: cluster.id,
        ...clusterColumns(cluster),
        tenant_id: tenant.id,
        tenant_slug: tenant.slug,
        tenant_name: tenant.name,
        smtp_credential_id: credential.id,
        smtp_username: credential.username,
        smtp_password_encrypted: await encryptValue(credential.password),
        events_webhook_id: null,
        events_webhook_secret_encrypted: null,
        status: tenant.suspended ? 'suspended' : 'active',
        last_validated_at: new Date().toISOString(),
        last_error: null,
      },
      { onConflict: 'organization_id' },
    )
    .select('*')
    .single();
  if (error) throw new Error(`Failed to save connection: ${error.message}`);

  // Domains follow the tenant (same team only), and senders take the new credential.
  const migration = existing
    ? await migrateDomainsAndSenders(
      supabase,
      row,
      apiKey,
      credential.password,
      sameTeam && existing.tenant_id !== tenant.id,
    )
    : null;

  return json({ ok: true, connection: publicConnection(await ensureEventsWebhook(supabase, row, apiKey)), migration });
}

// deno-lint-ignore no-explicit-any
async function status(supabase: SupabaseClient, row: any) {
  if (!row.events_webhook_id && row.status === 'active') {
    row = await ensureEventsWebhook(supabase, row, await decryptValue(row.api_key_encrypted));
  }
  // A connection saved before emails_per_hour / tenant_name existed re-reads PostShiba once.
  const stale = !row.last_validated_at || row.emails_per_hour == null || row.tenant_name == null ||
    Date.now() - new Date(row.last_validated_at).getTime() > REVALIDATE_AFTER_MS;
  if (!stale) return json({ connected: true, connection: publicConnection(row) });

  // deno-lint-ignore no-explicit-any
  let update: Record<string, any>;
  try {
    const apiKey = await decryptValue(row.api_key_encrypted);
    const client = createPostShibaClient(apiKey, row.team_id);
    const [clusters, tenants] = await Promise.all([client.listClusters(), client.listTenants()]);
    const cluster = clusters.find((c) => c.id === row.cluster_id);
    const tenant = tenants.find((t) => t.id === row.tenant_id);
    update = {
      ...(cluster ? clusterColumns(cluster) : {}),
      tenant_name: tenant?.name ?? row.tenant_name ?? row.tenant_slug,
      status: tenant?.suspended ? 'suspended' : 'active',
      last_validated_at: new Date().toISOString(),
      last_error: cluster ? null : 'The connected cluster no longer exists in this PostShiba team.',
    };
  } catch (err) {
    const described = describePostShibaError(err);
    update = {
      status: described.error_code === 'invalid_key'
        ? 'invalid'
        : described.error_code === 'team_suspended'
        ? 'team_suspended'
        : row.status,
      last_validated_at: new Date().toISOString(),
      last_error: described.error,
    };
  }

  const { data: refreshed } = await supabase
    .from('postshiba_connections')
    .update(update)
    .eq('id', row.id)
    .select('*')
    .single();
  return json({ connected: true, connection: publicConnection(refreshed ?? { ...row, ...update }) });
}

// deno-lint-ignore no-explicit-any
async function disconnect(supabase: SupabaseClient, row: any) {
  if (row.smtp_credential_id) {
    try {
      const apiKey = await decryptValue(row.api_key_encrypted);
      const client = createPostShibaClient(apiKey, row.team_id);
      await client.disableSmtpCredential(row.cluster_id, row.smtp_credential_id);
      if (row.events_webhook_id) await client.deleteWebhookEndpoint(row.events_webhook_id);
    } catch (err) {
      console.warn('[postshiba-connect] could not disable the SMTP credential or events webhook:', err instanceof Error ? err.message : err);
    }
  }

  // Senders that used this connection can no longer send.
  await supabase
    .from('email_mailboxes')
    .update({ status: 'disconnected', updated_at: new Date().toISOString() })
    .eq('organization_id', row.organization_id)
    .eq('connection_type', 'postshiba');

  const { error } = await supabase.from('postshiba_connections').delete().eq('id', row.id);
  if (error) throw new Error(`Failed to remove connection: ${error.message}`);
  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const body = await req.json().catch(() => ({}));
    const { action, organization_id } = body as { action?: string; organization_id?: string };
    if (!organization_id) return json({ error: 'organization_id is required' }, 400);

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const feature = await checkFeatureAccess(supabase, organization_id, 'postshiba');
    if (!feature.allowed) {
      return json({ error: 'PostShiba is not enabled for this organization yet.', error_code: 'feature_disabled' }, 403);
    }

    if (action === 'validate' || action === 'connect') {
      const { teamId, apiKey } = readCredentials(body);
      if (!teamId || !apiKey) return json({ error: 'team_id and api_key are required' }, 400);

      if (action === 'validate') {
        const client = createPostShibaClient(apiKey, teamId);
        const [clusters, tenants] = await Promise.all([client.listClusters(), client.listTenants()]);
        return json({
          ok: true,
          clusters: clusters.map(publicCluster),
          tenants: await listTenantsFor(supabase, organization_id, teamId, tenants),
        });
      }

      const clusterId = typeof body.cluster_id === 'string' ? body.cluster_id.trim() : '';
      if (!clusterId) return json({ error: 'cluster_id is required' }, 400);
      const tenantId = typeof body.tenant_id === 'string' ? body.tenant_id.trim() : '';
      const newTenantName = typeof body.new_tenant_name === 'string' ? body.new_tenant_name.trim().slice(0, 100) : '';
      return await connect(supabase, organization_id, teamId, apiKey, clusterId, { tenantId, newTenantName });
    }

    if (action === 'status' || action === 'disconnect') {
      const { data: row, error } = await supabase
        .from('postshiba_connections')
        .select('*')
        .eq('organization_id', organization_id)
        .maybeSingle();
      if (error) throw new Error(`Failed to read connection: ${error.message}`);
      if (!row) {
        return action === 'status'
          ? json({ connected: false })
          : json({ error: 'This organization has no PostShiba connection.', error_code: 'not_connected' }, 404);
      }
      return action === 'status' ? await status(supabase, row) : await disconnect(supabase, row);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    if (err instanceof PostShibaError) {
      const described = describePostShibaError(err);
      return json({ error: described.error, error_code: described.error_code }, described.status);
    }
    console.error('[postshiba-connect] unhandled:', err);
    return json({ error: err instanceof Error ? err.message : 'Internal error' }, 500);
  }
});
