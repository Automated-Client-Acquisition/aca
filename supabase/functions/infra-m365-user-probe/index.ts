/**
 * M365 User Probe — read-only diagnostic.
 *
 * Given a mailbox, asks EVERY M365 tenant on its organization whether it knows
 * that mailbox's `m365_user_id`. Exists because mailbox rows and sending domains
 * can drift onto different tenants: the sender and connection_retest both resolve
 * the tenant from the DOMAIN (sending_domain_id -> m365_tenants), so a mailbox
 * provisioned under tenant A but whose domain now points at tenant B fails with
 * Graph 404 ErrorInvalidUser — which reads as "the user was deleted" when in fact
 * we asked the wrong tenant.
 *
 * Changes nothing. Body: { mailbox_ids: uuid[] }.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getM365Token } from '../_shared/m365-client.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  // Operator diagnostic with no app callers; run it with the service-role key.
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const body = await req.json().catch(() => ({}));
  const mailboxIds: string[] = body.mailbox_ids ?? [];

  const results: unknown[] = [];

  for (const id of mailboxIds) {
    const { data: mb } = await supabase
      .from('email_mailboxes')
      .select('id, email_address, organization_id, metadata, sending_domain_id')
      .eq('id', id)
      .single();
    if (!mb) continue;

    const meta = (mb.metadata ?? {}) as Record<string, unknown>;
    const userId = meta.m365_user_id as string | undefined;

    const { data: tenants } = await supabase
      .from('m365_tenants')
      .select('id, admin_email, tenant_id')
      .eq('organization_id', mb.organization_id);

    const found: string[] = [];
    const checked: Record<string, string> = {};

    for (const t of tenants ?? []) {
      try {
        const token = await getM365Token(t.tenant_id);
        const res = await fetch(
          `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(userId ?? mb.email_address)}?$select=id,userPrincipalName,accountEnabled`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        if (res.ok) {
          const u = await res.json();
          found.push(t.admin_email);
          checked[t.admin_email] = `FOUND upn=${u.userPrincipalName} enabled=${u.accountEnabled}`;
        } else {
          checked[t.admin_email] = `${res.status}`;
        }
      } catch (err) {
        checked[t.admin_email] = `token_error: ${err instanceof Error ? err.message : 'unknown'}`;
      }
    }

    results.push({
      email: mb.email_address,
      user_id: userId,
      mailbox_claims_tenant: meta.m365_admin_email,
      found_in: found,
      checked,
    });
  }

  return new Response(JSON.stringify({ success: true, results }, null, 2), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
