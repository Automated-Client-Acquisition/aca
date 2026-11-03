/**
 * Registrar Push — high-level helper that pushes DKIM CNAMEs from a sending domain's
 * stored dns_records into the registrar API for ACA-managed domains.
 *
 * Only acts when the domain row has `registrar_credentials_id` set. BYO-domain
 * customers (where ACA doesn't own the registrar) skip transparently.
 *
 * Returns a structured result so callers can log + decide whether to also re-enable
 * EXO signing. Never throws — credential errors / API errors are surfaced as fields.
 */

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptValue } from './encryption.ts';
import { createRegistrarClient, type RegistrarProvider } from './registrar-client.ts';
import { createCloudflareClient, type PushTargetRecord } from './cloudflare-client.ts';

interface DnsRecordRow {
  type: 'A' | 'TXT' | 'MX' | 'CNAME';
  name: string;
  value: string;
  priority?: number;
  ttl?: number;
  verified?: boolean;
  description?: string;
}

interface DomainRow {
  id: string;
  domain: string;
  dns_records: DnsRecordRow[] | null;
  registrar_credentials_id: string | null;
}

export interface PushResult {
  attempted: boolean;
  pushed: number;
  failed: number;
  errors: string[];
  skipped_reason?: string;
}

const NOOP: PushResult = { attempted: false, pushed: 0, failed: 0, errors: [], skipped_reason: 'no_registrar_attached' };

export async function pushDkimRecordsForDomain(
  supabase: SupabaseClient,
  domain: DomainRow,
): Promise<PushResult> {
  if (!domain.registrar_credentials_id) return NOOP;

  const dkimRecords = (domain.dns_records || []).filter(
    (r) => r.type === 'CNAME' && r.name.toLowerCase().includes('._domainkey.'),
  );
  if (dkimRecords.length === 0) {
    return { attempted: false, pushed: 0, failed: 0, errors: [], skipped_reason: 'no_dkim_records_in_dns_records' };
  }

  const { data: cred, error: credErr } = await supabase
    .from('registrar_credentials')
    .select('id, provider, api_key_encrypted, secret_key_encrypted')
    .eq('id', domain.registrar_credentials_id)
    .single();

  if (credErr || !cred) {
    return { attempted: true, pushed: 0, failed: dkimRecords.length, errors: [`registrar credential not found: ${credErr?.message ?? 'unknown'}`] };
  }

  let apiKey: string;
  let secretKey: string;
  try {
    apiKey = await decryptValue(cred.api_key_encrypted);
    secretKey = await decryptValue(cred.secret_key_encrypted);
  } catch (e) {
    const msg = `failed to decrypt registrar credentials: ${(e as Error).message}`;
    await supabase.from('registrar_credentials').update({ last_error: msg, last_used_at: new Date().toISOString() }).eq('id', cred.id);
    return { attempted: true, pushed: 0, failed: dkimRecords.length, errors: [msg] };
  }

  let client;
  try {
    client = createRegistrarClient(cred.provider as RegistrarProvider, { apiKey, secondaryKey: secretKey });
  } catch (e) {
    return { attempted: true, pushed: 0, failed: dkimRecords.length, errors: [(e as Error).message] };
  }

  const errors: string[] = [];
  let pushed = 0;
  let failed = 0;

  for (const record of dkimRecords) {
    const result = await client.createDnsRecord(domain.domain, {
      type: record.type,
      name: record.name,
      value: record.value,
      ttl: record.ttl ?? 3600,
    });

    if (result.success) {
      pushed += 1;
    } else {
      failed += 1;
      errors.push(`${record.name}: ${result.error ?? 'unknown error'}`);
    }
  }

  await supabase
    .from('registrar_credentials')
    .update({
      last_used_at: new Date().toISOString(),
      last_error: errors.length > 0 ? errors.join(' | ') : null,
    })
    .eq('id', cred.id);

  return { attempted: true, pushed, failed, errors };
}

interface DnsManagedDomainRow extends DomainRow {
  dns_provider_id: string | null;
  cloudflare_zone_id: string | null;
}

/**
 * Push DKIM CNAMEs to Cloudflare for domains that have a `dns_provider_id`.
 * Pushes only the DKIM CNAMEs (not the full record set). Uses batchPushRecords
 * so existing same-value records are skipped and mismatched ones get UPDATED in
 * place (preserves CF record IDs) — safe to call repeatedly.
 */
export async function pushDkimToCloudflare(
  supabase: SupabaseClient,
  domain: DnsManagedDomainRow,
): Promise<PushResult> {
  if (!domain.dns_provider_id || !domain.cloudflare_zone_id) {
    return { attempted: false, pushed: 0, failed: 0, errors: [], skipped_reason: 'no_cloudflare_attached' };
  }
  const { data: provider } = await supabase
    .from('dns_providers')
    .select('api_token_encrypted')
    .eq('id', domain.dns_provider_id)
    .maybeSingle();
  if (!provider) {
    return { attempted: false, pushed: 0, failed: 0, errors: ['dns_provider row missing'], skipped_reason: 'provider_missing' };
  }

  const records = (domain.dns_records as PushTargetRecord[] | null) ?? [];
  const dkimRecords = records.filter((r) => r.type === 'CNAME' && r.name.toLowerCase().includes('_domainkey'));
  if (dkimRecords.length === 0) {
    return { attempted: false, pushed: 0, failed: 0, errors: ['no DKIM records to push'], skipped_reason: 'no_dkim_records' };
  }

  try {
    const token = await decryptValue(provider.api_token_encrypted);
    const client = createCloudflareClient(token);
    const result = await client.batchPushRecords(domain.cloudflare_zone_id, dkimRecords, {
      cleanupConflicts: true,
      confirmDestructive: true,
    });
    const pushed = result.results.filter((r) => (r.action === 'created' || r.action === 'updated') && r.success).length;
    const failed = result.results.filter((r) => !r.success).length;
    const errors = result.results.filter((r) => !r.success).map((r) => r.error || 'unknown error');
    return { attempted: true, pushed, failed, errors };
  } catch (err) {
    return { attempted: true, pushed: 0, failed: dkimRecords.length, errors: [(err as Error).message] };
  }
}

/**
 * Push a domain's stored DKIM CNAMEs to whichever DNS provider ACA manages for it.
 * Precedence: Cloudflare → Porkbun. CF is the modern path used by the wizard and
 * propagates in seconds; Porkbun is the legacy registrar integration. Domains can
 * have both linked during a migration, prefer CF. BYO-DNS domains are a no-op.
 */
export async function pushDkimToDnsProvider(
  supabase: SupabaseClient,
  domain: DnsManagedDomainRow,
): Promise<{ channel: 'cloudflare' | 'porkbun' | null; result: PushResult }> {
  if (domain.dns_provider_id && domain.cloudflare_zone_id) {
    return { channel: 'cloudflare', result: await pushDkimToCloudflare(supabase, domain) };
  }
  if (domain.registrar_credentials_id) {
    return { channel: 'porkbun', result: await pushDkimRecordsForDomain(supabase, domain) };
  }
  return { channel: null, result: NOOP };
}
