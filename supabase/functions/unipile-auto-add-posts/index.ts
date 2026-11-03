import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { decryptApiKey, normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { UnipileV2Client } from '../_shared/unipile/v2-client.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { listOwnPosts, ownUserId } from '../_shared/unipile/instagram-v2.ts';
import { assertOrgAccess, isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_PAGES_PER_ACCOUNT = 10;
const POSTS_PER_PAGE = 50;

interface AutoAccountRow {
  id: string;
  campaign_id: string;
  account_id: string;
  last_fetched_at: string | null;
  campaign: {
    id: string;
    organization_id: string;
    is_active: boolean;
    status: string;
  };
  account: {
    id: string;
    unipile_account_id: string;
    username: string | null;
    provider: string;
    access_token_encrypted: string | null;
    dsn_url: string | null;
    status: string;
    api_version: string | null;
    metadata: Record<string, unknown> | null;
  };
}

/**
 * Unipile Auto-Add Posts Edge Function
 *
 * Called by pg_cron every 5 minutes to discover new posts from connected
 * accounts and automatically add them to monitored posts.
 *
 * Accepts optional { campaignId } body param for targeted single-campaign sync
 * (used by frontend on campaign creation/activation and manual "Sync Posts Now").
 * When no campaignId is provided, processes all active auto-account entries (cron path).
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Parse optional campaignId from request body (cron sends empty body)
  let campaignId: string | null = null;
  try {
    const body = await req.json();
    campaignId = body.campaignId || null;
  } catch {
    // Empty body from cron — process all
  }

  if (!campaignId) {
    // A full sync touches every org's accounts: only the pg_cron job (service-role key) runs it.
    if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);
  } else {
    const { data: campaignRow } = await supabase
      .from('unipile_campaigns')
      .select('organization_id')
      .eq('id', campaignId)
      .maybeSingle();
    if (!campaignRow) {
      return new Response(JSON.stringify({ success: false, error: 'Campaign not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, campaignRow.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }
  }

  const jobId = crypto.randomUUID();
  const startTime = Date.now();
  let accountsProcessed = 0;
  let postsDiscovered = 0;
  let postsAdded = 0;
  const errors: string[] = [];

  try {
    console.log(`[Auto-Add Posts] Starting job ${jobId}${campaignId ? ` (campaign: ${campaignId})` : ' (full cron)'}`);

    // Fetch auto-account entries — optionally filtered to a single campaign
    let query = supabase
      .from('unipile_campaign_auto_accounts')
      .select(`
        id,
        campaign_id,
        account_id,
        last_fetched_at,
        campaign:unipile_campaigns!campaign_id(id, organization_id, is_active, status),
        account:unipile_accounts!account_id(id, unipile_account_id, username, provider, access_token_encrypted, dsn_url, status, api_version, metadata)
      `)
      .order('last_fetched_at', { ascending: true, nullsFirst: true });

    if (campaignId) {
      query = query.eq('campaign_id', campaignId);
    }

    const { data: autoAccounts, error: fetchError } = await query;

    if (fetchError) {
      throw new Error(`Failed to fetch auto-account entries: ${fetchError.message}`);
    }

    if (!autoAccounts || autoAccounts.length === 0) {
      console.log('[Auto-Add Posts] No auto-account entries found');
      await logJob(supabase, jobId, 'completed', startTime, { message: 'No auto-account entries' });
      return new Response(JSON.stringify({ success: true, message: 'Nothing to process' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Auto-Add Posts] Found ${autoAccounts.length} auto-account entries`);

    for (const entry of autoAccounts) {
      try {
        const campaign = entry.campaign as unknown as AutoAccountRow['campaign'];
        const account = entry.account as unknown as AutoAccountRow['account'];

        if (!campaign || (campaign.status !== 'active' && !campaign.is_active)) {
          console.log(`[Auto-Add Posts] Skipping entry ${entry.id} - campaign inactive (status: ${campaign?.status})`);
          continue;
        }

        if (!account || account.status !== 'active') {
          console.log(`[Auto-Add Posts] Skipping entry ${entry.id} - account not active`);
          continue;
        }

        // v2 accounts (ACA's platform key, no stored DSN): Instagram only for now. LinkedIn v2 lead
        // magnets still need v2 comment replies in poll-comments, so their posts are not added yet.
        const isV2 = account.api_version === 'v2';
        if (isV2 && account.provider !== 'INSTAGRAM') {
          console.log(`[Auto-Add Posts] Skipping entry ${entry.id} - ${account.provider} v2 lead magnets are not supported yet`);
          continue;
        }

        // Extract LinkedIn provider internal ID from account metadata
        // Docs: "LinkedIn: starts with ACo/ADo for users" — use im.id (provider internal ID), not publicIdentifier
        const connParams = (account.metadata as Record<string, unknown>)?.connection_params as Record<string, unknown> | undefined;
        const imParams = connParams?.im as Record<string, unknown> | undefined;
        const identifier = (imParams?.id || imParams?.publicIdentifier || account.unipile_account_id) as string;

        if (!identifier && !isV2) {
          console.log(`[Auto-Add Posts] Skipping entry ${entry.id} - no identifier found on account`);
          errors.push(`Entry ${entry.id}: Account ${account.id} has no LinkedIn identifier`);
          continue;
        }

        const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
        const posts: Array<Record<string, unknown>> = [];

        if (isV2) {
          try {
            const client = new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) });
            const userId = await ownUserId(client, account.unipile_account_id, account.metadata);
            console.log(`[Auto-Add Posts] Fetching v2 posts for ${account.username ?? account.unipile_account_id} (user ${userId}, campaign ${campaign.id})`);
            posts.push(...await listOwnPosts(client, account.unipile_account_id, userId, 3));
          } catch (v2Err) {
            const msg = v2Err instanceof Error ? v2Err.message : String(v2Err);
            console.error(`[Auto-Add Posts] v2 posts failed for ${account.unipile_account_id}: ${msg}`);
            errors.push(`v2 posts failed for ${account.unipile_account_id}: ${msg}`);
          }
        }

        // Decrypt API key for direct REST calls (v1)
        const unipileApiKey = isV2 ? '' : await decryptApiKey(account.access_token_encrypted!, encryptionKey);
        const unipileDsn = normalizeDsnUrl(account.dsn_url);

        if (!isV2) console.log(`[Auto-Add Posts] Fetching posts for ${account.username} (identifier: ${identifier}, campaign ${campaign.id})`);

        // Use direct REST API (proven pattern from linkedin-post-import)
        let cursor: string | null = null;
        let page = 0;

        while (!isV2 && page < MAX_PAGES_PER_ACCOUNT) {
          try {
            let postsUrl = `${unipileDsn}/api/v1/users/${encodeURIComponent(identifier)}/posts?account_id=${account.unipile_account_id}&limit=${POSTS_PER_PAGE}`;
            if (cursor) {
              postsUrl += `&cursor=${encodeURIComponent(cursor)}`;
            }

            const response = await fetch(postsUrl, {
              headers: {
                'X-API-KEY': unipileApiKey,
                'Accept': 'application/json',
              },
            });

            if (!response.ok) {
              const errorText = await response.text().catch(() => '');
              console.error(`[Auto-Add Posts] REST API returned ${response.status} for ${account.username}: ${errorText.substring(0, 300)}`);
              errors.push(`getAllPosts ${response.status} for ${account.username}: ${errorText.substring(0, 200)}`);

              // Detect dead Unipile session — flip account status so the UI surfaces a reconnect prompt
              // and other crons (poll-comments) skip it instead of looping on a known-bad token.
              if (
                response.status === 401 ||
                errorText.includes('invalid_credentials') ||
                errorText.includes('disconnected_account')
              ) {
                console.warn(`[Auto-Add Posts] Account ${account.id} (${account.username}) credentials invalid — marking disconnected`);
                await supabase
                  .from('unipile_accounts')
                  .update({
                    status: 'disconnected',
                    error_message: 'LinkedIn connection expired. Please reconnect in Settings → Channels.',
                    updated_at: new Date().toISOString(),
                  })
                  .eq('id', account.id);
              }
              break;
            }

            const postsData = await response.json() as { items?: Array<Record<string, unknown>>; cursor?: string | null };
            const pageItems = postsData.items || [];
            posts.push(...pageItems);

            cursor = postsData.cursor || null;
            page++;

            if (!cursor || pageItems.length === 0) {
              break;
            }
          } catch (fetchErr) {
            const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
            console.error(`[Auto-Add Posts] getAllPosts failed for ${account.username}: ${msg}`);
            errors.push(`getAllPosts failed for ${account.username}: ${msg}`);
            break;
          }
        }

        postsDiscovered += posts.length;
        console.log(`[Auto-Add Posts] Found ${posts.length} posts from ${account.username}`);

        if (posts.length === 0) {
          await supabase
            .from('unipile_campaign_auto_accounts')
            .update({ last_fetched_at: new Date().toISOString() })
            .eq('id', entry.id);
          accountsProcessed++;
          continue;
        }

        // Get existing monitored post IDs for this campaign (dedup)
        const { data: existingPosts } = await supabase
          .from('unipile_monitored_posts')
          .select('post_id')
          .eq('campaign_id', campaign.id);

        const existingPostIds = new Set((existingPosts || []).map(p => p.post_id));

        // Filter to only new posts
        const newPosts = posts.filter(post => {
          const postId = post.id as string;
          return postId && !existingPostIds.has(postId);
        });

        console.log(`[Auto-Add Posts] ${newPosts.length} new posts to add`);

        // Build rows for batch insert
        const rows = newPosts.map(post => {
          const author = post.author as Record<string, unknown> | undefined;
          // Extract social_id (provider-native ID like LinkedIn URN) from all possible fields.
          // Required by the comments API — Unipile's internal post_id won't work for engagement endpoints.
          const socialId = (post.social_id as string)
            || (post.urn as string)
            || (post.provider_id as string)
            || (post.socialId as string)
            || null;
          return {
            campaign_id: campaign.id,
            organization_id: campaign.organization_id,
            provider: account.provider,
            post_id: post.id as string,
            social_id: socialId,
            post_url: (post.share_url || '') as string,
            post_title: (post.title as string) || null,
            post_content: ((post.text || '') as string).substring(0, 500) || null,
            post_author_name: (author?.name as string) || null,
            post_author_avatar: (author?.profile_picture_url as string) || null,
            post_created_at: parseRelativeDate((post.parsed_datetime || post.date) as string | undefined),
            source_account_id: account.id,
            is_active: true,
          };
        }).filter(r => r.post_id);

        // Batch insert in chunks of 100 (Supabase limit)
        const BATCH_SIZE = 100;
        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const { error: batchError, count } = await supabase
            .from('unipile_monitored_posts')
            .upsert(batch, { onConflict: 'campaign_id,post_id', ignoreDuplicates: true, count: 'exact' });

          if (batchError) {
            console.error(`[Auto-Add Posts] Batch insert failed: ${batchError.message}`);
            errors.push(`Batch insert failed: ${batchError.message}`);
          } else {
            const added = count || batch.length;
            postsAdded += added;
            console.log(`[Auto-Add Posts] Batch ${Math.floor(i / BATCH_SIZE) + 1}: inserted ${added} posts`);
          }
        }

        // Update last fetched timestamp on the junction row
        await supabase
          .from('unipile_campaign_auto_accounts')
          .update({ last_fetched_at: new Date().toISOString() })
          .eq('id', entry.id);

        accountsProcessed++;
      } catch (entryError) {
        const msg = entryError instanceof Error ? entryError.message : 'Unknown error';
        console.error(`[Auto-Add Posts] Error processing entry ${entry.id}:`, entryError);
        errors.push(`Entry ${entry.id}: ${msg}`);
      }
    }

    await logJob(supabase, jobId, 'completed', startTime, {
      accountsProcessed,
      postsDiscovered,
      postsAdded,
      errors: errors.length > 0 ? errors : undefined,
    });

    console.log(`[Auto-Add Posts] Job ${jobId} completed: ${accountsProcessed} accounts, ${postsDiscovered} discovered, ${postsAdded} added`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      accountsProcessed,
      postsDiscovered,
      postsAdded,
      errors: errors.length > 0 ? errors : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Auto-Add Posts] Fatal error:', error);

    await logJob(supabase, jobId, 'failed', startTime, {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

/**
 * Convert Unipile relative date strings ("3w", "1mo", "1yr") to ISO timestamps.
 * Returns null if the string can't be parsed.
 */
function parseRelativeDate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;

  // Already an ISO date? Return as-is
  if (dateStr.match(/^\d{4}-\d{2}/)) return dateStr;

  const now = new Date();
  const match = dateStr.match(/^(\d+)(m|h|d|w|mo|yr)$/);
  if (!match) return null;

  const amount = parseInt(match[1]);
  const unit = match[2];

  switch (unit) {
    case 'm':  now.setMinutes(now.getMinutes() - amount); break;
    case 'h':  now.setHours(now.getHours() - amount); break;
    case 'd':  now.setDate(now.getDate() - amount); break;
    case 'w':  now.setDate(now.getDate() - amount * 7); break;
    case 'mo': now.setMonth(now.getMonth() - amount); break;
    case 'yr': now.setFullYear(now.getFullYear() - amount); break;
    default:   return null;
  }

  return now.toISOString();
}

/**
 * Log job execution
 */
async function logJob(
  supabase: SupabaseClient<any>,
  _jobId: string,
  status: string,
  startTime: number,
  result: Record<string, unknown>
) {
  const duration = Date.now() - startTime;

  await supabase.from('unipile_job_logs').insert({
    job_type: 'auto_add_posts',
    status,
    items_processed: (result.accountsProcessed as number) || 0,
    items_created: (result.postsAdded as number) || 0,
    items_failed: 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors } : null,
    duration_ms: duration,
  });
}
