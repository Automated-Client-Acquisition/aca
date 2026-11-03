/** Sync ZapMail provisioning by saved workspace; reconnect only after SMTP + IMAP proof. */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getOrgApiKeys, listAllMailboxes, getDomainHealth, type ZapMailMailbox } from '../_shared/zapmail-client.ts';
import { extractSMTPCredentials, testSMTPConnection, testIMAPConnection } from '../_shared/smtp-client.ts';
import { resolveEffectiveOrgId } from '../_shared/resolve-api-key.ts';
import { isZapmailSyncable, zapmailWorkspaceIds, verifyZapmailRecovery, resolveZapmailSyncScope } from '../_shared/zapmail-sync-policy.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  const deadline = Date.now() + 100_000;
  try {
    const requestBody = await req.text();
    let body: unknown;
    try { body = requestBody ? JSON.parse(requestBody) : {}; }
    catch { return json({ success: false, error: 'Invalid JSON' }, 400); }
    const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
    if (!bearer) return json({ success: false, error: 'Unauthorized' }, 401);
    const isService = !!serviceKey && bearer === serviceKey;
    let callerOrg: string | null = null;
    if (!isService) {
      const { data, error } = await supabase.auth.getUser(bearer);
      if (error || !data.user) return json({ success: false, error: 'Unauthorized' }, 401);
      callerOrg = await resolveEffectiveOrgId(supabase, data.user.id);
    }
    const scope = resolveZapmailSyncScope(body, isService, callerOrg);
    if ('error' in scope) return json({ success: false, error: scope.error }, scope.status);

    let query = supabase.from('email_mailboxes')
      .select('id, zapmail_mailbox_id, email_address, status, health_score, organization_id, metadata, connection_type, zapmail_api_key_id')
      .in('status', ['ready', 'warming', 'pending', 'disconnected'])
      .or('connection_type.eq.zapmail,and(connection_type.is.null,or(zapmail_mailbox_id.not.is.null,zapmail_api_key_id.not.is.null,metadata->>zapmail_workspace_id.not.is.null))')
      .order('updated_at', { ascending: true })
      .limit(scope.limit);
    if (scope.organizationId) query = query.eq('organization_id', scope.organizationId);
    if (scope.mailboxIds.length) query = query.in('id', scope.mailboxIds);
    const { data: rows, error } = await query;
    if (error) throw error;
    const mailboxes = (rows || []).filter(isZapmailSyncable);
    const totals = { success: true, checked: 0, synced: 0, disconnected: 0, recovered: 0, errors: 0, deferred: 0 };
    const orgs = new Map<string, typeof mailboxes>();
    for (const mb of mailboxes) orgs.set(mb.organization_id, [...(orgs.get(mb.organization_id) || []), mb]);

    for (const [orgId, orgMailboxes] of orgs) {
      const keys = await getOrgApiKeys(supabase, orgId);
      for (const key of keys) {
        const candidates = orgMailboxes.filter(m => m.zapmail_api_key_id === key.id || (!m.zapmail_api_key_id && key === keys[0]));
        const inventories = new Map<string, ZapMailMailbox[]>();
        const domainHealth = new Map<string, number>();
        for (const mb of candidates) {
          if (Date.now() >= deadline) { totals.deferred++; continue; }
          totals.checked++;
          try {
            const workspaces = zapmailWorkspaceIds(mb.metadata, key.workspace_ids);
            if (!workspaces.length) throw new Error('No saved ZapMail workspace; import the mailbox with its workspace first');
            for (const workspace of workspaces) {
              if (!inventories.has(workspace)) inventories.set(workspace, await listAllMailboxes(key.api_key, workspace));
            }
            const inventory = workspaces.flatMap(ws => inventories.get(ws)!);
            const provider = inventory.find(p => p.id === mb.zapmail_mailbox_id || p.email.toLowerCase() === mb.email_address.toLowerCase());
            const now = new Date().toISOString();
            const update: Record<string, unknown> = { updated_at: now };
            const meta: Record<string, unknown> = { last_sync_at: now };
            let recovered = false;
            if (!provider) {
              update.status = 'disconnected';
              update.imap_connected = false;
              update.last_error = 'Mailbox no longer found in ZapMail';
            } else {
              meta.zapmail_status = provider.status;
              meta.zapmail_is_provisioned = provider.isWarmedUp;
              if (provider.status === 'EXPIRED' || provider.status === 'FAILED') {
                update.status = provider.status === 'EXPIRED' ? 'burned' : 'paused';
                update.last_error = `ZapMail status: ${provider.status}`;
              } else if (mb.status === 'disconnected') {
                const connection = await verifyZapmailRecovery(provider.status,
                  () => extractSMTPCredentials(mb.metadata || {}), testSMTPConnection, testIMAPConnection);
                if (connection.success) {
                  update.status = 'ready';
                  update.imap_connected = true;
                  update.last_error = null;
                  meta.consecutive_auth_errors = 0;
                  recovered = true;
                } else {
                  update.imap_connected = connection.imap_ok;
                  update.last_error = `ZapMail connection verification failed: ${connection.error}`;
                }
              } else if (provider.status === 'IN_PROGRESS' || provider.status === 'CREATING_PASSWORD') {
                update.status = 'warming';
              }
              if (!mb.zapmail_api_key_id) update.zapmail_api_key_id = key.id;
              if (!domainHealth.has(provider.domainId)) {
                try {
                  const health = await getDomainHealth(key.api_key, provider.domainId);
                  domainHealth.set(provider.domainId, Math.max(0, Math.min(1, (health.averageScore || 0) / 100)));
                } catch { domainHealth.set(provider.domainId, mb.health_score ?? 1); }
              }
              update.health_score = domainHealth.get(provider.domainId);
            }
            const { error: patchError } = await supabase.rpc('apply_mailbox_metadata_patch', {
              p_id: mb.id, p_set: meta,
              p_unset: recovered ? ['disconnected_reason', 'disconnected_at', 'disconnected_error',
                'imap_auth_error', 'imap_auth_failed_at', 'imap_auth_fail_count'] : [],
            });
            if (patchError) throw patchError;
            // Do not override an archive/pause applied during provider or connection checks.
            // The domain guard may further turn a proposed ready into paused.
            const { data: changed, error: writeError } = await supabase.from('email_mailboxes').update(update)
              .eq('id', mb.id).eq('organization_id', orgId).eq('status', mb.status).select('status').maybeSingle();
            if (writeError) throw writeError;
            if (!changed) { totals.deferred++; continue; }
            totals.synced++;
            if (changed.status === 'disconnected') totals.disconnected++;
            if (recovered && changed.status === 'ready') totals.recovered++;
          } catch (error) {
            // A temporary provider/network failure must not invalidate a working key.
            console.error(`[ZapMail Sync] ${mb.id}:`, error instanceof Error ? error.message : 'Sync failed');
            totals.errors++;
          }
        }
        if (inventories.size) {
          const { data: keyRow } = await supabase.from('api_keys').select('metadata')
            .eq('id', key.id).eq('organization_id', orgId).maybeSingle();
          if (keyRow) {
            await supabase.from('api_keys').update({
              metadata: { ...(keyRow.metadata || {}), last_sync_at: new Date().toISOString() },
            }).eq('id', key.id).eq('organization_id', orgId);
          }
        }
      }
      totals.errors += orgMailboxes.filter(m => !keys.some(k => k.id === m.zapmail_api_key_id) && !!m.zapmail_api_key_id).length;
      if (!keys.length) totals.errors += orgMailboxes.filter(m => !m.zapmail_api_key_id).length;
    }
    return json(totals);
  } catch (error) {
    return json({ success: false, error: error instanceof Error ? error.message : 'Sync failed' }, 500);
  }
});
