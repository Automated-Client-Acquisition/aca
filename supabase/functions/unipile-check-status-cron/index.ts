import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { syncUnipileStatusesForOrg } from '../_shared/unipile-status-sync.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Cron-invoked sync of Unipile account statuses across every organization
 * that has a valid Unipile API key (its own or via parent inheritance).
 *
 * Scheduled by migration 20260512000000_unipile_check_status_cron.sql
 * (every 15 minutes).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const started = Date.now();

  try {
    // Collect every org that owns Unipile accounts. We sync by the account-
    // owning org (not the api_keys-owning org) so child orgs that inherit
    // their parent's key are covered exactly once each.
    const { data: orgRows, error: orgErr } = await supabase
      .from('unipile_accounts')
      .select('organization_id');
    if (orgErr) throw orgErr;

    const orgIds = Array.from(new Set((orgRows || []).map(r => r.organization_id))).filter(Boolean) as string[];

    const results: Array<{ organizationId: string; success: boolean; checked?: number; updated?: number; imported?: number; skipped?: number; error?: string }> = [];

    for (const organizationId of orgIds) {
      try {
        const r = await syncUnipileStatusesForOrg(supabase, organizationId, supabaseUrl, encryptionKey);
        results.push({ organizationId, success: true, checked: r.checked, updated: r.updated, imported: r.imported, skipped: r.skipped });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error';
        console.error(`[Check Status Cron] org ${organizationId} failed:`, msg);
        results.push({ organizationId, success: false, error: msg });
      }
    }

    const summary = {
      success: true,
      orgs: orgIds.length,
      succeeded: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      duration_ms: Date.now() - started,
      results,
    };

    console.log(`[Check Status Cron] processed ${summary.orgs} orgs in ${summary.duration_ms}ms (${summary.succeeded} ok, ${summary.failed} failed)`);

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('[Check Status Cron] Fatal:', error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
