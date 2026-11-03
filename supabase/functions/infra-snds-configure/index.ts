/**
 * Phase 8.2.2 — Configure SNDS for a server.
 *
 * Two operations on this endpoint:
 *
 *   action: 'links' — returns deep-link URLs the user clicks once per IP
 *                     range to register at Microsoft (no API exists for this)
 *
 *   action: 'set_data_url' — saves the user-provided data-feed URL (which
 *                            Microsoft assigns after registration is approved)
 *                            so the cron poller can fetch CSVs from it
 *
 * Body:
 *   { organization_id, server_id, action: 'links',
 *     ip_range_start, ip_range_end, contact_email }
 *
 *   { organization_id, server_id, action: 'set_data_url',
 *     snds_data_url, jmrp_complaint_email? }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { buildSndsRegistrationLinks } from '../_shared/snds.ts';

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

interface ConfigureBody {
  organization_id: string;
  server_id: string;
  action: 'links' | 'set_data_url';
  ip_range_start?: string;
  ip_range_end?: string;
  contact_email?: string;
  snds_data_url?: string;
  jmrp_complaint_email?: string;
}

const SNDS_URL_RE = /^https:\/\/sendersupport\.olc\.protection\.outlook\.com\/snds\/data\.aspx\?key=[A-Za-z0-9_-]{16,}$/;
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return jsonResponse({ success: false, error: 'Method not allowed' }, 405);

  let body: ConfigureBody;
  try { body = await req.json(); } catch { return jsonResponse({ success: false, error: 'Invalid JSON' }, 400); }
  const { organization_id, server_id, action } = body;
  if (!organization_id || !server_id || !action) {
    return jsonResponse({ success: false, error: 'organization_id, server_id, action required' }, 400);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

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

  const { data: server } = await supabase
    .from('byo_servers')
    .select('id')
    .eq('id', server_id)
    .eq('organization_id', organization_id)
    .maybeSingle();
  if (!server) return jsonResponse({ success: false, error: 'Server not found' }, 404);

  if (action === 'links') {
    if (!body.ip_range_start || !body.ip_range_end || !body.contact_email) {
      return jsonResponse({ success: false, error: 'ip_range_start, ip_range_end, contact_email required' }, 400);
    }
    if (!EMAIL_RE.test(body.contact_email)) {
      return jsonResponse({ success: false, error: 'Invalid contact_email' }, 400);
    }
    const links = buildSndsRegistrationLinks({
      ip_range_start: body.ip_range_start,
      ip_range_end: body.ip_range_end,
      contact_email: body.contact_email,
    });
    return jsonResponse({ success: true, ...links });
  }

  if (action === 'set_data_url') {
    if (!body.snds_data_url) {
      return jsonResponse({ success: false, error: 'snds_data_url required' }, 400);
    }
    if (!SNDS_URL_RE.test(body.snds_data_url)) {
      return jsonResponse({
        success: false,
        error: 'snds_data_url must look like https://sendersupport.olc.protection.outlook.com/snds/data.aspx?key=...',
      }, 400);
    }
    if (body.jmrp_complaint_email && !EMAIL_RE.test(body.jmrp_complaint_email)) {
      return jsonResponse({ success: false, error: 'Invalid jmrp_complaint_email' }, 400);
    }
    const { error: updErr } = await supabase
      .from('byo_servers')
      .update({
        snds_data_url: body.snds_data_url,
        jmrp_complaint_email: body.jmrp_complaint_email ?? null,
      })
      .eq('id', server_id);
    if (updErr) return jsonResponse({ success: false, error: updErr.message }, 500);

    // Mark all IPs on the server as registered so the UI shows the SNDS badge.
    const now = new Date().toISOString();
    await supabase
      .from('byo_server_ips')
      .update({ snds_registered_at: now })
      .eq('server_id', server_id)
      .is('snds_registered_at', null);

    return jsonResponse({ success: true });
  }

  return jsonResponse({ success: false, error: `Unknown action "${action}"` }, 400);
});
