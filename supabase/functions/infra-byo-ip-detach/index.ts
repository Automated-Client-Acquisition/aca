/**
 * BYO IP Detach — remove an IP from the Postfix transport map and unpin
 * any mailboxes that were sticky-bound to it. The byo_server_ips row is
 * left with status='disabled' for audit (set delete=true to remove entirely).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { enqueueByoJob, pingByoDeployer } from '../_shared/byo/job-enqueue.ts';

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

interface DetachBody {
  organization_id: string;
  ip_id: string;
  delete_after?: boolean;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: DetachBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, ip_id, delete_after } = body;
  if (!organization_id || !ip_id) {
    return jsonResponse({ success: false, error: 'organization_id and ip_id required' }, 400);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) return jsonResponse({ success: false, error: 'Server not configured' }, 500);

  const supabase = createClient(supabaseUrl, serviceKey);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return jsonResponse({ success: false, error: 'Missing auth header' }, 401);
  const { data: userRes, error: userErr } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (userErr || !userRes?.user) return jsonResponse({ success: false, error: 'Invalid token' }, 401);

  const { data: membership } = await supabase
    .from('organization_members')
    .select('organization_id')
    .eq('organization_id', organization_id)
    .eq('user_id', userRes.user.id)
    .maybeSingle();
  if (!membership) return jsonResponse({ success: false, error: 'Forbidden' }, 403);

  const { data: ipRow } = await supabase
    .from('byo_server_ips')
    .select('id, status')
    .eq('id', ip_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!ipRow) return jsonResponse({ success: false, error: 'IP not found' }, 404);

  // Idempotency on the job side.
  const { data: existingJob } = await supabase
    .from('infra_byo_jobs')
    .select('id, status')
    .eq('organization_id', organization_id)
    .eq('job_type', 'detach_ip')
    .eq('target_kind', 'ip')
    .eq('target_id', ip_id)
    .in('status', ['pending', 'running'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existingJob) {
    return jsonResponse({ success: true, job_id: existingJob.id, status: existingJob.status, reused: true });
  }

  let job_id: string;
  try {
    const result = await enqueueByoJob(supabase, {
      organization_id,
      job_type: 'detach_ip',
      target_kind: 'ip',
      target_id: ip_id,
      input: { delete_after: !!delete_after },
      created_by: userRes.user.id,
    });
    job_id = result.job_id;
  } catch (e) {
    return jsonResponse({ success: false, error: e instanceof Error ? e.message : 'Failed to enqueue' }, 500);
  }

  pingByoDeployer(job_id).catch(() => {});
  return jsonResponse({ success: true, job_id, status: 'pending', reused: false });
});
