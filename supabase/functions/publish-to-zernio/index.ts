/**
 * Publishes one Scheduler queue row through the organization's own Zernio account (BYOK:
 * api_keys.provider = 'zernio'). Covers Facebook, Instagram, TikTok, Google Business, YouTube,
 * Threads, Pinterest, LinkedIn, X and Bluesky without GHL.
 *
 * POST { account_id: "zernio:<Zernio account id>", platform, organization_id, output_id, content, queue_id }
 * → { success: true, url?, post_id?, pending? } | { success: false, error } (502/429 when worth retrying)
 *
 * The queue row id is Zernio's Idempotency-Key, so a retry after a worker timeout returns the
 * original post instead of publishing again.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { checkFeatureAccess } from '../_shared/featureAccess.ts';
import { resolveApiKey } from '../_shared/resolve-api-key.ts';
import { decryptApiKey } from '../_shared/unipile-client.ts';
import { buildZernioPost, parseZernioDestination, publishToZernio, ZernioError, type ZernioContent } from '../_shared/zernio.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});
const str = (v: unknown) => (typeof v === 'string' && v ? v : null);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  let body: Record<string, unknown>;
  try {
    const parsed = await req.json();
    body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, 400);
  }
  const orgId = str(body.organization_id);
  const outputId = str(body.output_id);
  const platform = str(body.platform);
  const accountId = parseZernioDestination(str(body.account_id));
  if (!orgId || !outputId || !platform) return json({ success: false, error: 'organization_id, output_id and platform are required' }, 400);
  if (!accountId) return json({ success: false, error: 'Invalid Zernio publishing account' }, 400);
  try {
    await assertOrgAccess(req, supabase, orgId);
  } catch (authError) {
    return unauthorized(authError, corsHeaders);
  }

  try {
    const { data: output } = await supabase.from('content_outputs').select('id')
      .eq('id', outputId).eq('organization_id', orgId).maybeSingle();
    if (!output) return json({ success: false, error: 'Content output not found' }, 404);
    const feature = await checkFeatureAccess(supabase, orgId, 'publishing');
    if (!feature.allowed) return json({ success: false, error: feature.reason }, 403);

    const queueId = str(body.queue_id);
    if (body.queue_id !== undefined && !queueId) return json({ success: false, error: 'Invalid queue_id' }, 400);
    if (queueId) {
      const { data: queue } = await supabase.from('publish_queue').select('id, status')
        .eq('id', queueId).eq('organization_id', orgId)
        .eq('account_id', body.account_id).eq('output_id', outputId).maybeSingle();
      if (!queue) return json({ success: false, error: 'Publication queue item not found' }, 404);
      if (queue.status === 'published') return json({ success: true, already_published: true });
      if (queue.status !== 'publishing') return json({ success: false, error: 'Publication queue item is not claimed for publishing' }, 409);
    }

    const stored = await resolveApiKey(supabase, orgId, 'zernio');
    if (!stored) return json({ success: false, error: 'No Zernio API key. Add one in Settings › API keys.' }, 400);
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) return json({ success: false, error: 'Publishing credentials are not configured' }, 500);
    const apiKey = await decryptApiKey(stored.key_encrypted, encryptionKey);

    const content = (body.content && typeof body.content === 'object' ? body.content : {}) as ZernioContent;
    const payload = buildZernioPost(platform, accountId, content, { aca_output_id: outputId, ...(queueId ? { aca_queue_id: queueId } : {}) });
    const outcome = await publishToZernio(apiKey, payload, accountId, queueId ?? `${outputId}:${accountId}`);
    if (outcome.state === 'failed') {
      return json({ success: false, error: outcome.error, retryable: outcome.retryable }, outcome.retryable ? 502 : 400);
    }

    const now = new Date().toISOString();
    const { error: trackError } = await supabase.from('ghl_published_posts').insert({
      content_output_id: outputId,
      organization_id: orgId,
      platform: platform.toLowerCase(),
      platform_account_id: body.account_id,
      platform_account_name: 'Zernio',
      ghl_post_id: (outcome.state === 'published' && outcome.platformPostId) || outcome.postId || null,
      status: 'published',
      published_at: now,
    });
    if (trackError) console.warn('[publish-to-zernio] tracking insert failed:', trackError.message);
    // Persist completion here too: a worker that times out after this point retries a
    // published row, which then short-circuits on 'published' above.
    if (queueId) {
      await supabase.from('publish_queue').update({ status: 'published', published_at: now })
        .eq('id', queueId).eq('organization_id', orgId).eq('status', 'publishing');
    }
    return json({
      success: true,
      post_id: outcome.postId,
      ...(outcome.state === 'published' && outcome.url ? { url: outcome.url } : {}),
      ...(outcome.state === 'pending'
        ? { pending: true, warning: 'Zernio accepted the post but was still processing the media; check it in Zernio.' }
        : {}),
    });
  } catch (error) {
    if (error instanceof ZernioError) {
      return json({ success: false, error: error.message, code: error.code }, error.retryable ? (error.status === 429 ? 429 : 502) : 400);
    }
    // Never log the request: it carries the decrypted key in its headers.
    return json({ success: false, error: error instanceof Error ? error.message : 'Zernio publishing failed' }, 500);
  }
});
