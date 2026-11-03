/**
 * QuickEnrich Company Finder Edge Function
 *
 * Company discovery: 1 credit per company returned.
 * Supports include/exclude filters + cursor pagination past 10k.
 *
 * POST /quickenrich-company-finder
 * Body: {
 *   filters: {
 *     home_page_text: { include: ["cloud migration"], exclude: [] },
 *     services: { include: ["DevOps"], exclude: [] },
 *     industry: { include: ["Computer Software"], exclude: [] },
 *     country_code: { include: ["US"], exclude: [] },
 *     number_of_employees: { include: ["51-200"], exclude: [] },
 *     company_url?: "acme.com",
 *     include_full_text: true, per_page: 10, page: 1, cursor?: "..."
 *   }
 * }
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
      } catch {}
    }

    const body = await req.json();
    if (!organizationId) organizationId = body.organizationId ?? body.organization_id ?? null;
    if (!organizationId) {
      return new Response(JSON.stringify({ success: false, error: 'organizationId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const filters = body.filters ?? body;
    if (!filters || typeof filters !== 'object') {
      return new Response(JSON.stringify({ success: false, error: 'filters object required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: apiKeyRow, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted, is_valid')
      .eq('organization_id', organizationId)
      .eq('provider', 'quickenrich')
      .maybeSingle();

    if (keyError || !apiKeyRow) {
      return new Response(JSON.stringify({ success: false, error: 'QuickEnrich API key not configured. Add it in Settings → Integrations.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!(apiKeyRow as any).is_valid) {
      return new Response(JSON.stringify({ success: false, error: 'QuickEnrich API key is marked invalid.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = await decryptApiKey((apiKeyRow as any).key_encrypted, encryptionKey);

    const result = await QuickenrichAdapter.companyFinder(apiKey, {
      home_page_text: filters.home_page_text,
      bio_li: filters.bio_li,
      services: filters.services,
      industry: filters.industry,
      number_of_employees: filters.number_of_employees,
      revenue: filters.revenue,
      country_code: filters.country_code,
      city: filters.city,
      company_name: filters.company_name,
      company_url: filters.company_url,
      include_full_text: filters.include_full_text,
      page: filters.page ?? 1,
      per_page: Math.min(filters.per_page ?? 10, 100),
      cursor: filters.cursor,
    });

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('quickenrich-company-finder error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
