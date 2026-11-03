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
      return new Response(JSON.stringify({ error: 'Missing Authorization' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const jwt = authHeader.replace(/^Bearer\s+/i, '');
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: `Bearer ${jwt}` } } });
    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: orgRows } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id);
    const orgIds = (orgRows as Array<{ organization_id: string }> | null)?.map((r) => r.organization_id) ?? [];

    const url = new URL(req.url);
    const jobId = url.searchParams.get('job_id');
    const fitLabelsRaw = url.searchParams.get('fit_label');
    const limit = Math.min(500, parseInt(url.searchParams.get('limit') ?? '50', 10) || 50);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10) || 0;

    if (!jobId) {
      return new Response(JSON.stringify({ error: 'job_id required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let query = supabase
      .from('lb_enriched_leads')
      .select(
        'id, verified_email, email_status, icp_score, fit_label, score_breakdown, claude_reasoning, exported_lead_id, exported_at, created_at, dm:lb_decision_makers(id, first_name, last_name, title, linkedin_url), company:lb_discovered_companies(id, company_name, domain, website_url, city, country)',
        { count: 'exact' },
      )
      .eq('job_id', jobId)
      .in('organization_id', orgIds)
      .order('icp_score', { ascending: false })
      .range(offset, offset + limit - 1);

    if (fitLabelsRaw) {
      const labels = fitLabelsRaw.split(',').map((s) => s.trim()).filter(Boolean);
      if (labels.length > 0) query = query.in('fit_label', labels);
    }

    const { data, error, count } = await query;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ leads: data ?? [], total: count ?? 0, limit, offset }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-get-leads] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
