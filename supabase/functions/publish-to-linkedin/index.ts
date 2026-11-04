import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';
import { checkFeatureAccess } from '../_shared/featureAccess.ts';
import { createUnipileClientFromAccount, parseUnipileError } from '../_shared/unipile-client.ts';
import { parseLinkedInDestination, assertLinkedInPageAccess, LinkedInIdentityError } from '../_shared/linkedin-identity.ts';
import { buildLinkedInContent, normalizeLinkedInContent, publishLinkedInPost, LinkedInPublishValidationError, type LinkedInPublishResult } from '../_shared/linkedin-publishing.ts';
import { UnipileV2Client } from '../_shared/unipile/v2-client.ts';
import { isUnipileApiError } from '../_shared/unipile/errors.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { assertCompanyPageAccessV2, publishLinkedInPostV2 } from '../_shared/unipile/posts-v2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
});

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ success: false, error: 'Method not allowed' }, 405);
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    let parsedBody: unknown;
    try { parsedBody = await req.json(); } catch { return json({ success: false, error: 'Invalid JSON body' }, 400); }
    const body = parsedBody && typeof parsedBody === 'object' && !Array.isArray(parsedBody) ? parsedBody as Record<string, unknown> : {};
    if (typeof body.account_id !== 'string' || typeof body.output_id !== 'string' || !body.output_id) {
      return json({ success: false, error: 'account_id and output_id are required' }, 400);
    }
    const destination = parseLinkedInDestination(body.account_id);
    if (!destination) return json({ success: false, error: 'Invalid LinkedIn publishing account' }, 400);
    const { data: account } = await supabase.from('unipile_accounts')
      .select('id, organization_id, unipile_account_id, display_name, access_token_encrypted, dsn_url, api_version')
      .eq('id', destination.accountId).eq('provider', 'LINKEDIN').eq('status', 'active').maybeSingle();
    if (!account) return json({ success: false, error: 'Active LinkedIn account not found' }, 404);
    try { await assertOrgAccess(req, supabase, account.organization_id); }
    catch (authError) { return unauthorized(authError, corsHeaders); }
    if (body.organization_id && body.organization_id !== account.organization_id) {
      return json({ success: false, error: 'Account does not belong to the selected organization' }, 403);
    }
    // Content overrides never bypass ownership of the referenced output.
    const { data: output } = await supabase.from('content_outputs').select('id, data, stage_data, pipeline')
      .eq('id', body.output_id).eq('organization_id', account.organization_id).maybeSingle();
    if (!output) return json({ success: false, error: 'Content output not found' }, 404);
    const feature = await checkFeatureAccess(supabase, account.organization_id, 'publishing');
    if (!feature.allowed) return json({ success: false, error: feature.reason }, 403);
    if (body.queue_id !== undefined) {
      if (typeof body.queue_id !== 'string') return json({ success: false, error: 'Invalid queue_id' }, 400);
      const { data: queue } = await supabase.from('publish_queue').select('id, status')
        .eq('id', body.queue_id).eq('organization_id', account.organization_id)
        .eq('account_id', body.account_id).eq('output_id', output.id).maybeSingle();
      if (!queue) return json({ success: false, error: 'Publication queue item not found' }, 404);
      if (queue.status === 'published') return json({ success: true, already_published: true });
      if (queue.status !== 'publishing') return json({ success: false, error: 'Publication queue item is not claimed for publishing' }, 409);
    }
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) return json({ success: false, error: 'Publishing credentials are not configured' }, 500);
    // v2 accounts (Unipile hosted auth since 2026-10-23) have no v1 token or DSN: they go through
    // the v2 API with the org's key copy or the platform key.
    const isV2 = account.api_version === 'v2';
    const v2 = isV2 ? new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) }) : null;
    const client = isV2 ? null : await createUnipileClientFromAccount({ accessTokenEncrypted: account.access_token_encrypted, dsnUrl: account.dsn_url }, encryptionKey);
    if (destination.organizationId) {
      if (v2) await assertCompanyPageAccessV2(v2, account.unipile_account_id, destination.organizationId);
      else await assertLinkedInPageAccess(client!, account.unipile_account_id, destination.organizationId);
    }
    const content = body.content === undefined ? buildLinkedInContent(output) : normalizeLinkedInContent(body.content);
    if (body.schedule_for !== undefined) {
      const scheduledAt = typeof body.schedule_for === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(body.schedule_for) ? new Date(body.schedule_for) : new Date(NaN);
      if (!Number.isFinite(scheduledAt.getTime()) || scheduledAt.getTime() <= Date.now()) {
        return json({ success: false, error: 'schedule_for must be a future ISO timestamp' }, 400);
      }
      const { data: queued, error } = await supabase.from('publish_queue').insert({
        organization_id: account.organization_id,
        output_id: output.id,
        account_id: body.account_id,
        platform: 'linkedin',
        scheduled_for: scheduledAt.toISOString(),
        status: 'pending',
        publish_content: content,
      }).select('id').single();
      if (error) return json({ success: false, error: 'Could not schedule LinkedIn publication' }, 500);
      return json({ success: true, scheduled: true, queue_id: queued.id });
    }
    const record = async (published: LinkedInPublishResult) => {
      const { error } = await supabase.from('ghl_published_posts').insert({
        content_output_id: output.id,
        organization_id: account.organization_id,
        platform: 'linkedin',
        platform_account_id: body.account_id,
        platform_account_name: destination.organizationId ? `LinkedIn page ${destination.organizationId}` : account.display_name || 'LinkedIn profile',
        ghl_post_id: published.post_id || null,
        status: 'published',
        published_at: new Date().toISOString(),
      });
      // Persist queue completion before optional first-comment work. Retrying a claimed
      // item after a worker timeout will see this status and avoid publishing again.
      let queueError = null;
      if (body.queue_id) {
        const queueResult = await supabase.from('publish_queue').update({ status: 'published', published_at: new Date().toISOString() })
          .eq('id', body.queue_id).eq('organization_id', account.organization_id)
          .eq('account_id', body.account_id).eq('output_id', output.id).eq('status', 'publishing');
        queueError = queueResult.error;
      }
      if (error || queueError) throw new Error('Publication tracking failed');
    };
    const result = v2
      ? await publishLinkedInPostV2(v2, account.unipile_account_id, destination.organizationId, content, record)
      : await publishLinkedInPost(client!, account.unipile_account_id, destination.organizationId, content, record);
    return json({ success: true, ...result });
  } catch (error) {
    if (error instanceof LinkedInIdentityError || error instanceof LinkedInPublishValidationError) {
      return json({ success: false, error: error.message }, error.status);
    }
    if (isUnipileApiError(error)) {
      // v2 errors carry no credentials; status null means the request never got an answer.
      return json({ success: false, error: error.message, code: error.code, retryable: error.retryable }, error.status || (error.retryable ? 502 : 400));
    }
    const parsed = parseUnipileError(error);
    // Never log SDK objects: their request metadata can contain credential headers.
    return json({ success: false, error: parsed.message, code: parsed.code, retryable: parsed.retryable }, parsed.status || (parsed.retryable ? 502 : 400));
  }
});
