/**
 * BYO IP — assign or unassign a sending domain to an IP.
 *
 * Domain pinning is a cold-email best practice: each IP signs/sends from a
 * single domain to avoid cross-domain reputation bleed. Setting domain_id=null
 * unpins the IP back into the unassigned pool.
 *
 * No deployer round-trip needed — just a DB update. Mailbox sticky-IP picks
 * happen at provision time and respect this assignment via _shared/byo/ip-rotation.ts.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

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

interface AssignBody {
  organization_id: string;
  ip_id: string;
  domain_id: string | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: AssignBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, ip_id, domain_id } = body;
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
    .select('id, server_id')
    .eq('id', ip_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!ipRow) return jsonResponse({ success: false, error: 'IP not found' }, 404);

  if (domain_id) {
    const { data: domain } = await supabase
      .from('email_sending_domains')
      .select('id, infra_type, byo_server_id')
      .eq('id', domain_id)
      .eq('organization_id', organization_id)
      .maybeSingle();
    if (!domain) return jsonResponse({ success: false, error: 'Domain not found' }, 404);
    if (domain.infra_type !== 'byo') return jsonResponse({ success: false, error: 'Domain is not a BYO domain' }, 400);
    if (domain.byo_server_id !== ipRow.server_id) {
      return jsonResponse({ success: false, error: 'Domain is not on this IP\'s server' }, 400);
    }
  }

  const { error: updErr } = await supabase
    .from('byo_server_ips')
    .update({ domain_id: domain_id ?? null })
    .eq('id', ip_id);
  if (updErr) return jsonResponse({ success: false, error: updErr.message }, 500);

  return jsonResponse({ success: true, ip_id, domain_id: domain_id ?? null });
});
