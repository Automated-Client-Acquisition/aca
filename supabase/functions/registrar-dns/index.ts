import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { createRegistrarClient, type RegistrarProvider } from "../_shared/registrar-client.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

/**
 * Decrypt AES-256-GCM encrypted value using ENCRYPTION_KEY.
 * validate-api-key encrypts with ENCRYPTION_KEY, so we must decrypt with
 * the same key (not SMTP_ENCRYPTION_KEY from _shared/encryption.ts).
 */
async function decryptWithEncryptionKey(encrypted: string): Promise<string> {
  const keyHex = Deno.env.get('ENCRYPTION_KEY');
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string');
  }
  const keyBytes = new Uint8Array(keyHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const combined = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv }, cryptoKey, ciphertext
  );
  return new TextDecoder().decode(plaintext);
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function resolveRegistrarClient(supabase: any, organizationId: string) {
  const { data: keys, error } = await supabase
    .from('api_keys')
    .select('provider, key_encrypted, metadata')
    .eq('organization_id', organizationId)
    .eq('provider', 'porkbun')
    .eq('is_valid', true)
    .limit(1);

  if (error) throw new Error(`Failed to query registrar keys: ${error.message}`);
  if (!keys || keys.length === 0) {
    throw new Error('No registrar API key configured. Add a Porkbun key in Settings > API Keys.');
  }

  const key = keys[0];
  const apiKey = await decryptWithEncryptionKey(key.key_encrypted);
  const secondaryKey = key.metadata?.secondary_key_encrypted
    ? await decryptWithEncryptionKey(key.metadata.secondary_key_encrypted)
    : '';

  if (!secondaryKey) {
    throw new Error(`Registrar key is missing secondary credential (password/secret). Please re-add the key.`);
  }

  const provider = key.provider as RegistrarProvider;
  const client = createRegistrarClient(provider, { apiKey, secondaryKey });

  return { client, provider };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const { action, organization_id, domain, domain_id, forwarding_url, forwarding_type, forwarding_subdomain, record } = await req.json();

    if (!organization_id) {
      return json({ error: 'organization_id is required' }, 400);
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    const { client, provider } = await resolveRegistrarClient(supabase, organization_id);

    switch (action) {
      // ==================================================================
      // List all domains from the registrar account
      // ==================================================================
      case 'list_domains': {
        const domains = await client.listDomains();
        return json({ domains, provider });
      }

      // ==================================================================
      // List existing DNS records for a specific domain
      // ==================================================================
      case 'list_dns_records': {
        if (!domain) return json({ error: 'domain is required' }, 400);
        const records = await client.listDnsRecords(domain);
        return json({ records, provider });
      }

      // ==================================================================
      // Push DNS records from email_sending_domain to registrar
      // ==================================================================
      case 'push_dns_records': {
        if (!domain_id) return json({ error: 'domain_id is required' }, 400);

        // Fetch the email_sending_domain to get its DNS records
        const { data: sendingDomain, error: domainError } = await supabase
          .from('email_sending_domains')
          .select('domain, dns_records')
          .eq('id', domain_id)
          .eq('organization_id', organization_id)
          .single();

        if (domainError || !sendingDomain) {
          return json({ error: 'Sending domain not found' }, 404);
        }

        const dnsRecords = sendingDomain.dns_records || [];
        const results: { record: { type: string; name: string }; success: boolean; error?: string }[] = [];

        // Remove URL forwarding first — Porkbun creates system A records for
        // forwarded domains that block DNS A record creation.
        const hasRootARecord = dnsRecords.some(
          (r: { type: string; name: string }) =>
            r.type === 'A' && (r.name === sendingDomain.domain || r.name === `${sendingDomain.domain}.`)
        );
        if (hasRootARecord) {
          try {
            await client.deleteUrlForwarding(sendingDomain.domain);
          } catch { /* no forwarding to delete — fine */ }
        }

        // Fetch existing records once to delete conflicts before creating
        let existingRecords: { id?: string; type: string; name: string }[] = [];
        try {
          existingRecords = await client.listDnsRecords(sendingDomain.domain);
        } catch { /* proceed without — creates may fail on conflicts */ }

        for (const record of dnsRecords) {
          // TXT records can have multiple values at the same name (SPF, DKIM, ms-verification, etc.)
          // Only delete conflicting records for types that must be unique (CNAME, A, MX etc.)
          // Never delete existing TXT records — they may be pre-existing and unrelated.
          if (record.type !== 'TXT') {
            const conflicts = existingRecords.filter(
              (r) => r.type === record.type && r.name === record.name
            );
            for (const c of conflicts) {
              try {
                await client.deleteDnsRecord(sendingDomain.domain, c.type, c.name);
              } catch { /* ignore */ }
            }
          }

          const result = await client.createDnsRecord(sendingDomain.domain, {
            type: record.type,
            name: record.name,
            value: record.value,
            ttl: record.ttl || 600,
            priority: record.priority,
          });

          results.push({
            record: { type: record.type, name: record.name },
            success: result.success,
            error: result.error,
          });
        }

        const allSuccess = results.every(r => r.success);
        const failedCount = results.filter(r => !r.success).length;

        return json({
          success: allSuccess,
          results,
          summary: allSuccess
            ? `All ${results.length} DNS records pushed successfully`
            : `${results.length - failedCount}/${results.length} records pushed. ${failedCount} failed.`,
          provider,
        });
      }

      // ==================================================================
      // Create a single arbitrary DNS record on a domain's zone — for records
      // that don't live in email_sending_domains.dns_records (e.g. an
      // external-report DMARC authorization TXT record on a *different*
      // domain's zone than the one it's authorizing). Unlike push_dns_records,
      // this doesn't source from any domain's stored dns_records column.
      // ==================================================================
      case 'create_dns_record': {
        if (!domain) return json({ error: 'domain is required' }, 400);
        if (!record?.type || !record?.name || record?.value === undefined) {
          return json({ error: 'record.type, record.name, and record.value are required' }, 400);
        }
        const result = await client.createDnsRecord(domain, {
          type: record.type,
          name: record.name,
          value: record.value,
          ttl: record.ttl,
          priority: record.priority,
        });
        return json({ ...result, provider });
      }

      // ==================================================================
      // Replace a domain's DMARC record (e.g. repoint rua= at the shared
      // collector mailbox). create_dns_record can't do this: adding a second
      // v=DMARC1 TXT makes DMARC invalid (RFC 7489 §6.6.3), and Porkbun's
      // editByNameType is unsafe for TXT in general. Refuses to touch
      // _dmarc if it holds any non-DMARC TXT. Deletes then creates, and puts
      // the previous value back if the create fails.
      // ==================================================================
      case 'set_dmarc_record': {
        if (!domain) return json({ error: 'domain is required' }, 400);
        const value = typeof record?.value === 'string' ? record.value.trim() : '';
        if (!value.toLowerCase().startsWith('v=dmarc1')) {
          return json({ error: 'record.value must be a v=DMARC1 record' }, 400);
        }
        const dmarcName = `_dmarc.${domain.toLowerCase()}`;
        const existing = (await client.listDnsRecords(domain))
          .filter((r) => r.type === 'TXT' && r.name.toLowerCase() === dmarcName);
        const unquote = (v: string) => v.replace(/^"|"$/g, '').trim();
        if (existing.some((r) => !unquote(r.value).toLowerCase().startsWith('v=dmarc1'))) {
          return json({ error: `${dmarcName} holds a non-DMARC TXT record; not modifying it` }, 409);
        }
        if (existing.length === 1 && unquote(existing[0].value) === value) {
          return json({ success: true, unchanged: true, provider });
        }

        for (const _ of existing) {
          const del = await client.deleteDnsRecord(domain, 'TXT', existing[0].name);
          if (!del.success) return json({ success: false, error: `delete failed: ${del.error}`, provider }, 502);
        }
        const created = await client.createDnsRecord(domain, { type: 'TXT', name: dmarcName, value, ttl: record.ttl ?? 600 });
        if (!created.success && existing.length > 0) {
          const restored = await client.createDnsRecord(domain, {
            type: 'TXT', name: dmarcName, value: unquote(existing[0].value), ttl: existing[0].ttl ?? 600,
          });
          return json({ success: false, error: `create failed: ${created.error}`, restored: restored.success, provider }, 502);
        }
        return json({ ...created, previous: existing.map((r) => unquote(r.value)), provider });
      }

      // ==================================================================
      // Get URL forwarding for a domain
      // ==================================================================
      case 'get_url_forwarding': {
        if (!domain) return json({ error: 'domain is required' }, 400);
        const forwards = await client.getUrlForwarding(domain);
        return json({ forwards, provider });
      }

      // ==================================================================
      // Set URL forwarding for a domain
      // ==================================================================
      case 'set_url_forwarding': {
        if (!domain) return json({ error: 'domain is required' }, 400);
        if (!forwarding_url) return json({ error: 'forwarding_url is required' }, 400);

        const result = await client.setUrlForwarding(
          domain,
          forwarding_url,
          forwarding_type || 'redirect_301',
          forwarding_subdomain || ''
        );

        return json({ ...result, provider });
      }

      // ==================================================================
      // Delete URL forwarding for a domain
      // ==================================================================
      case 'delete_url_forwarding': {
        if (!domain) return json({ error: 'domain is required' }, 400);
        const result = await client.deleteUrlForwarding(domain);
        return json({ ...result, provider });
      }

      default:
        return json({ error: `Unknown action: ${action}` }, 400);
    }
  } catch (error) {
    console.error('registrar-dns error:', error);
    return json(
      { error: error instanceof Error ? error.message : 'Internal error' },
      error instanceof Error && error.message.includes('No registrar') ? 400 : 500
    );
  }
});
