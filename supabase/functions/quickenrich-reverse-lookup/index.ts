/**
 * QuickEnrich Reverse Lookup Edge Function
 *
 * GET /quickenrich-reverse-lookup?email=john@company.com
 * POST { email, organizationId }
 *
 * 1 credit when a match is found, 0 otherwise. 1000 req/min (6000 GTM Unlimited).
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { decryptApiKey } from '../_shared/unipile-client.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BASE = 'https://app.quickenrich.io/api';

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    let email: string | null = null;
    let organizationId: string | null = null;

    if (req.method === 'GET') {
      const url = new URL(req.url);
      email = url.searchParams.get('email');
      organizationId = url.searchParams.get('organizationId') ?? url.searchParams.get('organization_id');
    } else {
      const body = await req.json();
      email = body.email ?? null;
      organizationId = body.organizationId ?? body.organization_id ?? null;
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

    if (!email) return new Response(JSON.stringify({ success: false, error: 'email is required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    if (!organizationId) return new Response(JSON.stringify({ success: false, error: 'organizationId required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

    const { data: apiKeyRow } = await supabase.from('api_keys').select('key_encrypted, is_valid').eq('organization_id', organizationId).eq('provider', 'quickenrich').maybeSingle();
    if (!apiKeyRow || !(apiKeyRow as any).is_valid) {
      return new Response(JSON.stringify({ success: false, error: 'QuickEnrich API key not configured or invalid.' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const apiKey = await decryptApiKey((apiKeyRow as any).key_encrypted, encryptionKey);
    const res = await fetch(`${BASE}/employees/email-search?email=${encodeURIComponent(email)}`, {
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
    });
    const body = await res.json();

    return new Response(JSON.stringify(body), { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: res.status });
  } catch (error) {
    console.error('quickenrich-reverse-lookup error:', error);
    return new Response(JSON.stringify({ success: false, error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
