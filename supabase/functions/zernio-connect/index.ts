/**
 * Starts connecting a social account to the organization's own Zernio workspace (BYOK) from ACA,
 * so nobody has to open Zernio's dashboard.
 *
 * POST { organization_id, platform }   platform in ACA names: facebook, instagram, tiktok, youtube,
 *                                      google, threads, pinterest, linkedin, twitter
 * → { success: true, auth_url }        open it in a popup
 * → { success: false, error, code? }   code 'no_key' when the org has no Zernio key yet
 *
 * Each organization gets one Zernio profile (externalId = organization id), created on first use.
 * After sign-in Zernio sends the browser to <app>/connect/zernio with connected=<platform>&username=…
 * or error=…&error_message=…; that page tells the Scheduler and closes.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { APP_URL } from '../_shared/site-config.ts';
import { ensureZernioProfile, getZernioConnectUrl, ZERNIO_CONNECT_PLATFORMS, ZernioError } from '../_shared/zernio.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

/** The calling app's origin when it is a usable app address (https, or localhost in dev). */
function appOrigin(req: Request): string {
  const raw = req.headers.get('origin') || req.headers.get('referer');
  if (raw) {
    try {
      const url = new URL(raw);
      if (url.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(url.hostname)) return url.origin;
    } catch {
      // not a URL: fall back to the default
    }
  }
  return APP_URL;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400); }
  const orgId = typeof body.organization_id === 'string' ? body.organization_id : '';
  const platform = typeof body.platform === 'string' ? body.platform.toLowerCase() : '';
  try {
    await assertOrgAccess(req, supabase, orgId);
  } catch (authError) {
    return unauthorized(authError, corsHeaders);
  }
  if (!ZERNIO_CONNECT_PLATFORMS.includes(platform)) return json({ success: false, error: `Connecting ${platform || 'that platform'} isn't supported` }, 400);

  const stored = await resolveApiKey(supabase, orgId, 'zernio');
  if (!stored) return json({ success: false, code: 'no_key', error: 'Add your Zernio API key in Settings › API keys first.' }, 400);
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
  if (!encryptionKey) return json({ success: false, error: 'Publishing credentials are not configured' }, 500);

  try {
    const apiKey = await decryptApiKey(stored.key_encrypted, encryptionKey);
    const { data: org } = await supabase.from('organizations').select('name').eq('id', orgId).maybeSingle();
    const profileId = await ensureZernioProfile(apiKey, orgId, org?.name || 'ACA workspace');
    const authUrl = await getZernioConnectUrl(apiKey, profileId, platform, `${appOrigin(req)}/connect/zernio`);
    return json({ success: true, auth_url: authUrl });
  } catch (error) {
    if (error instanceof ZernioError) {
      return json({ success: false, error: error.message, code: error.code }, error.retryable ? 502 : 400);
    }
    // Never log the request: it carries the decrypted key in its headers.
    return json({ success: false, error: error instanceof Error ? error.message : 'Could not start the connection' }, 500);
  }
});
