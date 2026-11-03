import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';

/**
 * Export enriched List Building leads into the main `leads` table.
 * Columns mirror supabase/functions/enroll-leads/index.ts:
 *   organization_id, email, first_name, last_name, company, job_title, linkedin_url, source, source_id
 */
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

    const body = await req.json();
    const { job_id, fit_labels, target_list_id } = body as { job_id: string; fit_labels: string[]; target_list_id?: string };
    if (!job_id || !Array.isArray(fit_labels) || fit_labels.length === 0) {
      return new Response(JSON.stringify({ error: 'job_id + fit_labels[] required' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Pull enriched rows within the user's orgs, joined to DM + company.
    const { data: rows, error } = await supabase
      .from('lb_enriched_leads')
      .select('id, organization_id, verified_email, dm:lb_decision_makers(first_name, last_name, title, linkedin_url), company:lb_discovered_companies(company_name, domain)')
      .eq('job_id', job_id)
      .in('organization_id', orgIds)
      .in('fit_label', fit_labels)
      .is('exported_lead_id', null);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const toExport = (rows as any[]) ?? [];
    let exported = 0;

    for (const r of toExport) {
      const dm = Array.isArray(r.dm) ? r.dm[0] : r.dm;
      const company = Array.isArray(r.company) ? r.company[0] : r.company;
      const insertPayload = {
        organization_id: r.organization_id,
        email: r.verified_email,
        first_name: dm?.first_name ?? null,
        last_name: dm?.last_name ?? null,
        company: company?.company_name ?? null,
        job_title: dm?.title ?? null,
        linkedin_url: dm?.linkedin_url ?? null,
        source: 'list_building',
        source_id: r.id,
      };
      const { data: newLead, error: insErr } = await supabase
        .from('leads')
        .insert(insertPayload)
        .select('id')
        .single();
      if (insErr || !newLead) {
        console.error('[lb-export] lead insert failed', insErr);
        continue;
      }

      await supabase
        .from('lb_enriched_leads')
        .update({
          exported_lead_id: (newLead as { id: string }).id,
          exported_at: new Date().toISOString(),
        })
        .eq('id', r.id);

      if (target_list_id) {
        // Best-effort list membership. Ignore duplicate errors.
        await supabase
          .from('lead_list_members')
          .insert({ list_id: target_list_id, lead_id: (newLead as { id: string }).id })
          .then(() => {}, (e: unknown) => console.log('[lb-export] list membership skipped', e));
      }
      exported++;
    }

    return new Response(JSON.stringify({ ok: true, exported, considered: toExport.length }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[lb-export] fatal', err);
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
