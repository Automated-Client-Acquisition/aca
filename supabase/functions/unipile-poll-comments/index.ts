import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient , type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  decryptApiKey,
  UnipileComment,
  UnipileCommentListResponse,
  isLinkedInComment,
  isInstagramComment,
  normalizeDsnUrl,
} from '../_shared/unipile-client.ts';
import {
  scoreLead,
  generateInitialAiMessage,
  buildChatbotSystemPrompt,
} from '../_shared/icp-scorer.ts';
import { buildLeadDmMessage, buildLeadMagnetGateUrl } from '../_shared/lead-magnet-link.ts';
import { isOllamaModel } from '../_shared/llm-client.ts';
import { DEFAULT_FAST_TEXT_MODEL, chatbotModel } from '../_shared/default-models.ts';
import { UnipileV2Client } from '../_shared/unipile/v2-client.ts';
import { isUnipileApiError } from '../_shared/unipile/errors.ts';
import { v2ApiKeyForAccount } from '../_shared/unipile/v2-accounts.ts';
import { listPostComments, resolveMessagingId } from '../_shared/unipile/instagram-v2.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Types for campaigns with new fields
interface Campaign {
  id: string;
  organization_id: string;
  trigger_keywords: string;
  dm_template: string;
  dm_delay_seconds: number;
  user_cooldown_hours: number;
  webhook_url: string | null;
  is_active: boolean;
  status: string;
  require_connection_for_linkedin: boolean;
  auto_send_on_connection: boolean;
  comment_reply_templates: string[] | null;
  comment_link_mode: 'gated' | 'direct';
  lead_magnet_url: string | null;
  // ICP scoring
  icp_id: string | null;
  icp_threshold: number;
  // AI chatbot
  ai_chatbot_enabled: boolean;
  ai_chatbot_instructions: string | null;
  ai_chatbot_brand_voice_id: string | null;
  ai_chatbot_model: string | null;
  ai_chatbot_max_turns: number;
  ai_chatbot_handoff_keywords: string[] | null;
  // Joined relations
  account: {
    id: string;
    access_token_encrypted: string | null;
    dsn_url: string | null;
    status: string;
    unipile_account_id: string;
    api_version?: string | null;
  };
  icp?: {
    id: string;
    name: string;
    description: string | null;
    pain_points: string[] | null;
    desires: string[] | null;
    objections: string[] | null;
    language_style: string | null;
    tags: string[] | null;
  } | null;
  brand_voice?: {
    id: string;
    tone: string | null;
    personality: string | null;
    writing_examples: string[] | null;
  } | null;
}

/**
 * Unipile Poll Comments Edge Function
 *
 * Called by pg_cron every 2 minutes to poll for new comments on monitored posts.
 * Uses the official Unipile SDK.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const jobId = crypto.randomUUID();
  const startTime = Date.now();
  let postsProcessed = 0;
  let commentsFound = 0;
  let leadsCreated = 0;
  let dmsQueued = 0;
  let commentReplies = 0;
  let icpScored = 0;
  let icpFiltered = 0;
  let aiConversationsStarted = 0;
  const errors: string[] = [];
  const debugPostComments: Record<string, { postUrl: string; keyword: string; comments: unknown[] }> = {};
  // Track accounts confirmed disconnected this run — skip remaining posts for them
  const disconnectedAccountIds = new Set<string>();
  // Unipile v2 rate-limits each account per route (about 10 comment reads a minute), and this job runs
  // every 2 minutes: read at most V2_COMMENT_READS_PER_RUN posts per v2 account, stop at the first 429.
  // Skipped posts keep their last_polled_at, so they come first next run.
  const V2_COMMENT_READS_PER_RUN = 8;
  const v2CommentReads = new Map<string, number>();
  const v2RateLimited = new Set<string>();

  try {
    console.log(`[Poll Comments] Starting job ${jobId}`);

    // Two-tier fetch so a long tail of old, dead posts (auto_add_posts pulls in a
    // creator's entire history) can't starve freshly-published posts of poll budget.
    // Recent posts (where new comments are actually likely) get a reserved slice of
    // the per-run budget and are polled oldest-first within that slice; whatever's
    // left over is filled from the rest of the queue so old posts still eventually
    // get their turn.
    const POST_SELECT = `
        *,
        campaign:unipile_campaigns(
          *,
          account:unipile_accounts(*),
          icp:library_icps(*),
          brand_voice:library_brand_voices(*)
        ),
        source_account:unipile_accounts!source_account_id(*)
      `;
    const TOTAL_BUDGET = 80;
    const RECENT_BUDGET = 60;
    const RECENT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000; // 14 days
    const recentCutoff = new Date(Date.now() - RECENT_WINDOW_MS).toISOString();
    const oldestAllowedCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(); // 12 months

    const { data: recentPosts, error: recentPostsError } = await supabase
      .from('unipile_monitored_posts')
      .select(POST_SELECT)
      .eq('is_active', true)
      .gte('post_created_at', recentCutoff)
      .order('last_polled_at', { ascending: true, nullsFirst: true })
      .limit(RECENT_BUDGET);

    if (recentPostsError) {
      throw new Error(`Failed to fetch recent posts: ${recentPostsError.message}`);
    }

    const remainingBudget = TOTAL_BUDGET - (recentPosts?.length || 0);
    let olderPosts: typeof recentPosts = [];
    if (remainingBudget > 0) {
      const { data, error: olderPostsError } = await supabase
        .from('unipile_monitored_posts')
        .select(POST_SELECT)
        .eq('is_active', true)
        .gte('post_created_at', oldestAllowedCutoff)
        .lt('post_created_at', recentCutoff)
        .order('last_polled_at', { ascending: true, nullsFirst: true })
        .limit(remainingBudget);

      if (olderPostsError) {
        throw new Error(`Failed to fetch older posts: ${olderPostsError.message}`);
      }
      olderPosts = data;
    }

    const posts = [...(recentPosts || []), ...(olderPosts || [])];

    if (!posts || posts.length === 0) {
      console.log('[Poll Comments] No active posts to poll');
      await logJob(supabase, jobId, 'completed', startTime, { message: 'No active posts' });
      return new Response(JSON.stringify({ success: true, message: 'No posts to poll' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`[Poll Comments] Found ${posts.length} posts to poll (${recentPosts?.length || 0} recent, ${olderPosts?.length || 0} older)`);

    for (const post of posts) {
      try {
        const campaign = post.campaign as Campaign;
        if (!campaign || (campaign.status !== 'active' && !campaign.is_active)) {
          console.log(`[Poll Comments] Skipping post ${post.id} - campaign inactive (status: ${campaign?.status})`);
          // Update last_polled_at to prevent queue starvation
          await supabase.from('unipile_monitored_posts').update({ last_polled_at: new Date().toISOString() }).eq('id', post.id);
          continue;
        }

        // Use source_account (for auto-added posts) or fall back to campaign account
        const sourceAccount = post.source_account as typeof campaign.account | null;
        const account = (sourceAccount && sourceAccount.status === 'active') ? sourceAccount : campaign.account;
        if (!account || account.status !== 'active') {
          console.log(`[Poll Comments] Skipping post ${post.id} - account not active`);
          // Update last_polled_at to prevent queue starvation
          await supabase.from('unipile_monitored_posts').update({ last_polled_at: new Date().toISOString() }).eq('id', post.id);
          continue;
        }

        // Skip if this account was already confirmed disconnected during this run
        if (disconnectedAccountIds.has(account.id)) {
          await supabase.from('unipile_monitored_posts').update({ last_polled_at: new Date().toISOString() }).eq('id', post.id);
          continue;
        }

        // v2 accounts run on ACA's platform key and have no stored DSN. Instagram is ported (comments
        // in, DM out, no public reply); LinkedIn v2 still needs v2 comment replies, so it waits.
        const isV2 = account.api_version === 'v2';
        if (isV2 && post.provider !== 'INSTAGRAM') {
          console.log(`[Poll Comments] Skipping post ${post.id} - ${post.provider} v2 lead magnets are not supported yet`);
          await supabase.from('unipile_monitored_posts').update({ last_polled_at: new Date().toISOString() }).eq('id', post.id);
          continue;
        }

        if (isV2 && (v2RateLimited.has(account.id) || (v2CommentReads.get(account.id) ?? 0) >= V2_COMMENT_READS_PER_RUN)) {
          continue;
        }
        if (isV2) v2CommentReads.set(account.id, (v2CommentReads.get(account.id) ?? 0) + 1);

        // Get API credentials
        const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
        const v2Client = isV2 ? new UnipileV2Client({ apiKey: await v2ApiKeyForAccount(account, encryptionKey) }) : null;
        const unipileApiKey = isV2 ? '' : await decryptApiKey(account.access_token_encrypted!, encryptionKey);
        const unipileDsn = normalizeDsnUrl(account.dsn_url);

        // SDK client no longer needed — using direct REST API for comment replies

        // Fetch OpenRouter key once (used for ICP scoring + AI comment replies)
        let openRouterKey: string | null = null;
        try {
          const { data: apiKeyData } = await supabase
            .from('api_keys')
            .select('key_encrypted')
            .eq('organization_id', campaign.organization_id)
            .eq('provider', 'openrouter')
            .single();
          if (apiKeyData) {
            openRouterKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);
          }
        } catch (_) { /* non-fatal */ }

        // Use social_id for the comments API (post_id is the activity ID, social_id is what Unipile needs)
        const commentPostId = post.social_id || post.post_id;
        const startCursor = post.last_comment_cursor || null;
        console.log(`[Poll Comments] Fetching comments for post ${post.post_id} (social_id: ${commentPostId}, cursor: ${startCursor || 'none'})`);

        let allComments: UnipileComment[];
        let lastCursor: string | null;
        try {
          const result = v2Client
            ? await listPostComments(v2Client, account.unipile_account_id, commentPostId, startCursor)
            : await fetchAllCommentsRest(
              unipileDsn,
              unipileApiKey,
              account.unipile_account_id,
              commentPostId,
              startCursor
            );
          allComments = result.comments;
          lastCursor = result.lastCursor;
        } catch (fetchError) {
          const errMsg = fetchError instanceof Error ? fetchError.message : String(fetchError);
          console.error(`[Poll Comments] Failed to fetch comments for post ${post.post_id} (commentPostId: ${commentPostId}):`, errMsg);

          // v2 rate limit: not this post's fault. Leave it unpolled and stop reading this account this run.
          if (isV2 && isUnipileApiError(fetchError) && fetchError.code === 'RATE_LIMITED') {
            v2RateLimited.add(account.id);
            continue;
          }
          errors.push(`Post ${post.post_id}: ${errMsg}`);

          // Detect disconnected account — update DB status and skip remaining posts for this account.
          // Not for v2: they share ACA's platform key, so an auth error there is the key, not this account
          // (v2 account status comes from the account.* webhooks).
          if (
            !isV2 && (errMsg.includes('disconnected_account') ||
            errMsg.includes('Disconnected account') ||
            errMsg.includes('invalid_credentials') ||
            errMsg.includes('invalid_authorization') ||
            errMsg.includes(' 401'))
          ) {
            console.warn(`[Poll Comments] Account ${account.id} is disconnected at Unipile — marking in DB and skipping remaining posts`);
            disconnectedAccountIds.add(account.id);
            await supabase.from('unipile_accounts')
              .update({
                status: 'disconnected',
                error_message: 'Account disconnected from provider. Please reconnect in Settings.',
                updated_at: new Date().toISOString(),
              })
              .eq('id', account.id);
          }

          // Update last_polled_at even on failure to prevent queue starvation
          await supabase
            .from('unipile_monitored_posts')
            .update({
              last_polled_at: new Date().toISOString(),
              error_message: errMsg.substring(0, 500),
              error_count: (post.error_count || 0) + 1,
            })
            .eq('id', post.id);
          continue;
        }

        commentsFound += allComments.length;
        console.log(`[Poll Comments] Found ${allComments.length} comments on post ${post.post_id}`);

        // Debug info
        debugPostComments[post.post_id] = {
          postUrl: post.post_url,
          keyword: campaign.trigger_keywords,
          comments: allComments.slice(0, 5).map((c: UnipileComment) => {
            const data = extractCommentData(c, post.provider);
            return {
              text: c.text || '',
              commentId: data?.commentId,
              commenterId: data?.commenterId,
              commenterName: data?.commenterName,
              networkDistance: data?.networkDistance,
            };
          }),
        };

        // Parse trigger keywords
        const triggerKeywords = campaign.trigger_keywords
          .split(',')
          .map((k: string) => k.trim().toLowerCase())
          .filter((k: string) => k.length > 0);

        // Process each comment
        for (const comment of allComments) {
          const commentText = (comment.text || '').toLowerCase();
          const extracted = extractCommentData(comment, post.provider);

          if (!extracted || !extracted.commenterId) {
            console.warn(`[Poll Comments] Could not extract commenter ID from comment`);
            continue;
          }

          const { commentId, commenterName, commenterHeadline, commenterProfileUrl, commenterPublicIdentifier, commentedAt, networkDistance } = extracted;
          let commenterId = extracted.commenterId;

          // Check if comment matches trigger keywords
          const matchedKeyword = triggerKeywords.find((keyword: string) =>
            commentText.includes(keyword)
          );

          if (!matchedKeyword) {
            continue;
          }

          console.log(`[Poll Comments] Matched keyword "${matchedKeyword}" in comment by ${commenterName}`);

          // Check if we already captured this comment
          const { data: existingLead } = await supabase
            .from('unipile_leads')
            .select('id, status')
            .eq('campaign_id', campaign.id)
            .eq('comment_id', commentId)
            .maybeSingle();

          if (existingLead) {
            if (existingLead.status === 'comment_reply_failed') {
              // Retry: re-attempt the comment reply for this lead
              console.log(`[Poll Comments] Retrying failed comment reply for lead ${existingLead.id}`);
              const retryReplyResult = await replyToCommentAskingToConnect(
                unipileDsn,
                unipileApiKey,
                account.unipile_account_id,
                commentPostId,
                commentId,
                campaign.comment_reply_templates,
                String(commenterName),
                String(commenterId),
                matchedKeyword,
                comment.text || '',
                openRouterKey,
                supabaseUrl,
                campaign.brand_voice,
                campaign.ai_chatbot_model,
              );

              if (retryReplyResult.success) {
                await supabase
                  .from('unipile_leads')
                  .update({
                    status: 'awaiting_connection',
                    comment_reply_text: retryReplyResult.replyText,
                    comment_replied_at: new Date().toISOString(),
                    dm_error: null,
                  })
                  .eq('id', existingLead.id);
                commentReplies++;
                console.log(`[Poll Comments] Retry successful — now awaiting connection`);
              } else {
                console.error(`[Poll Comments] Retry failed: ${retryReplyResult.error}`);
                await supabase
                  .from('unipile_leads')
                  .update({ dm_error: `Comment reply retry failed: ${retryReplyResult.error}` })
                  .eq('id', existingLead.id);
              }
              continue;
            }
            console.log(`[Poll Comments] Comment ${commentId} already captured`);
            continue;
          }

          // v2 Instagram DMs go to the messaging identifier, and inbound replies are matched to the
          // lead by it, so it becomes the lead's commenter_id (the profile id would match nothing).
          if (v2Client && isInstagramComment(comment)) {
            try {
              const messagingId = await resolveMessagingId(v2Client, account.unipile_account_id, comment);
              if (!messagingId) {
                console.warn(`[Poll Comments] No messaging identifier for ${commenterName}; retrying next poll`);
                continue;
              }
              commenterId = messagingId;
            } catch (resolveErr) {
              // No lead yet, so the comment is read again next poll (a lead with the profile id could never be DMed).
              console.warn(`[Poll Comments] Messaging identifier lookup failed for ${commenterName}; retrying next poll:`, resolveErr);
              continue;
            }
          }

          // Check if this commenter already has a lead for this post (1 person + 1 post = 1 lead max)
          const { data: existingPostLead } = await supabase
            .from('unipile_leads')
            .select('id')
            .eq('campaign_id', campaign.id)
            .eq('commenter_id', commenterId)
            .eq('post_id', post.id)
            .maybeSingle();

          if (existingPostLead) {
            console.log(`[Poll Comments] User ${commenterId} already captured for post ${post.id}`);
            continue;
          }

          // Check user cooldown across posts
          const cooldownHours = campaign.user_cooldown_hours || 24;
          const cooldownTime = new Date(Date.now() - cooldownHours * 60 * 60 * 1000).toISOString();

          const { data: recentLead } = await supabase
            .from('unipile_leads')
            .select('id')
            .eq('campaign_id', campaign.id)
            .eq('commenter_id', commenterId)
            .gte('captured_at', cooldownTime)
            .maybeSingle();

          if (recentLead) {
            console.log(`[Poll Comments] User ${commenterId} in cooldown period`);
            continue;
          }

          // Create lead record
          const { data: lead, error: leadError } = await supabase
            .from('unipile_leads')
            .insert({
              organization_id: campaign.organization_id,
              campaign_id: campaign.id,
              post_id: post.id,
              commenter_id: commenterId,
              commenter_name: commenterName,
              commenter_profile_url: commenterProfileUrl,
              commenter_public_identifier: commenterPublicIdentifier || null,
              comment_id: commentId,
              comment_text: comment.text || '',
              matched_keyword: matchedKeyword,
              status: 'pending',
              sender_account_id: account.id,
            })
            .select()
            .single();

          if (leadError) {
            console.error(`[Poll Comments] Failed to create lead: ${leadError.message}`);
            errors.push(`Lead creation failed: ${leadError.message}`);
            continue;
          }

          leadsCreated++;
          console.log(`[Poll Comments] Created lead ${lead.id}`);

          // Sync lead to CRM
          try {
            const { data: syncResult, error: syncError } = await supabase.rpc('sync_lead_to_crm', {
              p_lead_id: lead.id
            });

            if (syncError) {
              console.error(`[Poll Comments] Failed to sync lead to CRM: ${syncError.message}`);
            } else {
              console.log(`[Poll Comments] Lead ${lead.id} synced to CRM contact ${syncResult}`);
            }
          } catch (syncErr) {
            console.error(`[Poll Comments] CRM sync error:`, syncErr);
          }

          // ── ICP Scoring (if configured) ──
          if (campaign.icp_id && campaign.icp) {
            try {
              await supabase.from('unipile_leads').update({ status: 'scoring' }).eq('id', lead.id);

              if (openRouterKey) {
                const scoreResult = await scoreLead({
                  commenterName: String(commenterName),
                  commenterHeadline: commenterHeadline,
                  commentText: comment.text || '',
                  commenterProfileUrl: commenterProfileUrl,
                  icpDefinition: campaign.icp,
                }, openRouterKey, supabaseUrl);

                await supabase.from('unipile_leads').update({
                  icp_score: scoreResult.score,
                  icp_score_reasoning: scoreResult.reasoning,
                  icp_scored_at: new Date().toISOString(),
                  status: 'pending',
                }).eq('id', lead.id);

                icpScored++;
                console.log(`[Poll Comments] ICP score for ${commenterName}: ${scoreResult.score}/100 — ${scoreResult.reasoning}`);

                // Check threshold
                if (campaign.icp_threshold > 0 && scoreResult.score < campaign.icp_threshold) {
                  await supabase.from('unipile_leads').update({ status: 'low_icp' }).eq('id', lead.id);
                  icpFiltered++;
                  console.log(`[Poll Comments] Lead ${lead.id} below ICP threshold (${scoreResult.score} < ${campaign.icp_threshold}), skipping`);
                  continue;
                }
              } else {
                console.warn(`[Poll Comments] No OpenRouter API key configured, skipping ICP scoring`);
                await supabase.from('unipile_leads').update({ status: 'pending' }).eq('id', lead.id);
              }
            } catch (icpError) {
              console.error(`[Poll Comments] ICP scoring failed, proceeding without score:`, icpError);
              await supabase.from('unipile_leads').update({ status: 'pending' }).eq('id', lead.id);
              errors.push(`ICP scoring failed: ${icpError instanceof Error ? icpError.message : 'Unknown error'}`);
            }
          }

          // ── Helper: send DM (template first if available, then AI chatbot for follow-ups) ──
          const sendDmOrStartAi = async (): Promise<boolean> => {
            if (campaign.ai_chatbot_enabled && campaign.ai_chatbot_instructions) {
              // When both AI chatbot AND a DM template exist:
              // 1. Send the template DM first (contains lead magnet link)
              // 2. Activate AI chatbot to handle follow-up replies
              if (campaign.dm_template) {
                const queueResult = await queueDmForLead(
                  supabase, lead, campaign, String(commenterName), matchedKeyword, supabaseUrl, account.id
                );
                if (queueResult.success) {
                  dmsQueued++;
                  // Build the resolved template message for conversation seeding
                  const resolvedMessage = buildLeadDmMessage({
                    template: campaign.dm_template,
                    commenterName: String(commenterName),
                    matchedKeyword,
                    leadId: lead.id,
                    leadMagnetUrl: campaign.lead_magnet_url,
                    supabaseUrl,
                  });
                  // Create AI chatbot conversation seeded with the template DM (no AI generation)
                  const aiResult = await initiateAiChatbot(
                    supabase, lead, campaign, String(commenterName), commenterHeadline, comment.text || '',
                    supabaseUrl, account.id, resolvedMessage
                  );
                  if (aiResult.success) {
                    aiConversationsStarted++;
                    console.log(`[Poll Comments] Template DM queued + AI chatbot activated for follow-ups`);
                  } else {
                    console.warn(`[Poll Comments] Template DM sent but AI chatbot setup failed: ${aiResult.error}`);
                    errors.push(`AI chatbot setup failed: ${aiResult.error}`);
                  }
                  return true;
                }
                // Template DM failed — fall through to pure AI
                console.warn(`[Poll Comments] Template DM queue failed, trying pure AI message`);
              }

              // No template DM — pure AI-generated opening
              const aiResult = await initiateAiChatbot(
                supabase, lead, campaign, String(commenterName), commenterHeadline, comment.text || '', supabaseUrl, account.id
              );
              if (aiResult.success) {
                aiConversationsStarted++;
                return true;
              }
              // Fall back to template DM on AI failure
              console.warn(`[Poll Comments] AI chatbot initiation failed, falling back to template DM: ${aiResult.error}`);
              errors.push(`AI chatbot failed: ${aiResult.error}`);
            }
            const queueResult = await queueDmForLead(
              supabase,
              lead,
              campaign,
              String(commenterName),
              matchedKeyword,
              supabaseUrl,
              account.id
            );
            if (queueResult.success) {
              dmsQueued++;
              return true;
            }
            errors.push(`DM queue failed: ${queueResult.error}`);
            return false;
          };

          // ── Determine platform and handle accordingly ──
          const isLinkedIn = post.provider === 'LINKEDIN';
          const isInstagram = post.provider === 'INSTAGRAM';
          const requiresConnection = isLinkedIn && (campaign.require_connection_for_linkedin !== false);

          // Unipile's live comment/profile payloads use "DISTANCE_1" for first-degree
          // connections, not the "FIRST_DEGREE" label the SDK types document. Accept
          // both so the fast, comment-embedded signal is actually trusted instead of
          // always falling through to the DB lookup / profile-API fallback below.
          const isFirstDegree = (distance: string | null | undefined): boolean =>
            distance === 'FIRST_DEGREE' || distance === 'DISTANCE_1';

          // ── Helper: check if LinkedIn user is connected ──
          const checkIsConnected = async (): Promise<boolean> => {
            let connected = isFirstDegree(networkDistance);
            if (!connected) {
              connected = await checkLinkedInConnection(supabase, campaign.organization_id, String(commenterId));
            }
            if (!connected && commenterId) {
              try {
                const profileUrl = `${unipileDsn}/api/v1/users/${encodeURIComponent(String(commenterId))}?account_id=${account.unipile_account_id}&notify=false`;
                const profileResp = await fetch(profileUrl, {
                  headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
                });
                if (profileResp.ok) {
                  const profileData = await profileResp.json();
                  if (isFirstDegree(profileData.network_distance)) {
                    connected = true;
                    console.log(`[Poll Comments] Unipile profile API confirmed first-degree for ${commenterName}`);
                  }
                } else {
                  console.warn(`[Poll Comments] Profile API returned ${profileResp.status} for ${commenterId} — cannot confirm connection, defaulting to not-connected`);
                }
              } catch (profileErr) {
                console.warn(`[Poll Comments] Profile API check failed for ${commenterId}:`, profileErr);
              }
            }
            return connected;
          };

          if (isInstagram) {
            // Instagram: DM directly (no public reply path here)
            const sent = await sendDmOrStartAi();
            if (sent) {
              console.log(`[Poll Comments] Queued DM/AI for lead ${lead.id}`);
            }
          } else {
            // LinkedIn: ALWAYS post a public comment reply, regardless of connection state.
            // Then, if connected, also DM/start AI chat.
            const isConnected = await checkIsConnected();
            console.log(`[Poll Comments] LinkedIn lead — isConnected=${isConnected}, mode=${campaign.comment_link_mode}, requiresConnection=${requiresConnection}`);

            await supabase
              .from('unipile_leads')
              .update({ is_connected: isConnected, connection_checked_at: new Date().toISOString() })
              .eq('id', lead.id);

            // Direct mode delivers the resource link inline; gated mode asks them to DM the keyword.
            // When the campaign doesn't require connection we treat it as direct delivery.
            const useDirectMode = !requiresConnection || campaign.comment_link_mode === 'direct';

            let replyResult: { success: boolean; replyText?: string; error?: string };
            if (useDirectMode) {
              replyResult = await replyToCommentWithResource(
                unipileDsn,
                unipileApiKey,
                account.unipile_account_id,
                commentPostId,
                commentId,
                String(commenterName),
                String(commenterId),
                comment.text || '',
                lead.id,
                campaign,
                supabaseUrl,
                openRouterKey,
              );
            } else if (isConnected) {
              // Already connected — never claim otherwise. Confirm the DM is on its way instead
              // of asking them to connect (they already are).
              replyResult = await replyToCommentConfirmSent(
                unipileDsn,
                unipileApiKey,
                account.unipile_account_id,
                commentPostId,
                commentId,
                String(commenterName),
                String(commenterId),
                openRouterKey,
                supabaseUrl,
                campaign.brand_voice,
                campaign.ai_chatbot_model,
              );
            } else {
              replyResult = await replyToCommentAskingToConnect(
                unipileDsn,
                unipileApiKey,
                account.unipile_account_id,
                commentPostId,
                commentId,
                campaign.comment_reply_templates,
                String(commenterName),
                String(commenterId),
                matchedKeyword,
                comment.text || '',
                openRouterKey,
                supabaseUrl,
                campaign.brand_voice,
                campaign.ai_chatbot_model,
              );
            }

            let publicReplyOk = false;
            if (replyResult.success) {
              publicReplyOk = true;
              commentReplies++;
              const baseStatus = useDirectMode ? 'resource_delivered' : (isConnected ? 'dm_sent' : 'awaiting_connection');
              await supabase
                .from('unipile_leads')
                .update({
                  status: baseStatus,
                  comment_reply_text: replyResult.replyText,
                  comment_replied_at: new Date().toISOString(),
                })
                .eq('id', lead.id);
              console.log(`[Poll Comments] Public reply posted (${useDirectMode ? 'resource' : (isConnected ? 'confirm-sent' : 'ask-to-DM')})`);
            } else {
              console.error(`[Poll Comments] Public reply failed: ${replyResult.error}`);
              await supabase
                .from('unipile_leads')
                .update({
                  status: 'comment_reply_failed',
                  dm_error: `Comment reply failed: ${replyResult.error}`,
                })
                .eq('id', lead.id);
              errors.push(`Comment reply failed: ${replyResult.error}`);
            }

            // If connected, also DM / start AI chat in parallel with the public reply.
            // The DM step sets its own status (ai_chatting / dm_sent) which supersedes the reply status.
            if (isConnected) {
              const sent = await sendDmOrStartAi();
              if (sent) {
                console.log(`[Poll Comments] User connected — also queued DM/AI`);
              } else if (!publicReplyOk) {
                console.warn(`[Poll Comments] Both public reply and DM failed for lead ${lead.id}`);
              }
            }
          }

          // Notify webhook
          if (campaign.webhook_url) {
            try {
              await fetch(campaign.webhook_url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  event: 'lead_captured',
                  lead_id: lead.id,
                  campaign_id: campaign.id,
                  campaign_name: campaign.name,
                  commenter_id: commenterId,
                  commenter_name: commenterName,
                  comment_text: comment.text || '',
                  matched_keyword: matchedKeyword,
                  post_id: post.post_id,
                  post_url: post.post_url,
                  provider: post.provider,
                  timestamp: new Date().toISOString(),
                }),
              });
              console.log(`[Poll Comments] Webhook notification sent for lead ${lead.id}`);
            } catch (webhookError) {
              console.error(`[Poll Comments] Webhook notification failed:`, webhookError);
            }
          }
        }

        // Update post last_polled_at and cursor for pagination (reset errors on success)
        await supabase
          .from('unipile_monitored_posts')
          .update({
            last_polled_at: new Date().toISOString(),
            last_comment_cursor: lastCursor,
            comments_processed: (post.comments_processed || 0) + allComments.length,
            error_message: null,
            error_count: 0,
          })
          .eq('id', post.id);

        postsProcessed++;
      } catch (postError) {
        console.error(`[Poll Comments] Error processing post ${post.id}:`, postError);
        errors.push(`Post ${post.id}: ${postError instanceof Error ? postError.message : 'Unknown error'}`);
      }
    }

    // Log job completion
    await logJob(supabase, jobId, 'completed', startTime, {
      postsProcessed,
      commentsFound,
      leadsCreated,
      dmsQueued,
      commentReplies,
      icpScored,
      icpFiltered,
      aiConversationsStarted,
      errors: errors.length > 0 ? errors : undefined,
    });

    console.log(`[Poll Comments] Job ${jobId} completed: ${postsProcessed} posts, ${leadsCreated} leads, ${dmsQueued} DMs queued, ${commentReplies} replies, ${icpScored} scored, ${icpFiltered} filtered, ${aiConversationsStarted} AI convos`);

    return new Response(JSON.stringify({
      success: true,
      jobId,
      postsProcessed,
      commentsFound,
      leadsCreated,
      dmsQueued,
      commentReplies,
      icpScored,
      icpFiltered,
      aiConversationsStarted,
      errors: errors.length > 0 ? errors : undefined,
      _debug_posts: debugPostComments,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('[Poll Comments] Fatal error:', error);

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
    job_type: 'poll_comments',
    status,
    items_processed: (result.postsProcessed as number) || 0,
    items_created: (result.leadsCreated as number) || 0,
    items_failed: 0,
    error_message: (result.error as string) || null,
    error_details: result.errors ? { errors: result.errors, commentsFound: result.commentsFound, dmsQueued: result.dmsQueued, commentReplies: result.commentReplies, icpScored: result.icpScored, aiConversationsStarted: result.aiConversationsStarted } : null,
    duration_ms: duration,
  });
}

/**
 * Check if a LinkedIn user is in our actual LinkedIn connections.
 * Connections live in crm_contacts/crm_contact_identities since the
 * 2026-01-16 "merge network to contacts" migration — is_linkedin_connection
 * distinguishes an actual 1st-degree connection from a contact that merely
 * exists in the CRM for some other reason.
 */
async function checkLinkedInConnection(
  supabase: SupabaseClient,
  organizationId: string,
  linkedInUserId: string
): Promise<boolean> {
  const { data: identity } = await supabase
    .from('crm_contact_identities')
    .select('contact_id, crm_contacts!inner(is_linkedin_connection)')
    .eq('organization_id', organizationId)
    .eq('channel', 'linkedin')
    .eq('platform_user_id', linkedInUserId)
    .eq('crm_contacts.is_linkedin_connection', true)
    .maybeSingle();

  return !!identity;
}

/**
 * Get a random comment reply template (fallback when AI is not available).
 * Supports placeholders: {name}, {full_name}, {keyword}.
 */
function getRandomCommentReply(templates: string[] | null, commenterName: string, matchedKeyword: string): string {
  const defaultTemplates = [
    'Hey {name}! We\'re not connected so I can\'t DM you. Send me a DM with "{keyword}" and I\'ll get it to you!',
    'Hi {name}! Can\'t DM you since we\'re not connected. Just DM me "{keyword}" and I\'ll reply there!',
    '{name}, shoot me a DM with "{keyword}" and I\'ll send it over! We\'re not connected so I can\'t reach you directly.',
    'Hey {name}! DM me the word "{keyword}" and I\'ll get that to you right away!',
    '{name} just DM me "{keyword}" and I\'ll share it with you. Can\'t send it here since we\'re not connected!',
  ];

  const templatesArray = templates && templates.length > 0 ? templates : defaultTemplates;
  const template = templatesArray[Math.floor(Math.random() * templatesArray.length)];
  const firstName = commenterName.split(' ')[0] || 'there';

  return template
    .replace(/\{name\}/gi, firstName)
    .replace(/\{full_name\}/gi, commenterName)
    .replace(/\{keyword\}/gi, matchedKeyword);
}

/**
 * Generate a unique AI comment reply telling the user to DM the keyword.
 * Each reply is different so the post doesn't look robotic when multiple people comment.
 */
async function generateAiCommentReply(
  commenterName: string,
  commentText: string,
  matchedKeyword: string,
  openRouterKey: string,
  supabaseUrl: string,
  brandVoice?: { tone: string | null; personality: string | null } | null,
  aiModel?: string | null,
): Promise<{ reply: string; success: boolean }> {
  try {
    const firstName = commenterName.split(' ')[0] || 'there';
    const voiceGuidance = brandVoice?.tone
      ? `Match this tone: ${brandVoice.tone}. ${brandVoice.personality || ''}`
      : 'Be warm, casual, and conversational, like a real person replying on LinkedIn.';

    const prompt = `You are replying to a LinkedIn comment on your post. The commenter wants a resource you offered but you are NOT connected with them, so you can't DM them directly.

Commenter name: ${firstName}
Their comment: "${commentText}"
The keyword they should DM you: "${matchedKeyword}"

${voiceGuidance}

Write a SHORT reply (1-2 sentences max, under 200 characters) that:
- Tells them to DM YOU the keyword "${matchedKeyword}" so you can send it
- Briefly mentions you can't DM them because you're not connected
- Feels human and unique, NOT generic or templated
- Does NOT include any links or URLs
- Does NOT use hashtags or emojis excessively (1 emoji max)
- NEVER use em dashes. Use commas, periods, or "so" / "but" instead
- Vary your sentence structure. Don't always start with "Hey {name}". Mix it up: start with an acknowledgment of their comment, a thank you, the action they need to take, or their name in different positions

Reply ONLY with the comment text, nothing else.`;

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': supabaseUrl,
      },
      body: JSON.stringify({
        model: aiModel ? chatbotModel(aiModel) : DEFAULT_FAST_TEXT_MODEL,
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 150,
        temperature: 0.9,
      }),
    });

    if (!response.ok) {
      console.warn(`[Poll Comments] AI comment reply failed (${response.status})`);
      return { reply: '', success: false };
    }

    const data = await response.json();
    const reply = (data.choices?.[0]?.message?.content || '').trim();

    if (!reply || reply.length > 300) {
      return { reply: '', success: false };
    }

    return { reply, success: true };
  } catch (err) {
    console.warn(`[Poll Comments] AI comment reply error:`, err);
    return { reply: '', success: false };
  }
}

/**
 * Reply to a comment telling the user to DM the keyword.
 * Uses AI to generate unique replies; falls back to templates if AI unavailable.
 */
async function replyToCommentAskingToConnect(
  dsnUrl: string,
  apiKey: string,
  accountId: string,
  postId: string,
  commentId: string,
  templates: string[] | null,
  commenterName: string,
  commenterId: string | null,
  matchedKeyword: string,
  commentText?: string,
  openRouterKey?: string | null,
  supabaseUrl?: string,
  brandVoice?: { tone: string | null; personality: string | null } | null,
  aiModel?: string | null,
): Promise<{ success: boolean; replyText?: string; error?: string }> {
  try {
    let replyText: string;

    // Try AI-generated reply first (unique per commenter)
    if (openRouterKey && supabaseUrl && commentText) {
      const aiResult = await generateAiCommentReply(
        commenterName, commentText, matchedKeyword, openRouterKey, supabaseUrl, brandVoice, aiModel
      );
      if (aiResult.success) {
        replyText = aiResult.reply;
        console.log(`[Poll Comments] AI-generated comment reply for ${commenterName}`);
      } else {
        replyText = getRandomCommentReply(templates, commenterName, matchedKeyword);
        console.log(`[Poll Comments] AI failed, using template reply for ${commenterName}`);
      }
    } else {
      replyText = getRandomCommentReply(templates, commenterName, matchedKeyword);
    }

    // Build @mention if we have a commenter profile ID in LinkedIn ACo/ADo URN format.
    // Numeric-only IDs are company page IDs — Unipile's mentions API rejects them with 422.
    const mentions: { name: string; profile_id: string }[] = [];
    let textWithMention = replyText;
    const isUrnProfileId = commenterId && /^AC[a-zA-Z0-9_-]+$/.test(commenterId);
    if (isUrnProfileId) {
      const firstName = commenterName.split(' ')[0] || commenterName;
      mentions.push({ name: firstName, profile_id: commenterId });
      // Prepend @mention — {{0}} references the first entry in mentions array
      textWithMention = `{{0}} ${replyText}`;
    }

    // Use direct REST API for proper comment threading (SDK doesn't reliably pass comment_id)
    const url = `${dsnUrl}/api/v1/posts/${encodeURIComponent(postId)}/comments`;
    const body: Record<string, unknown> = {
      account_id: accountId,
      text: textWithMention,
      comment_id: commentId,
    };
    if (mentions.length > 0) {
      body.mentions = mentions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Comment reply API ${response.status}: ${errorText.substring(0, 300)}`);
    }

    console.log(`[Poll Comments] Successfully replied to comment ${commentId} (threaded, with @mention)`);
    return { success: true, replyText: textWithMention };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Poll Comments] Error replying to comment: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Reply to a comment from someone who is ALREADY connected (gated mode).
 * Never claims "we're not connected" — confirms the DM is on its way instead.
 */
async function replyToCommentConfirmSent(
  dsnUrl: string,
  apiKey: string,
  accountId: string,
  postId: string,
  commentId: string,
  commenterName: string,
  commenterId: string | null,
  openRouterKey?: string | null,
  supabaseUrl?: string,
  brandVoice?: { tone: string | null; personality: string | null } | null,
  aiModel?: string | null,
): Promise<{ success: boolean; replyText?: string; error?: string }> {
  try {
    const firstName = commenterName.split(' ')[0] || 'there';
    let replyText: string | null = null;

    if (openRouterKey && supabaseUrl) {
      try {
        const voiceGuidance = brandVoice?.tone
          ? `Match this tone: ${brandVoice.tone}. ${brandVoice.personality || ''}`
          : 'Be warm, casual, and conversational, like a real person replying on LinkedIn.';
        const prompt = `You are replying to a LinkedIn comment on your post. The commenter asked for a resource and you are already connected with them, so you just sent it to their DMs.

Commenter name: ${firstName}

${voiceGuidance}

Write a SHORT reply (1 sentence, under 150 characters) that:
- Confirms you just sent it to their DMs
- Feels human and unique, NOT generic or templated
- Does NOT use hashtags or emojis excessively (1 emoji max)
- NEVER use em dashes. Use commas, periods, or "so" / "but" instead

Reply ONLY with the comment text, nothing else.`;

        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': supabaseUrl,
          },
          body: JSON.stringify({
            model: aiModel ? chatbotModel(aiModel) : DEFAULT_FAST_TEXT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 100,
            temperature: 0.9,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const aiReply = (data.choices?.[0]?.message?.content || '').trim();
          if (aiReply && aiReply.length <= 300) {
            replyText = aiReply;
          }
        }
      } catch (_) { /* fall through to template */ }
    }

    if (!replyText) {
      replyText = `Just sent it to your DMs, ${firstName}!`;
    }

    // Build @mention if we have a commenter profile ID in LinkedIn ACo/ADo URN format.
    const mentions: { name: string; profile_id: string }[] = [];
    let textWithMention = replyText;
    const isUrnProfileId = commenterId && /^AC[a-zA-Z0-9_-]+$/.test(commenterId);
    if (isUrnProfileId) {
      mentions.push({ name: firstName, profile_id: commenterId });
      textWithMention = `{{0}} ${replyText}`;
    }

    const url = `${dsnUrl}/api/v1/posts/${encodeURIComponent(postId)}/comments`;
    const body: Record<string, unknown> = {
      account_id: accountId,
      text: textWithMention,
      comment_id: commentId,
    };
    if (mentions.length > 0) {
      body.mentions = mentions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Comment reply API ${response.status}: ${errorText.substring(0, 300)}`);
    }

    console.log(`[Poll Comments] Successfully replied (confirm-sent) to comment ${commentId}`);
    return { success: true, replyText: textWithMention };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Poll Comments] Error replying (confirm-sent) to comment: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Reply to a comment with the resource link directly (no connection required).
 * Uses AI to generate a natural reply that includes the link.
 * Falls back to templates if AI is unavailable.
 */
async function replyToCommentWithResource(
  dsnUrl: string,
  apiKey: string,
  accountId: string,
  postId: string,
  commentId: string,
  commenterName: string,
  commenterId: string | null,
  commentText: string,
  leadId: string,
  campaign: {
    lead_magnet_url: string | null;
    comment_link_mode: 'gated' | 'direct';
    brand_voice?: { tone: string | null; personality: string | null } | null;
    ai_chatbot_model?: string | null;
  },
  supabaseUrl: string,
  openRouterKey?: string | null,
): Promise<{ success: boolean; replyText?: string; error?: string }> {
  try {
    // Build the resource URL based on link mode
    let resourceUrl: string | null = null;
    if (campaign.comment_link_mode === 'direct' && campaign.lead_magnet_url) {
      resourceUrl = campaign.lead_magnet_url;
    } else if (campaign.lead_magnet_url) {
      // Gated mode: route through email capture page
      resourceUrl = buildLeadMagnetGateUrl(leadId, supabaseUrl);
    }

    if (!resourceUrl) {
      return { success: false, error: 'No lead_magnet_url configured for direct delivery' };
    }

    let replyText: string;
    const firstName = commenterName.split(' ')[0] || 'there';

    // Try AI-generated reply first
    if (openRouterKey) {
      const voiceGuidance = campaign.brand_voice?.tone
        ? `Match this tone: ${campaign.brand_voice.tone}. ${campaign.brand_voice.personality || ''}`
        : 'Be warm, casual, and conversational, like a real person replying on LinkedIn.';

      const prompt = `You are replying to a LinkedIn comment on your post. The commenter wants a resource you offered. You're sharing it directly in the comment.

Commenter name: ${firstName}
Their comment: "${commentText}"
Resource link: ${resourceUrl}

${voiceGuidance}

Write a SHORT reply (1-2 sentences max, under 280 characters) that:
- Acknowledges them naturally
- Includes the resource link naturally in your reply
- Feels human and unique, NOT generic or templated
- Does NOT use hashtags or emojis excessively (1 emoji max)
- The link MUST appear exactly as provided, do NOT modify or shorten it
- NEVER use em dashes. Use commas, periods, or "so" / "but" instead
- Vary your sentence structure. Don't always start with "Hey {name}"

Reply ONLY with the comment text, nothing else.`;

      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openRouterKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': supabaseUrl,
          },
          body: JSON.stringify({
            model: campaign.ai_chatbot_model ? chatbotModel(campaign.ai_chatbot_model) : DEFAULT_FAST_TEXT_MODEL,
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 200,
            temperature: 0.9,
          }),
        });

        if (response.ok) {
          const data = await response.json();
          const aiReply = (data.choices?.[0]?.message?.content || '').trim();
          if (aiReply && aiReply.length <= 500 && aiReply.includes(resourceUrl)) {
            replyText = aiReply;
            console.log(`[Poll Comments] AI-generated resource reply for ${commenterName}`);
          } else {
            // AI reply missing or doesn't contain the URL — use template
            replyText = `Hey ${firstName}! Here you go: ${resourceUrl}`;
            console.log(`[Poll Comments] AI reply missing URL, using template for ${commenterName}`);
          }
        } else {
          replyText = `Hey ${firstName}! Here you go: ${resourceUrl}`;
          console.warn(`[Poll Comments] AI resource reply failed (${response.status}), using template`);
        }
      } catch (aiErr) {
        replyText = `Hey ${firstName}! Here you go: ${resourceUrl}`;
        console.warn(`[Poll Comments] AI resource reply error, using template:`, aiErr);
      }
    } else {
      replyText = `Hey ${firstName}! Here you go: ${resourceUrl}`;
    }

    // Build @mention if we have a commenter profile ID in LinkedIn ACo/ADo URN format.
    // Numeric-only IDs are company page IDs — Unipile's mentions API rejects them with 422.
    const mentions: { name: string; profile_id: string }[] = [];
    let textWithMention = replyText;
    const isUrnProfileId = commenterId && /^AC[a-zA-Z0-9_-]+$/.test(commenterId);
    if (isUrnProfileId) {
      const mentionName = commenterName.split(' ')[0] || commenterName;
      mentions.push({ name: mentionName, profile_id: commenterId });
      textWithMention = `{{0}} ${replyText}`;
    }

    // Use direct REST API for proper comment threading + @mentions
    const url = `${dsnUrl}/api/v1/posts/${encodeURIComponent(postId)}/comments`;
    const body: Record<string, unknown> = {
      account_id: accountId,
      text: textWithMention,
      comment_id: commentId,
    };
    if (mentions.length > 0) {
      body.mentions = mentions;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Comment reply API ${response.status}: ${errorText.substring(0, 300)}`);
    }

    console.log(`[Poll Comments] Successfully replied with resource to comment ${commentId} (threaded, with @mention)`);
    return { success: true, replyText: textWithMention };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Poll Comments] Error replying with resource: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Queue a DM for a lead
 */
async function queueDmForLead(
  supabase: SupabaseClient,
  lead: { id: string; campaign_id: string; commenter_id: string },
  campaign: Campaign,
  commenterName: string,
  matchedKeyword: string,
  supabaseUrl: string,
  accountId?: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const dmDelaySeconds = campaign.dm_delay_seconds || 30;
    const scheduledFor = new Date(Date.now() + dmDelaySeconds * 1000).toISOString();

    const dmMessage = buildLeadDmMessage({
      template: campaign.dm_template,
      commenterName,
      matchedKeyword,
      leadId: lead.id,
      leadMagnetUrl: campaign.lead_magnet_url,
      supabaseUrl,
    });

    const { error: queueError } = await supabase
      .from('unipile_message_queue')
      .insert({
        campaign_id: campaign.id,
        lead_id: lead.id,
        account_id: accountId || campaign.account.id,
        organization_id: campaign.organization_id,
        recipient_platform_id: lead.commenter_id,
        recipient_name: commenterName,
        message_text: dmMessage,
        scheduled_for: scheduledFor,
        status: 'pending',
      });

    if (queueError) {
      console.error(`[Poll Comments] Failed to queue DM: ${queueError.message}`);
      return { success: false, error: queueError.message };
    }

    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Initiate an AI chatbot conversation for a qualifying lead.
 * Generates the initial AI message, queues it, and creates
 * an ai_chatbot_conversations record.
 */
async function initiateAiChatbot(
  supabase: SupabaseClient,
  lead: { id: string; campaign_id: string; commenter_id: string },
  campaign: Campaign,
  commenterName: string,
  commenterHeadline: string | null,
  commentText: string,
  supabaseUrl: string,
  accountId?: string,
  /** When provided, skip AI generation — use this pre-built message as the opening DM
   *  and seed the conversation history with it. Useful when the template DM (with lead magnet link)
   *  should be sent first, with AI handling follow-up replies only. */
  prebuiltMessage?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    let initialMessage: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (prebuiltMessage) {
      // Template DM already queued by caller — just use it for conversation seeding
      initialMessage = prebuiltMessage;
    } else {
      // Get OpenRouter API key
      const { data: apiKeyData } = await supabase
        .from('api_keys')
        .select('key_encrypted')
        .eq('organization_id', campaign.organization_id)
        .eq('provider', 'openrouter')
        .single();

      const chatbotModelIsOllama = isOllamaModel(campaign.ai_chatbot_model as string | undefined);
      if (!apiKeyData && !chatbotModelIsOllama) {
        return { success: false, error: 'No OpenRouter API key configured' };
      }

      const encKey = Deno.env.get('ENCRYPTION_KEY')!;
      const openRouterKey = apiKeyData ? await decryptApiKey(apiKeyData.key_encrypted, encKey) : '';

      // Fetch ICP score from lead (already scored earlier in the pipeline)
      const { data: leadData } = await supabase
        .from('unipile_leads')
        .select('icp_score, icp_score_reasoning')
        .eq('id', lead.id)
        .single();

      const icpScore = leadData?.icp_score ?? 50;
      const icpReasoning = leadData?.icp_score_reasoning ?? 'No ICP scoring performed';

      // Generate initial AI message
      const aiModel = chatbotModel(campaign.ai_chatbot_model);
      const result = await generateInitialAiMessage(
        {
          commenterName,
          commenterHeadline,
          commentText,
          icpScore,
          icpReasoning,
          chatbotInstructions: campaign.ai_chatbot_instructions || 'Be helpful and guide the conversation.',
          brandVoice: campaign.brand_voice || null,
        },
        openRouterKey,
        aiModel,
        supabaseUrl,
        { supabase, organizationId: campaign.organization_id },
      );
      initialMessage = result.message;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;

      // Queue the AI-generated message
      const dmDelaySeconds = campaign.dm_delay_seconds || 30;
      const scheduledFor = new Date(Date.now() + dmDelaySeconds * 1000).toISOString();

      const { error: queueError } = await supabase
        .from('unipile_message_queue')
        .insert({
          campaign_id: campaign.id,
          lead_id: lead.id,
          account_id: accountId || campaign.account.id,
          organization_id: campaign.organization_id,
          recipient_platform_id: lead.commenter_id,
          recipient_name: commenterName,
          message_text: initialMessage,
          scheduled_for: scheduledFor,
          status: 'pending',
        });

      if (queueError) {
        return { success: false, error: `Failed to queue AI message: ${queueError.message}` };
      }
    }

    // Fetch ICP score for chatbot context
    const { data: leadData } = await supabase
      .from('unipile_leads')
      .select('icp_score, icp_score_reasoning')
      .eq('id', lead.id)
      .single();

    const icpScore = leadData?.icp_score ?? 50;
    const icpReasoning = leadData?.icp_score_reasoning ?? 'No ICP scoring performed';

    // Build chatbot system prompt
    const systemPrompt = buildChatbotSystemPrompt({
      commenterName,
      commenterHeadline,
      commentText,
      icpScore,
      icpReasoning,
      chatbotInstructions: campaign.ai_chatbot_instructions || 'Be helpful and guide the conversation.',
      brandVoice: campaign.brand_voice || null,
    });

    // Create ai_chatbot_conversations record
    const leadContext = {
      commenterName,
      commenterHeadline,
      commentText,
      icpScore,
      icpReasoning,
    };

    const conversationHistory = [
      { role: 'assistant', content: initialMessage, timestamp: new Date().toISOString() },
    ];

    const { error: convError } = await supabase
      .from('ai_chatbot_conversations')
      .insert({
        organization_id: campaign.organization_id,
        campaign_id: campaign.id,
        lead_id: lead.id,
        status: 'active',
        turn_count: 1,
        max_turns: campaign.ai_chatbot_max_turns || 10,
        system_prompt: systemPrompt,
        conversation_history: conversationHistory,
        lead_context: leadContext,
        total_input_tokens: inputTokens,
        total_output_tokens: outputTokens,
        last_ai_response_at: new Date().toISOString(),
      });

    if (convError) {
      console.error(`[Poll Comments] Failed to create AI conversation record: ${convError.message}`);
      // Message is already queued, so we still count this as partial success
    }

    // Update lead status to ai_chatting
    await supabase.from('unipile_leads').update({
      status: 'ai_chatting',
      ai_conversation_active: true,
      ai_conversation_turn_count: 1,
    }).eq('id', lead.id);

    // ================================================================
    // Activate AI agent on CRM conversation (inbox autopilot path)
    // ================================================================
    if (campaign.agent_profile_id) {
      try {
        // The account the lead commented on decides the inbox channel.
        const { data: leadAccount } = await supabase
          .from('unipile_accounts').select('provider').eq('id', accountId || campaign.account?.id || '').maybeSingle();
        const leadChannel = leadAccount?.provider === 'INSTAGRAM' ? 'instagram' : 'linkedin';
        // 1. Find or create CRM contact for this lead
        let crmContactId: string | null = null;

        const { data: existingIdentity } = await supabase
          .from('crm_contact_identities')
          .select('contact_id')
          .eq('organization_id', campaign.organization_id)
          .eq('platform_user_id', lead.commenter_id)
          .eq('channel', leadChannel)
          .maybeSingle();

        if (existingIdentity) {
          crmContactId = existingIdentity.contact_id;
        } else {
          // Create CRM contact + identity
          const { data: newContact } = await supabase
            .from('crm_contacts')
            .insert({
              organization_id: campaign.organization_id,
              display_name: commenterName,
              first_name: commenterName.split(' ')[0] || commenterName,
              last_name: commenterName.split(' ').slice(1).join(' ') || null,
              source: leadChannel,
              status: 'active',
            })
            .select('id')
            .single();

          if (newContact) {
            crmContactId = newContact.id;
            await supabase.from('crm_contact_identities').insert({
              organization_id: campaign.organization_id,
              contact_id: newContact.id,
              channel: leadChannel,
              platform_user_id: lead.commenter_id,
              platform_username: commenterName,
            });
          }
        }

        if (crmContactId) {
          // 2. Get or create CRM conversation
          const { data: crmConversationId } = await supabase.rpc('get_or_create_conversation', {
            p_org_id: campaign.organization_id,
            p_contact_id: crmContactId,
            p_channel: leadChannel,
            p_channel_account_id: accountId || campaign.account?.id || null,
            p_external_conversation_id: null,
            p_external_participant_id: lead.commenter_id,
            p_mailbox_id: null,
          });

          if (crmConversationId) {
            // 3. Activate AI on the conversation
            await supabase.from('crm_conversations').update({
              ai_enabled: true,
              agent_profile_id: campaign.agent_profile_id,
              metadata: {
                lead_magnet_campaign_id: campaign.id,
                lead_id: lead.id,
              },
            }).eq('id', crmConversationId);

            // 4. Backfill CRM references on the lead
            await supabase.from('unipile_leads').update({
              crm_contact_id: crmContactId,
              crm_conversation_id: crmConversationId,
            }).eq('id', lead.id);

            // 5. Log the outbound DM as a CRM message so autopilot has conversation context
            // Use 'queued' status — the DM is in unipile_message_queue but not yet delivered.
            // process-dm-queue will update to 'sent' after successful Unipile API delivery.
            await supabase.from('crm_messages').insert({
              organization_id: campaign.organization_id,
              conversation_id: crmConversationId,
              contact_id: crmContactId,
              direction: 'outbound',
              sender_type: 'ai',
              content: initialMessage,
              content_type: 'text',
              status: 'queued',
              ai_generated: !prebuiltMessage, // template DMs are not AI-generated
              metadata: { source: 'lead_magnet', campaign_id: campaign.id },
            });

            console.log(`[Poll Comments] AI activated on CRM conversation ${crmConversationId} with agent profile ${campaign.agent_profile_id}`);
          }
        }
      } catch (crmErr) {
        // Non-critical — the chatbot record is already created
        console.error(`[Poll Comments] CRM AI activation error (non-fatal):`, crmErr);
      }
    }

    console.log(`[Poll Comments] AI chatbot initiated for lead ${lead.id} — ${prebuiltMessage ? 'template DM + AI follow-up' : 'AI-generated opening'}`);
    return { success: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error(`[Poll Comments] AI chatbot initiation error: ${errorMessage}`);
    return { success: false, error: errorMessage };
  }
}

/**
 * Fetch all comments with cursor-based pagination using direct REST API
 * Endpoint: GET /api/v1/posts/{post_id}/comments?account_id={account_id}
 */
async function fetchAllCommentsRest(
  dsnUrl: string,
  apiKey: string,
  accountId: string,
  postId: string,
  startCursor: string | null,
  maxPages: number = 5,
  limit: number = 100
): Promise<{ comments: UnipileComment[]; lastCursor: string | null }> {
  const allComments: UnipileComment[] = [];
  let currentCursor = startCursor;
  let pagesProcessed = 0;

  while (pagesProcessed < maxPages) {
    let url = `${dsnUrl}/api/v1/posts/${encodeURIComponent(postId)}/comments?account_id=${encodeURIComponent(accountId)}&limit=${limit}`;
    if (currentCursor) {
      url += `&cursor=${encodeURIComponent(currentCursor)}`;
    }

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      throw new Error(`Comments API ${response.status}: ${errorText.substring(0, 300)}`);
    }

    const data = await response.json() as UnipileCommentListResponse;

    if (data.items && data.items.length > 0) {
      allComments.push(...data.items);
    }

    pagesProcessed++;

    // If there is no next cursor, we have reached the end
    if (!data.cursor) {
      currentCursor = null;
      break;
    }

    currentCursor = data.cursor;
  }

  return { comments: allComments, lastCursor: currentCursor };
}

/**
 * Extract normalized comment data based on platform (LinkedIn vs Instagram)
 */
function extractPublicIdentifierFromProfileUrl(profileUrl: string | null | undefined): string | null {
  if (!profileUrl) return null;
  // Extract slug from LinkedIn profile URLs like:
  // https://www.linkedin.com/in/marc-sutter-xyz/
  const match = profileUrl.match(/linkedin\.com\/in\/([^/?#]+)/i);
  return match ? match[1] : null;
}

function extractCommentData(comment: UnipileComment, provider: string): {
  commentId: string;
  commenterId: string | null;
  commenterName: string;
  commenterHeadline: string | null;
  commenterProfileUrl: string | null;
  commenterPublicIdentifier: string | null;
  commentedAt: string;
  networkDistance: string | null;
} | null {
  if (provider === 'LINKEDIN' && isLinkedInComment(comment)) {
    const profileUrl = comment.author_details?.profile_url || null;
    return {
      commentId: comment.id,
      commenterId: comment.author_details?.id || null,
      commenterName: (typeof comment.author === 'string' ? comment.author : null) || 'Unknown',
      commenterHeadline: comment.author_details?.headline || null,
      commenterProfileUrl: profileUrl,
      commenterPublicIdentifier: comment.author_details?.public_identifier ||
        extractPublicIdentifierFromProfileUrl(profileUrl),
      commentedAt: comment.date || new Date().toISOString(),
      networkDistance: comment.author_details?.network_distance || null,
    };
  }

  if (provider === 'INSTAGRAM' && isInstagramComment(comment)) {
    return {
      commentId: comment.provider_id,
      commenterId: comment.author?.provider_id || comment.author?.pk || null,
      commenterName: comment.author?.public_identifier || 'Unknown',
      commenterHeadline: null,
      commenterProfileUrl: comment.author?.public_identifier
        ? `https://instagram.com/${comment.author.public_identifier}`
        : null,
      commenterPublicIdentifier: null,
      commentedAt: comment.created_at
        ? new Date(comment.created_at * 1000).toISOString()
        : new Date().toISOString(),
      networkDistance: null,
    };
  }

  // Fallback for unexpected formats
  const anyComment = comment as Record<string, unknown>;
  const fallbackId = (anyComment.id || anyComment.provider_id) as string | undefined;
  const authorDetails = anyComment.author_details as Record<string, unknown> | undefined;
  const authorObj = typeof anyComment.author === 'object' ? anyComment.author as Record<string, unknown> : undefined;

  return {
    commentId: fallbackId || '',
    commenterId: (authorDetails?.id || authorDetails?.provider_id || authorObj?.provider_id) as string || null,
    commenterName: (typeof anyComment.author === 'string' ? anyComment.author : null) ||
      (authorDetails?.name || authorObj?.public_identifier || 'Unknown') as string,
    commenterHeadline: (authorDetails?.headline) as string || null,
    commenterProfileUrl: (authorDetails?.profile_url) as string || null,
    commenterPublicIdentifier: null,
    commentedAt: (anyComment.date || new Date().toISOString()) as string,
    networkDistance: (authorDetails?.network_distance) as string || null,
  };
}
