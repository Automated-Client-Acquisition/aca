import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve caller's organizations
    const { data: orgRows } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id);
    const orgIds = (orgRows as Array<{ organization_id: string }> | null)?.map((r) => r.organization_id) ?? [];
    if (orgIds.length === 0) {
      return new Response(JSON.stringify({ domains: [], total: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json();
    const {
      keywords = [],
      country = null,
      state = null,
      tech_stack = [],
      limit: rawLimit = 100,
      offset: rawOffset = 0,
    } = body as {
      keywords?: string[];
      country?: string | null;
      state?: string | null;
      tech_stack?: string[];
      limit?: number;
      offset?: number;
    };

    const limit = Math.min(500, Math.max(1, rawLimit));
    const offset = Math.max(0, rawOffset);

    // Build query
    let query = supabase
      .from('lb_domain_index')
      .select('*', { count: 'exact' })
      .in('organization_id', orgIds)
      .order('enriched_at', { ascending: false })
      .range(offset, offset + limit - 1);

    // industry_keywords overlap (&&) with provided keywords
    if (keywords.length > 0) {
      query = query.overlaps('industry_keywords', keywords.map((k: string) => k.toLowerCase()));
    }

    if (country) {
      query = query.eq('country', country);
    }

    if (state) {
      query = query.eq('state', state);
    }

    // tech_stack contains (@>) all specified techs
    if (tech_stack.length > 0) {
      query = query.contains('tech_stack', tech_stack.map((t: string) => t.toLowerCase()));
    }

    const { data, error, count } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ domains: data ?? [], total: count ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-domain-search] fatal', err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
