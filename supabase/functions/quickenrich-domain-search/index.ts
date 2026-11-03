/**
 * QuickEnrich Domain Search Edge Function
 *
 * Enriched dataset lookup: company_url (+ optional title), 20/page, 300/min (6000 GTM Unlimited).
 * Credits: 1/page without title, or 1 per contact with email/phone when title is set.
 *
 * GET /quickenrich-domain-search?company_url=example.com&title=CEO&page=1&has_email=true
 * POST /quickenrich-domain-search  { company_url, title, page, has_email }
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

    let params: Record<string, any> = {};
    let organizationId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      params.company_url = url.searchParams.get('company_url') ?? url.searchParams.get('companyUrl');
      params.title = url.searchParams.get('title');
      params.page = url.searchParams.get('page') ? Number(url.searchParams.get('page')) : 1;
      params.has_email = url.searchParams.get('has_email') === 'true';
      organizationId = url.searchParams.get('organizationId') ?? url.searchParams.get('organization_id');
    } else {
      const body = await req.json();
      params = body;
      organizationId = body.organizationId ?? body.organization_id ?? null;
      // allow JWT fallback
      if (!organizationId) {
        const authHeader = req.headers.get('authorization') ?? '';
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
      }
    }

    if (!organizationId) {
      return new Response(JSON.stringify({ success: false, error: 'organizationId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    if (!params.company_url && !params.companyUrl) {
      return new Response(JSON.stringify({ success: false, error: 'company_url is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const { data: apiKeyRow } = await supabase
      .from('api_keys')
      .select('key_encrypted, is_valid')
      .eq('organization_id', organizationId)
      .eq('provider', 'quickenrich')
      .maybeSingle();

    if (!apiKeyRow || !(apiKeyRow as any).is_valid) {
      return new Response(JSON.stringify({ success: false, error: 'QuickEnrich API key not configured or invalid.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = await decryptApiKey((apiKeyRow as any).key_encrypted, encryptionKey);
    const companyUrl = params.company_url ?? params.companyUrl;

    const result = await QuickenrichAdapter.domainSearch(apiKey, companyUrl, {
      title: params.title ?? undefined,
      page: params.page ?? 1,
      hasEmail: params.has_email ?? params.hasEmail ?? undefined,
    });

    return new Response(JSON.stringify(result), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('quickenrich-domain-search error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
