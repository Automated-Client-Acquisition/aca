/**
 * Infrastructure Domain Config
 *
 * Manages per-domain email/forwarding settings. Updates Postfix/Nginx on the VM.
 * Actions:
 *   - get_config: Get current domain configuration
 *   - update_forwarding: Set domain web forwarding URL (Nginx 301 redirect)
 *   - update_dmarc_email: Set DMARC report email address
 *   - update_forwarding_email: Set email forwarding for all incoming mail
 *   - update_catchall: Enable/disable catch-all email
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { getVMCredentials, setDomainForward, setCatchAll, removeCatchAll, setForwarding } from '../_shared/postal-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const body = await req.json();
    const { action, domain_id, organization_id } = body;

    if (!domain_id || !organization_id) {
      return jsonResponse({ error: 'domain_id and organization_id are required' }, 400);
    }

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Fetch domain
    const { data: domainRecord, error: fetchError } = await supabase
      .from('email_sending_domains')
      .select('*, azure_subscriptions!inner(*)')
      .eq('id', domain_id)
      .eq('organization_id', organization_id)
      .single();

    if (fetchError || !domainRecord) {
      return jsonResponse({ error: 'Domain not found' }, 404);
    }

    // ── get_config ──────────────────────────────────────────────────
    if (action === 'get_config') {
      return jsonResponse({
        success: true,
        config: {
          domain: domainRecord.domain,
          forwarding_url: domainRecord.forwarding_url,
          dmarc_email: domainRecord.dmarc_email,
          forwarding_email: domainRecord.forwarding_email,
          catchall_email: domainRecord.catchall_email,
          catchall_enabled: domainRecord.catchall_enabled,
          dns_status: domainRecord.dns_status,
          spf_verified: domainRecord.spf_verified,
          dkim_verified: domainRecord.dkim_verified,
          dmarc_verified: domainRecord.dmarc_verified,
        },
      });
    }

    // All write actions require a running VM
    if (domainRecord.vm_status !== 'running') {
      return jsonResponse({ error: 'VM is not running. Cannot update configuration.' }, 400);
    }

    const sub = domainRecord.azure_subscriptions;
    const creds = await getVMCredentials(sub, domainRecord.vm_name, domainRecord.metadata?.resource_group);

    // ── update_forwarding ───────────────────────────────────────────
    if (action === 'update_forwarding') {
      const { forwarding_url } = body;

      if (forwarding_url && !/^https?:\/\/.+/.test(forwarding_url)) {
        return jsonResponse({ error: 'Invalid URL. Must start with http:// or https://' }, 400);
      }

      if (forwarding_url) {
        console.log(`[Infra Config] Setting domain forwarding for ${domainRecord.domain} → ${forwarding_url}`);
        await setDomainForward(creds, forwarding_url);
      }

      await supabase
        .from('email_sending_domains')
        .update({ forwarding_url: forwarding_url || null, updated_at: new Date().toISOString() })
        .eq('id', domain_id)
        .eq('organization_id', organization_id);

      return jsonResponse({ success: true, forwarding_url });
    }

    // ── update_dmarc_email ──────────────────────────────────────────
    if (action === 'update_dmarc_email') {
      const { dmarc_email } = body;

      // Update DMARC DNS record with new rua email
      const dnsRecords = (domainRecord.dns_records || []).map((r: Record<string, unknown>) => {
        if (r.name === `_dmarc.${domainRecord.domain}`) {
          const email = dmarc_email || `dmarc@${domainRecord.domain}`;
          return {
            ...r,
            value: `v=DMARC1; p=quarantine; rua=mailto:${email}`,
            verified: false,
          };
        }
        return r;
      });

      await supabase
        .from('email_sending_domains')
        .update({
          dmarc_email: dmarc_email || null,
          dns_records: dnsRecords,
          dns_status: 'pending', // DNS needs re-verification
          dmarc_verified: false,
          updated_at: new Date().toISOString(),
        })
        .eq('id', domain_id)
        .eq('organization_id', organization_id);

      return jsonResponse({
        success: true,
        dmarc_email,
        message: 'DMARC record updated. Please update DNS and re-verify.',
      });
    }

    // ── update_forwarding_email ─────────────────────────────────────
    if (action === 'update_forwarding_email') {
      const { forwarding_email } = body;

      if (forwarding_email) {
        console.log(`[Infra Config] Setting email forwarding for @${domainRecord.domain} → ${forwarding_email}`);
        await setForwarding(creds, `@${domainRecord.domain}`, forwarding_email);
      }

      await supabase
        .from('email_sending_domains')
        .update({ forwarding_email: forwarding_email || null, updated_at: new Date().toISOString() })
        .eq('id', domain_id)
        .eq('organization_id', organization_id);

      return jsonResponse({ success: true, forwarding_email });
    }

    // ── update_catchall ─────────────────────────────────────────────
    if (action === 'update_catchall') {
      const { catchall_email, catchall_enabled } = body;

      if (catchall_enabled && catchall_email) {
        console.log(`[Infra Config] Enabling catch-all for @${domainRecord.domain} → ${catchall_email}`);
        await setCatchAll(creds, domainRecord.domain, catchall_email);
      } else {
        console.log(`[Infra Config] Disabling catch-all for @${domainRecord.domain}`);
        await removeCatchAll(creds, domainRecord.domain);
      }

      await supabase
        .from('email_sending_domains')
        .update({
          catchall_email: catchall_email || null,
          catchall_enabled: !!catchall_enabled,
          updated_at: new Date().toISOString(),
        })
        .eq('id', domain_id)
        .eq('organization_id', organization_id);

      return jsonResponse({ success: true, catchall_email, catchall_enabled });
    }

    return jsonResponse({ error: `Unknown action: ${action}` }, 400);

  } catch (error) {
    console.error('[Infra Domain Config] Error:', error);
    return jsonResponse({
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
});
