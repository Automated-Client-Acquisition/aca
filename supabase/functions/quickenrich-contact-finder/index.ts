/**
 * QuickEnrich Contact Finder Edge Function
 *
 * Discovery endpoint: filters contacts without returning emails/phones.
 * Free (credits_used:0). Use has_email/has_phone flags to find enrichable contacts,
 * then enrich with /enrich-contact via quickenrich adapter.
 *
 * POST /quickenrich-contact-finder
 * Body: {
 *   filters: {
 *     title: { include: ["CEO"], exclude: [] },
 *     country_code: { include: ["US"], exclude: [] },
 *     number_of_employees: { include: ["51-200"], exclude: [] },
 *     has_email: true, has_phone: false,
 *     per_page: 20, page: 1, cursor?: "..." 
 *   },
 *   dryRun?: boolean  // if true, return only counts
 * }
 *
 * Auth: Bearer JWT (org resolved from Supabase auth) + BYOK quickenrich key from api_keys.
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { QuickenrichAdapter } from '../_shared/enrichment/quickenrich.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Auth: extract organization_id from JWT or body
    const authHeader = req.headers.get('authorization') ?? '';
    let organizationId: string | null = null;

    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.replace('Bearer ', '');
      try {
        const { data: { user } } = await createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: `Bearer ${token}` } } }).auth.getUser(token);
        if (user) {
          const { data: orgUser } = await supabase.from('users').select('organization_id').eq('id', user.id).maybeSingle();
          organizationId = (orgUser as any)?.organization_id ?? null;
        }
      } catch { /* fallback to body */ }
    }

    const body = await req.json();
    if (!organizationId) organizationId = body.organizationId ?? body.organization_id ?? null;
    if (!organizationId) {
      return new Response(JSON.stringify({ success: false, error: 'organizationId required (or valid JWT)' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const filters = body.filters ?? body;
    if (!filters || typeof filters !== 'object') {
      return new Response(JSON.stringify({ success: false, error: 'filters object required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Fetch QuickEnrich API key for org
    const { data: apiKeyRow, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted, is_valid')
      .eq('organization_id', organizationId)
      .eq('provider', 'quickenrich')
      .maybeSingle();

    if (keyError || !apiKeyRow) {
      return new Response(JSON.stringify({ success: false, error: 'QuickEnrich API key not configured for this organization. Add it in Settings → Integrations.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!(apiKeyRow as any).is_valid) {
      return new Response(JSON.stringify({ success: false, error: 'QuickEnrich API key is marked invalid. Re-validate in Settings.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = await decryptApiKey((apiKeyRow as any).key_encrypted, encryptionKey);

    // Rate limit: Contact Finder is 120/min (6000 GTM Unlimited). We rely on Quickenrich's 429 + our scheduler if needed.
    // For discovery we do a single call, so no reservation needed — but we surface rate headers.

    const result = await QuickenrichAdapter.contactFinder(apiKey, {
      title: filters.title,
      locality: filters.locality,
      company_name: filters.company_name,
      company_url: filters.company_url,
      number_of_employees: filters.number_of_employees,
      revenue: filters.revenue,
      city: filters.city,
      country_code: filters.country_code,
      industry_linkedin: filters.industry_linkedin,
      bio_li: filters.bio_li,
      services: filters.services,
      has_email: filters.has_email,
      has_phone: filters.has_phone,
      page: filters.page ?? 1,
      per_page: Math.min(filters.per_page ?? 20, 100),
      cursor: filters.cursor,
    });

    // If dryRun, return only meta
    if (body.dryRun) {
      return new Response(JSON.stringify({ success: true, meta: (result as any).meta ?? null, data: [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('quickenrich-contact-finder error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
