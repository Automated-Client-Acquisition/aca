import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

export interface M365HealthMailbox {
  organization_id: string;
  metadata: Record<string, unknown> | null;
  status: string;
}

/** Verify the Graph path the sender actually uses; never send or fall back to SMTP. */
export async function testM365MailboxConnection(
  supabase: SupabaseClient,
  mailbox: M365HealthMailbox,
  getToken: (tenantId: string) => Promise<string>,
  fetchGraph: typeof fetch = fetch,
): Promise<{ success: boolean; error?: string }> {
  const meta = mailbox.metadata ?? {};
  const userId = meta.m365_user_id;
  const adminEmail = meta.m365_admin_email;
  if (typeof userId !== 'string' || !userId || typeof adminEmail !== 'string' || !adminEmail) {
    return { success: false, error: 'Missing M365 user or admin metadata' };
  }

  try {
    // Match resolveM365TenantId in the sequence sender, including org scoping.
    const { data: tenant, error } = await supabase
      .from('m365_tenants')
      .select('tenant_id')
      .eq('organization_id', mailbox.organization_id)
      .eq('admin_email', adminEmail)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!tenant?.tenant_id) return { success: false, error: 'M365 sending tenant not found' };

    const token = await getToken(tenant.tenant_id);
    const response = await fetchGraph(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId)}/mailFolders/inbox?$select=id`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 200);
      return { success: false, error: `Graph API ${response.status}: ${detail}` };
    }
    await response.body?.cancel();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Graph connection test failed' };
  }
}

/** Connection recovery does not own operator, reputation, tenant, or domain holds. */
export function m365RetestStatus(mailbox: M365HealthMailbox, healthy: boolean): string {
  if (mailbox.status === 'burned' || mailbox.status === 'archived') return mailbox.status;
  if (mailbox.status === 'paused' || mailbox.metadata?.paused_reason) return 'paused';
  if (!healthy) return 'disconnected';
  return mailbox.status === 'warming' ? 'warming' : 'ready';
}
