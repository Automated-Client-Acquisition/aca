/**
 * list-building-proxy-crud
 *
 * CRUD for an org's BYO SMTP proxy pool (table: lb_proxy_pool).
 * Credentials are encrypted at rest via shared encryption.ts (AES-256-GCM).
 *
 * Body schema:
 *   { action: 'list' }
 *   { action: 'create', proxy: { provider, proxy_type, host, port, username?, password? } }
 *   { action: 'update', id, patch: { ... } }
 *   { action: 'retire', id }
 *
 * Auth: JWT -> organization_members lookup (first org, mirroring other fns).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { corsHeaders } from '../_shared/cors.ts';
import { encryptValue } from '../_shared/encryption.ts';

interface ProxyInput {
  provider: 'brightdata' | 'smartproxy' | 'oxylabs' | 'custom';
  proxy_type: 'datacenter' | 'residential' | 'dedicated_smtp';
  host: string;
  port: number;
  username?: string;
  password?: string;
  active?: boolean;
}

const PUBLIC_COLUMNS =
  'id, organization_id, provider, proxy_type, host, port, active, success_count, fail_count, last_used_at, last_failed_at, retired_at, created_at';

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceKey) return json(500, { error: 'missing env' });

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(401, { error: 'missing auth' });

    const supabase = createClient(supabaseUrl, serviceKey);

    // Resolve caller -> org
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const { data: userData, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !userData?.user) return json(401, { error: 'unauthorized' });

    const { data: memberData } = await supabase
      .from('organization_members')
      .select('organization_id')
      .eq('user_id', userData.user.id)
      .limit(1)
      .single();

    if (!memberData) return json(400, { error: 'no organization' });
    const orgId = memberData.organization_id as string;

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string | undefined;

    switch (action) {
      case 'list': {
        const { data, error } = await supabase
          .from('lb_proxy_pool')
          .select(PUBLIC_COLUMNS)
          .eq('organization_id', orgId)
          .order('created_at', { ascending: false });
        if (error) return json(500, { error: error.message });
        return json(200, { proxies: data });
      }

      case 'create': {
        const proxy = body?.proxy as ProxyInput | undefined;
        if (!proxy?.provider || !proxy?.proxy_type || !proxy?.host || !proxy?.port) {
          return json(400, { error: 'provider, proxy_type, host, port required' });
        }
        const username_enc = proxy.username ? await encryptValue(proxy.username) : null;
        const password_enc = proxy.password ? await encryptValue(proxy.password) : null;

        const { data, error } = await supabase
          .from('lb_proxy_pool')
          .insert({
            organization_id: orgId,
            provider: proxy.provider,
            proxy_type: proxy.proxy_type,
            host: proxy.host,
            port: proxy.port,
            username_enc,
            password_enc,
            active: proxy.active ?? true,
          })
          .select(PUBLIC_COLUMNS)
          .single();
        if (error) return json(500, { error: error.message });
        return json(200, { proxy: data });
      }

      case 'update': {
        const id = body?.id as string | undefined;
        const patch = (body?.patch ?? {}) as Partial<ProxyInput>;
        if (!id) return json(400, { error: 'id required' });

        const update: Record<string, unknown> = {};
        if (patch.provider) update.provider = patch.provider;
        if (patch.proxy_type) update.proxy_type = patch.proxy_type;
        if (patch.host) update.host = patch.host;
        if (typeof patch.port === 'number') update.port = patch.port;
        if (typeof patch.active === 'boolean') update.active = patch.active;
        if (typeof patch.username === 'string') {
          update.username_enc = await encryptValue(patch.username);
        }
        if (typeof patch.password === 'string') {
          update.password_enc = await encryptValue(patch.password);
        }

        const { data, error } = await supabase
          .from('lb_proxy_pool')
          .update(update)
          .eq('id', id)
          .eq('organization_id', orgId)
          .select(PUBLIC_COLUMNS)
          .single();
        if (error) return json(500, { error: error.message });
        return json(200, { proxy: data });
      }

      case 'retire': {
        const id = body?.id as string | undefined;
        if (!id) return json(400, { error: 'id required' });
        const { data, error } = await supabase
          .from('lb_proxy_pool')
          .update({
            active: false,
            retired_at: new Date().toISOString(),
          })
          .eq('id', id)
          .eq('organization_id', orgId)
          .select(PUBLIC_COLUMNS)
          .single();
        if (error) return json(500, { error: error.message });
        return json(200, { proxy: data });
      }

      default:
        return json(400, { error: `unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[list-building-proxy-crud] fatal', err);
    return json(500, {
      error: err instanceof Error ? err.message : 'unknown error',
    });
  }
});
