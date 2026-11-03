/**
 * Bulk verifier — verify a list of email addresses up-front (e.g. on lead
 * import). Caches results in email_address_verifications and updates the
 * lead.email_status column so the sequence processor can short-circuit on
 * subsequent runs.
 *
 * Body:
 *   {
 *     organization_id: uuid,
 *     emails?: string[],            // explicit list; OR
 *     lead_ids?: uuid[],            // bulk-verify a slice of leads; OR
 *     contact_ids?: uuid[],         // bulk-verify primary_email of CRM contacts
 *     provider?: 'lite' | 'apify_million_verifier',
 *                                    // 'lite' (default) = heuristic + cache + org-configured provider
 *                                    // 'apify_million_verifier' = $0.001/email via Apify actor
 *     force_refresh?: boolean       // skip the 30-day cache
 *   }
 *
 * Returns: { total, counts: { valid, invalid, ... }, sample: [first 20 results] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import {
  verifyEmailAddressesBulk,
  verifyEmailAddressesBulkViaApify,
  type VerificationStatus,
} from '../_shared/list-verifier.ts';
import { decryptApiKey } from '../_shared/apify-leads-utils.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// Map verifier status → leads.email_status. The leads table accepts:
//   'valid', 'risky', 'invalid', 'catch_all', 'unknown'
function statusToLeadStatus(s: VerificationStatus): string {
  switch (s) {
    case 'valid': return 'valid';
    case 'invalid':
    case 'disposable':
      return 'invalid';
    case 'role':
      return 'risky';
    case 'catch_all': return 'catch_all';
    case 'risky':
    case 'unknown':
    default:
      return 'risky';
  }
}

// Mailtester Ninja runs through the dedicated async pipeline
// (mailtester-verify-kickoff → mailtester-verify-worker), not through this
// synchronous batch endpoint. Keep this union narrow.
type VerifierProvider = 'lite' | 'apify_million_verifier';

interface BatchBody {
  organization_id: string;
  emails?: string[];
  lead_ids?: string[];
  contact_ids?: string[];
  provider?: VerifierProvider;
  force_refresh?: boolean;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: BatchBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }

  const { organization_id, emails, lead_ids, contact_ids, force_refresh } = body;
  if (body.provider === 'mailtester_ninja') {
    return jsonResponse({
      success: false,
      error: 'Mailtester Ninja runs through mailtester-verify-kickoff (async). Call that endpoint instead.',
    }, 400);
  }
  const providerMode: VerifierProvider =
    body.provider === 'apify_million_verifier' ? 'apify_million_verifier' : 'lite';
  if (!organization_id) return jsonResponse({ success: false, error: 'organization_id required' }, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);
  const supabase = createClient(supabaseUrl, serviceKey);

  // AuthN — allow either:
  //   (a) a real user JWT (UI invocation) → check org membership
  //   (b) the service-role bearer (cron / internal / test invocation) → trust caller
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const token = authHeader.replace('Bearer ', '');
  const isServiceRole = token === serviceKey;
  if (!isServiceRole) {
    const { data: userRes, error: userErr } = await supabase.auth.getUser(token);
    if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

    const { data: membership } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('organization_id', organization_id)
      .eq('user_id', userRes.user.id)
      .maybeSingle();
    if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);
  }

  // Resolve target email list — emails > lead_ids > contact_ids
  const targetEmails: string[] = [];
  const leadByEmail = new Map<string, string>();   // email_lower -> lead_id

  if (emails && emails.length > 0) {
    targetEmails.push(...emails);
  } else if (lead_ids && lead_ids.length > 0) {
    const { data: leads } = await supabase
      .from('leads')
      .select('id, email')
      .eq('organization_id', organization_id)
      .in('id', lead_ids);
    for (const l of (leads ?? []) as Array<{ id: string; email: string | null }>) {
      if (l.email) {
        targetEmails.push(l.email);
        leadByEmail.set(l.email.toLowerCase().trim(), l.id);
      }
    }
  } else if (contact_ids && contact_ids.length > 0) {
    // Chunked IN to avoid Postgres parameter limits on large selections.
    const seen = new Set<string>();
    for (let i = 0; i < contact_ids.length; i += 1000) {
      const chunk = contact_ids.slice(i, i + 1000);
      const { data: contacts } = await supabase
        .from('crm_contacts')
        .select('primary_email')
        .eq('organization_id', organization_id)
        .in('id', chunk);
      for (const c of (contacts ?? []) as Array<{ primary_email: string | null }>) {
        const e = c.primary_email?.trim();
        if (e && !seen.has(e.toLowerCase())) {
          seen.add(e.toLowerCase());
          targetEmails.push(e);
        }
      }
    }
  } else {
    return jsonResponse({ success: false, error: 'One of emails, lead_ids, or contact_ids required' }, 400);
  }

  if (targetEmails.length === 0) {
    return jsonResponse({ success: true, total: 0, counts: { valid: 0, invalid: 0, risky: 0, catch_all: 0, disposable: 0, role: 0, unknown: 0 } });
  }
  if (targetEmails.length > 5000) {
    return jsonResponse({ success: false, error: 'Maximum 5000 addresses per batch. Split the request.' }, 400);
  }

  let result;
  if (providerMode === 'apify_million_verifier') {
    // Resolve org's Apify token from api_keys
    const { data: apiKey, error: keyErr } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organization_id)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .maybeSingle();
    if (keyErr || !apiKey) {
      return jsonResponse({
        success: false,
        error: 'Apify API key not found. Add an Apify token in Settings → API Keys before using Full verification.',
      }, 400);
    }
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) return jsonResponse({ success: false, error: 'Server not configured (ENCRYPTION_KEY missing)' }, 500);
    let apifyToken: string;
    try {
      apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);
    } catch (e) {
      return jsonResponse({ success: false, error: `Failed to decrypt Apify token: ${e instanceof Error ? e.message : 'unknown'}` }, 500);
    }
    result = await verifyEmailAddressesBulkViaApify(supabase, organization_id, targetEmails, apifyToken, {
      forceRefresh: force_refresh,
    });
  } else {
    result = await verifyEmailAddressesBulk(supabase, organization_id, targetEmails, {
      forceRefresh: force_refresh,
      concurrency: 8,
    });
  }

  // Update lead.email_status when we matched leads at input.
  if (leadByEmail.size > 0) {
    const updatesByLeadStatus = new Map<string, string[]>();
    for (const r of result.results) {
      const leadId = leadByEmail.get(r.email_lower);
      if (!leadId) continue;
      const ls = statusToLeadStatus(r.status);
      const arr = updatesByLeadStatus.get(ls) ?? [];
      arr.push(leadId);
      updatesByLeadStatus.set(ls, arr);
    }
    for (const [leadStatus, ids] of updatesByLeadStatus) {
      // Chunk to avoid IN-list bloat.
      for (let i = 0; i < ids.length; i += 500) {
        await supabase
          .from('leads')
          .update({ email_status: leadStatus, updated_at: new Date().toISOString() })
          .in('id', ids.slice(i, i + 500))
          .eq('organization_id', organization_id);
      }
    }
  }

  return jsonResponse({
    success: true,
    provider_mode: providerMode,
    total: result.total,
    counts: result.counts,
    sample: result.results.slice(0, 20).map((r) => ({
      email: r.email,
      status: r.status,
      provider: r.provider,
      cached: r.cached,
    })),
  });
});
