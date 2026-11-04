import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { checkFeatureAccess } from "../_shared/featureAccess.ts";
import { decryptApiKey } from "../_shared/unipile-client.ts";
import { normalizeDashes } from '../_shared/sanitize-ai-output.ts';
import { splitFollowUpComment } from '../_shared/follow-up-comment.ts';
import { stageText } from '../_shared/stage-text.ts';
import { isRetryableStatus, readInvokeError } from '../_shared/invoke-error.ts';
import { parseLinkedInDestination } from '../_shared/linkedin-identity.ts';
import { parseZernioDestination } from '../_shared/zernio.ts';
import { buildLinkedInContent, normalizeLinkedInContent } from '../_shared/linkedin-publishing.ts';
import { isServiceRoleRequest } from '../_shared/org-access.ts';
import { AuthError, unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** A publisher rejection carrying the upstream reason and whether a retry can help. */
class PublishError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
  }
}

// ============================================================================
// Types
// ============================================================================

interface TweetThreadItem {
  text: string;
  media_urls?: string[];
}

interface PublishQueueItem {
  id: string;
  autopilot_id: string | null;
  organization_id: string | null;
  output_id: string;
  account_id: string;
  platform: string;
  scheduled_for: string;
  status: 'pending' | 'publishing' | 'published' | 'failed';
  attempts: number;
  last_error?: string;
  is_repost: boolean;
  source_publication_id?: string;
  variation_mode?: 'exact' | 'slight_variation' | 'regenerate';
  tweet_thread?: TweetThreadItem[] | null;
  publish_content?: { caption: string; images?: string[]; videoUrl?: string; followUpComment?: string; postType?: string } | null;
}

interface ContentOutput {
  id: string;
  data: any;
  stage_data: any;
  pipeline: string;
  organization_id: string;
}

interface Autopilot {
  id: string;
  organization_id: string;
  total_published: number;
}

// ============================================================================
// Main Handler
// ============================================================================

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError('Forbidden', 403), corsHeaders);

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    console.log('📤 [Publish Queue] Starting processing run...');

    // Get items due for publishing
    const now = new Date().toISOString();
    const { data: dueItems, error: fetchError } = await supabase
      .from('publish_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('scheduled_for', now)
      .order('scheduled_for', { ascending: true })
      .limit(10); // Process in batches

    if (fetchError) {
      throw new Error(`Failed to fetch queue items: ${fetchError.message}`);
    }

    if (!dueItems || dueItems.length === 0) {
      console.log('✅ [Publish Queue] No items due for publishing');
      return new Response(
        JSON.stringify({ success: true, message: 'No items due', processed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`📋 [Publish Queue] Found ${dueItems.length} items to publish`);

    let publishedCount = 0;
    let failedCount = 0;

    for (const item of dueItems as PublishQueueItem[]) {
      try {
        if (await processQueueItem(item, supabase)) publishedCount++;
      } catch (error) {
        console.error(`❌ [Queue Item ${item.id}] Error:`, error);
        failedCount++;
        const retryable = !(error instanceof PublishError) || error.retryable;

        // Update item with error
        await supabase.from('publish_queue')
          .update({
            status: item.attempts >= 3 || !retryable ? 'failed' : 'pending',
            attempts: item.attempts + 1,
            last_error: error instanceof Error ? error.message : 'Unknown error'
          })
          .eq('id', item.id);

        // Log the failure
        await logAutomation(supabase, item.autopilot_id || 'agent', item.output_id, null, 'publish_failed', null, {
          account_id: item.account_id,
          error: error instanceof Error ? error.message : 'Unknown error',
          attempts: item.attempts + 1
        });
      }
    }

    console.log(`✅ [Publish Queue] Completed: ${publishedCount} published, ${failedCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        published: publishedCount,
        failed: failedCount
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('❌ [Publish Queue] Fatal error:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});

// ============================================================================
// Process Single Queue Item
// ============================================================================

/** Publishes one row; false when another run or a user change got to it first. */
async function processQueueItem(
  item: PublishQueueItem,
  supabase: any
): Promise<boolean> {
  console.log(`🚀 [Queue Item ${item.id}] Processing publish to ${item.account_id}`);

  // Fetch and validate FIRST (before marking as publishing to avoid stuck state)
  const { data: output, error: outputError } = await supabase
    .from('content_outputs')
    .select('*')
    .eq('id', item.output_id)
    .single();

  if (outputError || !output) {
    throw new Error(`Output not found: ${outputError?.message}`);
  }

  // Resolve organization_id: from autopilot if present, otherwise from queue item directly
  let autopilot: Autopilot | null = null;
  let organizationId: string;

  if (item.autopilot_id) {
    const { data: ap, error: autopilotError } = await supabase
      .from('autopilots')
      .select('*')
      .eq('id', item.autopilot_id)
      .single();

    if (autopilotError || !ap) {
      throw new Error(`Autopilot not found: ${autopilotError?.message}`);
    }
    autopilot = ap;
    organizationId = ap.organization_id;
  } else if (item.organization_id) {
    organizationId = item.organization_id;
  } else {
    // Last resort: get org from the content output
    organizationId = output.organization_id;
  }

  // Validate feature access - Publishing requires Pro plan
  const featureCheck = await checkFeatureAccess(supabase, organizationId, "publishing");
  if (!featureCheck.allowed) {
    throw new Error(featureCheck.reason || "Publishing feature not available for this plan");
  }

  // Claim every row atomically before calling the provider. Two cron runs can
  // otherwise read the same pending row and publish it twice, and the
  // Scheduler lets people move a row back to draft, reschedule or delete it
  // while this batch runs: an unclaimed row is skipped, not published.
  const nativeDestination = item.account_id.startsWith('unipile:');
  if (nativeDestination && ((item.platform || '').toLowerCase() !== 'linkedin' || output.organization_id !== organizationId)) {
    throw new PublishError('LinkedIn publishing destination or content organization is invalid', false);
  }
  const zernioAccountId = parseZernioDestination(item.account_id);
  if (zernioAccountId && output.organization_id !== organizationId) {
    throw new PublishError('Zernio publishing destination or content organization is invalid', false);
  }
  const { data: claimed, error: claimError } = await supabase.from('publish_queue')
    .update({ status: 'publishing', ...(nativeDestination || zernioAccountId ? { organization_id: organizationId } : {}) })
    .eq('id', item.id)
    .eq('status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .select('id');
  if (claimError) throw new Error('Could not claim publication');
  if (!claimed?.length) return false;

  // Build content for publishing based on pipeline type. A queue row may carry
  // its own publish_content (the Scheduler's per-account caption and media);
  // it overrides what the output would publish.
  let publishContent = nativeDestination
    ? item.publish_content ? normalizeLinkedInContent(item.publish_content) : buildLinkedInContent(output)
    : applyPublishOverride(buildPublishContent(output), item.publish_content);

  // A writing stage may end the post with a ---FOLLOW-UP--- block (the first
  // comment, e.g. the lead magnet link on LinkedIn). Split it off before any
  // rewriting so the marker never reaches a platform.
  const splitCaption = splitFollowUpComment(publishContent.caption);
  publishContent.caption = splitCaption.caption;
  if (splitCaption.followUpComment && !publishContent.followUpComment) {
    publishContent.followUpComment = splitCaption.followUpComment;
  }

  // Handle variation modes for reposts
  if (item.is_repost && item.variation_mode === 'slight_variation') {
    console.log(`🔄 [Queue Item ${item.id}] Applying slight variation to caption`);
    try {
      const variedCaption = await generateCaptionVariation(
        publishContent.caption,
        organizationId,
        supabase
      );
      if (variedCaption) {
        publishContent.caption = variedCaption;
        console.log(`✅ [Queue Item ${item.id}] Caption varied successfully`);
      }
    } catch (error) {
      console.warn(`⚠️ [Queue Item ${item.id}] Caption variation failed, using original:`, error);
      // Continue with original caption if variation fails
    }
  }

  // Post-process caption: clean up LLM artifacts
  publishContent.caption = postProcessCaption(publishContent.caption);
  if (publishContent.followUpComment) {
    publishContent.followUpComment = postProcessCaption(publishContent.followUpComment);
  }

  // Route to the appropriate publisher based on platform
  const platform = (item.platform || '').toLowerCase();

  const linkedInDestination = parseLinkedInDestination(item.account_id);
  if (zernioAccountId) {
    // The organization's own Zernio account (BYOK). Checked before the platform
    // branches: an X account connected in Zernio must not reach publish-to-twitter.
    const { data: result, error: publishError } = await supabase.functions.invoke('publish-to-zernio', {
      body: { account_id: item.account_id, platform, organization_id: organizationId, output_id: output.id, content: publishContent, queue_id: item.id },
    });
    if (publishError) {
      const { message, status } = await readInvokeError(publishError);
      throw new PublishError(`Publish through Zernio failed: ${message}`, isRetryableStatus(status));
    }
    if (!result?.success) throw new PublishError(result?.error || 'Zernio rejected the post', false);
    if (result.warning) await logAutomation(supabase, item.autopilot_id || 'agent', item.output_id, null, 'publish_warning', null, { account_id: item.account_id, warning: result.warning });
  } else if (linkedInDestination) {
    if (platform !== 'linkedin' || output.organization_id !== organizationId) {
      throw new PublishError('LinkedIn publishing destination or content organization is invalid', false);
    }
    const { data: result, error: publishError } = await supabase.functions.invoke('publish-to-linkedin', {
      body: { account_id: item.account_id, organization_id: organizationId, output_id: output.id, content: publishContent, queue_id: item.id },
    });
    if (publishError) {
      const { message, status } = await readInvokeError(publishError);
      throw new PublishError(`Publish to LinkedIn failed: ${message}`, isRetryableStatus(status));
    }
    if (!result?.success) throw new PublishError(result?.error || 'LinkedIn rejected the post', false);
    if (result.warning) await logAutomation(supabase, item.autopilot_id || 'agent', item.output_id, null, 'publish_warning', null, { account_id: item.account_id, warning: result.warning });
  } else if (platform === 'wordpress') {
    // Articles publish to the WordPress site (the account_id is the wordpress_sites id).
    // Every other platform used to fall through to GHL, so a site picked in an
    // autopilot could never post.
    const { data: wpResult, error: publishError } = await supabase.functions.invoke('publish-to-wordpress', {
      body: { output_id: output.id, site_id: item.account_id, article: buildWordPressArticle(output) },
    });
    if (publishError) {
      const { message, status } = await readInvokeError(publishError);
      throw new PublishError(`Publish to WordPress failed: ${message}`, isRetryableStatus(status));
    }
    if (wpResult && wpResult.success === false) {
      throw new PublishError(`Publish to WordPress failed: ${wpResult.error || 'WordPress rejected the post'}`, false);
    }
  } else if (platform === 'twitter' || platform === 'x') {
    // Twitter/X: use publish-to-twitter edge function
    const mediaUrls: string[] = [];
    if (publishContent.images?.length > 0) {
      mediaUrls.push(...publishContent.images);
    }
    if (publishContent.videoUrl) {
      mediaUrls.push(publishContent.videoUrl);
    }

    // Prefer queue-level tweet_thread, then content-derived thread_tweets
    const resolvedThread: TweetThreadItem[] | undefined =
      (item.tweet_thread && item.tweet_thread.length > 0)
        ? item.tweet_thread
        : (publishContent.thread_tweets && publishContent.thread_tweets.length > 0)
          ? publishContent.thread_tweets
          : undefined;

    const { error: publishError } = await supabase.functions.invoke('publish-to-twitter', {
      body: {
        account_id: item.account_id,
        tweet: {
          text: publishContent.caption || '',
          media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
        },
        thread: resolvedThread,
        output_id: output.id,
      }
    });

    if (publishError) {
      const { message, status } = await readInvokeError(publishError);
      throw new PublishError(`Publish to Twitter failed: ${message}`, isRetryableStatus(status));
    }
  } else {
    // Default: GHL (Facebook, Instagram, LinkedIn, etc.)
    // The account_id IS the GHL social account ID (e.g., "locationId_accountId_type_profile")
    const { data: ghlResult, error: publishError } = await supabase.functions.invoke('push-to-ghl', {
      body: {
        contentOutputIds: [output.id],
        platforms: [item.account_id],
        organizationId: organizationId,
        baseContent: publishContent,
      }
    });

    if (publishError) {
      const { message, status } = await readInvokeError(publishError);
      throw new PublishError(`Push to GHL failed: ${message}`, isRetryableStatus(status));
    }

    // push-to-ghl answers 200 even when GHL rejected the post (e.g. 422 "TikTok
    // needs a video"); the per-output verdict is in results[].
    const rejected = (ghlResult?.results || []).find((r: any) => !r.success);
    if (rejected) {
      throw new PublishError(
        `Push to GHL failed: ${rejected.error || 'GHL rejected the post'}`,
        isRetryableStatus(rejected.status),
      );
    }
  }

  // Mark as published
  await supabase.from('publish_queue')
    .update({
      status: 'published',
      published_at: new Date().toISOString()
    })
    .eq('id', item.id);

  console.log(`✅ [Queue Item ${item.id}] Published successfully`);

  // Record in publications for evergreen tracking (only for autopilot-driven items)
  if (autopilot) {
    await supabase.from('content_publications').insert({
      organization_id: organizationId,
      autopilot_id: item.autopilot_id,
      output_id: item.output_id,
      account_id: item.account_id,
      platform: item.platform,
      published_at: new Date().toISOString(),
      evergreen_eligible: !item.is_repost,
      repost_count: item.is_repost ? 1 : 0
    });

    // If this was a repost, update the source publication's repost count
    if (item.is_repost && item.source_publication_id) {
      const { data: sourcePub } = await supabase
        .from('content_publications')
        .select('repost_count')
        .eq('id', item.source_publication_id)
        .eq('organization_id', organizationId)
        .maybeSingle();

      if (sourcePub) {
        await supabase.from('content_publications')
          .update({
            repost_count: (sourcePub.repost_count || 0) + 1,
            last_reposted_at: new Date().toISOString()
          })
          .eq('id', item.source_publication_id)
          .eq('organization_id', organizationId);
      }
    }

    // Update autopilot stats
    await supabase.from('autopilots')
      .update({
        total_published: (autopilot.total_published || 0) + 1,
        updated_at: new Date().toISOString()
      })
      .eq('id', item.autopilot_id);
  }

  // Track in ghl_published_posts for all items (both autopilot and agent-driven).
  // Native LinkedIn and Zernio publishers write their own row, with the post id.
  try {
    if (!linkedInDestination && !zernioAccountId) await supabase.from('ghl_published_posts').insert({
      content_output_id: item.output_id,
      organization_id: organizationId,
      platform: item.platform || 'twitter',
      platform_account_id: item.account_id,
      status: 'published',
      published_at: new Date().toISOString(),
    });
  } catch (trackErr) {
    console.warn('Failed to track publication in ghl_published_posts:', trackErr);
  }

  // Log the success
  await logAutomation(supabase, item.autopilot_id || 'agent', item.output_id, null, 'published', null, {
    account_id: item.account_id,
    platform: item.platform,
    is_repost: item.is_repost,
    variation_mode: item.variation_mode || 'exact'
  });
  return true;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Post-process caption text to clean up common LLM artifacts.
 * - Replaces em dashes (---, --, \u2014, \u2013) with ", "
 */
function postProcessCaption(caption: string): string {
  if (!caption) return caption;
  // normalizeDashes covers em/en dashes and the ASCII '--' stand-in.
  return normalizeDashes(caption);
}

/**
 * A queue row's own content over the output's. Media is replaced as a whole:
 * a row that names images or a video publishes exactly those, so a picture on
 * the output can't ride along with a row that chose a video.
 */
function applyPublishOverride(base: any, override: PublishQueueItem['publish_content']): any {
  if (!override || typeof override !== 'object') return base;
  const content = { ...base };
  // The row's caption is exact, blank included (a picture-only post): falling
  // back to the output would publish text the person removed.
  if (typeof override.caption === 'string') {
    content.caption = override.caption;
    content.captionExact = true;
  }
  const images = Array.isArray(override.images) ? override.images.filter((u) => typeof u === 'string' && u) : null;
  const videoUrl = typeof override.videoUrl === 'string' && override.videoUrl ? override.videoUrl : null;
  if (images || videoUrl) {
    content.images = images ?? [];
    content.videoUrl = videoUrl ?? undefined;
    content.postType = videoUrl ? 'reel' : (images && images.length > 1 ? 'CAROUSEL' : 'POST');
  }
  // The Scheduler only sets 'story' on Instagram/Facebook rows; push-to-ghl
  // sends it as a GHL story, picture or video.
  if (override.postType === 'story') content.postType = 'story';
  if (typeof override.followUpComment === 'string' && override.followUpComment.trim()) {
    content.followUpComment = override.followUpComment;
  }
  return content;
}

/**
 * A rich_article output as a published WordPress post (same fields as the
 * manual WordPress publish dialog).
 */
function buildWordPressArticle(output: ContentOutput): Record<string, unknown> {
  const data = output.data || {};
  return {
    title: data.seo?.meta_title || data.title || 'Untitled',
    content: data.text || '',
    excerpt: data.metadata?.excerpt,
    slug: data.seo?.slug,
    status: 'publish',
    featured_image_url: data.image_url || output.stage_data?.image?.url,
    featured_image_alt: data.metadata?.featured_image_alt,
    meta_description: data.seo?.meta_description,
    focus_keyword: data.seo?.focus_keyword,
  };
}

/**
 * Build publish content from output based on pipeline type
 */
function buildPublishContent(output: ContentOutput): any {
  const data = output.data || {};
  const stageData = output.stage_data || {};

  // Debug: Log the full caption stage data structure
  console.log('🔍 [buildPublishContent] Inspecting stage_data.caption:', JSON.stringify(stageData.caption, null, 2));
  console.log('🔍 [buildPublishContent] stage_data keys:', Object.keys(stageData));

  // Base content structure
  const content: any = {
    caption: '',
    images: [],
    tags: [],
    postType: 'POST'
  };

  switch (output.pipeline) {
    case 'social_media_post':
      // Caption from stage_data or data (content first: hand edits only update content)
      content.caption = stageText(stageData.caption) || data.text || data.caption || '';

      // Media from image stage — a saved video (media_type === 'video') is
      // published as a video/reel; otherwise attach the image.
      if (stageData.image?.media_type === 'video' && (stageData.image?.video_url || stageData.image?.url)) {
        content.videoUrl = stageData.image.video_url || stageData.image.url;
        content.postType = 'reel';
      } else if (stageData.image?.url || stageData.image?.image_url) {
        content.images = [stageData.image.url || stageData.image.image_url];
      }
      break;

    case 'instagram_carousel':
    case 'instagram_carousel_ai':
      // AI carousels store their slides in the same carousel_slides stage; they used
      // to fall through to the text-only default and publish with no images.
      // Caption from caption stage (content first: hand edits only update content)
      content.caption = stageText(stageData.caption) || data.caption || '';

      // Slides from carousel_slides stage
      const slides = stageData.carousel_slides?.slides || [];
      content.images = slides
        .filter((s: any) => s.image_url)
        .map((s: any) => s.image_url);

      content.postType = 'CAROUSEL';
      break;

    case 'generative_video_oneshot':
    case 'ugc_video':
      // Caption priority: auto-generated post_caption stage > manual caption > script > title
      content.caption = stageText(stageData.post_caption)
        || stageData.final?.caption
        || data.title || stageText(stageData.script) || '';

      // Video from final stage
      if (stageData.final?.video_url || stageData.final?.url) {
        content.videoUrl = stageData.final.video_url || stageData.final.url;
      }

      content.postType = 'REEL';
      break;

    case 'ugc_heygen':
      // Caption priority: auto-generated post_caption stage > manual caption > script > title
      content.caption = stageText(stageData.post_caption)
        || stageData.final?.caption
        || data.title || stageText(stageData.script) || '';

      // Video from video stage (HeyGen avatar video)
      if (stageData.video?.video_url || stageData.video?.url) {
        content.videoUrl = stageData.video.video_url || stageData.video.url;
      }

      content.postType = 'REEL';
      break;

    case 'ugc_heygen_template':
      // Caption priority: auto-generated post_caption stage > manual caption > variables > title
      content.caption = stageText(stageData.post_caption)
        || stageData.final?.caption
        || data.title || stageText(stageData.variables) || '';

      // Video from video stage (HeyGen template video)
      if (stageData.video?.video_url || stageData.video?.url) {
        content.videoUrl = stageData.video.video_url || stageData.video.url;
      }

      content.postType = 'REEL';
      break;

    case 'storyboard_video_longform':
      // Caption priority: auto-generated post_caption stage > manual caption > outline > title
      content.caption = stageText(stageData.post_caption)
        || stageData.final?.caption
        || data.title || stageText(stageData.outline) || '';

      // Video from final stage
      if (stageData.final?.video_url || stageData.final?.url) {
        content.videoUrl = stageData.final.video_url || stageData.final.url;
      }

      content.postType = 'REEL';
      break;

    case 'video':
    case 'presenter_video':
    case 'video_remix': {
      // Caption priority: auto-generated post_caption stage > manual caption > outline > title
      content.caption = stageText(stageData.post_caption)
        || stageData.final?.caption
        || data.title || stageText(stageData.outline) || '';

      // Video from composition stage
      const videoUrl = stageData.composition?.video_url || stageData.composition?.url
        || stageData.final?.video_url || stageData.final?.url;
      if (videoUrl) {
        content.videoUrl = videoUrl;
      }

      content.postType = 'REEL';
      break;
    }

    case 'twitter_thread': {
      // thread_tweets stage stores a JSON array as a string in stage_data.thread_tweets.content
      const raw = stageData.thread_tweets?.content || stageData.thread_tweets?.text || '';
      try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const tweets: Array<{ text: string; media_urls?: string[] }> = Array.isArray(parsed?.tweets)
          ? parsed.tweets
          : Array.isArray(parsed)
            ? parsed
            : [];
        content.thread_tweets = tweets.filter(t => t.text?.trim());
        // Use first tweet as caption for fallback single-tweet publish
        content.caption = tweets[0]?.text || '';
      } catch (e) {
        console.warn('[buildPublishContent] Failed to parse twitter_thread tweets JSON:', e);
        content.caption = raw;
      }
      break;
    }

    case 'image_only':
      // The picture is the post: it used to fall through to the text-only default,
      // so image blueprints in an autopilot mix went out without their image.
      content.caption = stageText(stageData.caption) || data.caption || data.text || data.title || '';
      if (stageData.image?.url || stageData.image?.image_url) {
        content.images = [stageData.image.url || stageData.image.image_url];
      }
      break;

    default:
      // Generic text content
      content.caption = data.text || data.caption || data.title || '';
  }

  // Extract tags if available
  if (data.metadata?.tags) {
    content.tags = data.metadata.tags;
  }

  // Log extracted content for debugging
  console.log(`📝 [buildPublishContent] Pipeline: ${output.pipeline}, Caption length: ${content.caption?.length || 0}, Images: ${content.images?.length || 0}, PostType: ${content.postType}`);
  if (!content.caption) {
    console.warn(`⚠️ [buildPublishContent] No caption found! stage_data keys: ${Object.keys(stageData).join(', ')}, caption stage data:`, stageData.caption);
  }

  return content;
}

/**
 * Generate a slight variation of the caption using AI
 * Keeps the same meaning but rephrases for freshness
 */
async function generateCaptionVariation(
  originalCaption: string,
  organizationId: string,
  supabase: any
): Promise<string | null> {
  if (!originalCaption || originalCaption.trim().length === 0) {
    return null;
  }

  // Get the organization's OpenRouter API key
  const { data: apiKey } = await supabase
    .from('api_keys')
    .select('key_encrypted')
    .eq('organization_id', organizationId)
    .eq('provider', 'openrouter')
    .maybeSingle();

  if (!apiKey?.key_encrypted) {
    console.warn('No OpenRouter API key found for caption variation');
    return null;
  }

  // Decrypt the API key before use
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
  const decryptedKey = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

  // Get the organization's default LLM model from settings
  const { data: orgSettings } = await supabase
    .from('organization_settings')
    .select('default_llm_model')
    .eq('organization_id', organizationId)
    .maybeSingle();

  const model = orgSettings?.default_llm_model || 'google/gemini-2.0-flash-001';
  console.log(`🤖 [Caption Variation] Using model: ${model}`);

  const prompt = `You are a social media expert. Rewrite this caption with slight variations while keeping the same meaning, tone, and key message. Keep hashtags similar but you can vary them slightly. Keep the same approximate length.

Original caption:
${originalCaption}

Provide ONLY the rewritten caption, nothing else.`;

  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${decryptedKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://app.screenshotperfect.com',
      },
      body: JSON.stringify({
        model: model,
        messages: [
          { role: 'user', content: prompt }
        ],
        max_tokens: 1000,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter API error: ${response.status}`);
    }

    const data = await response.json();
    const variedCaption = data.choices?.[0]?.message?.content?.trim();

    if (variedCaption && variedCaption.length > 0) {
      return variedCaption;
    }

    return null;
  } catch (error) {
    console.error('Failed to generate caption variation:', error);
    return null;
  }
}

/**
 * Log an automation event
 */
async function logAutomation(
  supabase: any,
  autopilotId: string,
  outputId: string | null,
  jobId: string | null,
  eventType: string,
  stageId: string | null,
  details: any
): Promise<void> {
  try {
    await supabase.from('automation_logs').insert({
      autopilot_id: autopilotId,
      output_id: outputId,
      job_id: jobId,
      event_type: eventType,
      stage_id: stageId,
      details
    });
  } catch (error) {
    console.error('Failed to log automation event:', error);
  }
}
