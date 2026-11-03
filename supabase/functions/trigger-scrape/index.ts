import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Actor ID mapping for different platforms and types
const ACTOR_IDS = {
  youtube: {
    posts: 'streamers~youtube-scraper',
    search: 'streamers~youtube-scraper'
  },
  instagram: {
    posts: 'apify~instagram-post-scraper',
    profile: 'apify~instagram-profile-scraper'
  },
  tiktok: {
    posts: 'clockworks~tiktok-scraper',
    profile: 'scraptik~tiktok-api'
  },
  linkedin: {
    posts: 'supreme_coder~linkedin-post',
    profile: 'apimaestro~linkedin-profile-detail',
    search: 'apimaestro~linkedin-posts-search-scraper-no-cookies'
  },
  twitter: {
    posts: 'apidojo~tweet-scraper',
    search: 'apidojo~tweet-scraper'
  }
};

interface TriggerScrapeRequest {
  type: 'creator' | 'search_term';
  targetId: string;
  organizationId?: string; // Optional: passed from frontend when impersonating
  options?: {
    maxItems?: number;
    maxShorts?: number;
    daysBack?: number;
    forceRefresh?: boolean;
    scrapeProfile?: boolean;
    minIntervalMinutes?: number;
    applyDateFilter?: boolean;
  };
}

// Default gate window: skip duplicate scrapes if the last success was within this many minutes,
// unless forceRefresh is true or scrape_config.minIntervalMinutes overrides it.
const DEFAULT_MIN_INTERVAL_MINUTES = 30;

// Look up the latest SUCCEEDED run timestamp for a target so we can both
// (a) gate too-frequent scrapes and (b) shrink the actor's date window to only fetch new content.
async function getLastSuccessfulRun(
  supabase: any,
  type: 'creator' | 'search_term',
  targetId: string
): Promise<{ completedAt: string | null }> {
  const field = type === 'creator' ? 'creator_id' : 'search_term_id';
  const { data } = await supabase
    .from('research_scrape_runs')
    .select('completed_at')
    .eq(field, targetId)
    .eq('status', 'SUCCEEDED')
    .not('completed_at', 'is', null)
    .order('completed_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return { completedAt: data?.completed_at ?? null };
}

// Compute the smallest date window that still covers everything since the last successful scrape,
// capped at the user's configured daysBack and floored at 1 day. Adds a 1-day safety overlap
// to absorb clock skew and late-publishing posts.
function computeEffectiveDaysBack(
  lastCompletedAt: string | null,
  configuredDaysBack: number
): number {
  if (!lastCompletedAt) return configuredDaysBack;
  const hoursSince = (Date.now() - new Date(lastCompletedAt).getTime()) / 36e5;
  const effective = Math.max(1, Math.ceil(hoursSince / 24) + 1);
  return Math.min(configuredDaysBack, effective);
}

// Decrypt API key using AES-GCM
// Supports two formats:
// 1. Base64 format (new): IV + ciphertext combined in base64
// 2. Hex with colons format (legacy): ivHex:authTagHex:encryptedHex
async function decryptApiKey(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  if (!encryptedData || typeof encryptedData !== 'string') {
    throw new Error('Invalid encrypted data: API key is missing or corrupted');
  }

  if (!encryptionKeyHex || typeof encryptionKeyHex !== 'string') {
    throw new Error('Encryption key not configured on server');
  }

  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  // Check if it's the legacy hex:colons format (contains exactly 2 colons)
  const parts = encryptedData.split(':');
  if (parts.length === 3 && parts.every(p => /^[0-9a-fA-F]+$/.test(p))) {
    // Legacy format: ivHex:authTagHex:encryptedHex
    const [ivHex, authTagHex, encryptedHex] = parts;
    const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    const encrypted = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128 },
      key,
      new Uint8Array([...encrypted, ...authTag])
    );

    return new TextDecoder().decode(decrypted);
  }

  // New format: Base64 encoded (IV + ciphertext combined)
  // The ciphertext already includes the auth tag at the end (AES-GCM default behavior)
  try {
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));

    // First 12 bytes are IV, rest is ciphertext (includes auth tag)
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('[Decrypt] Base64 decryption failed:', error);
    throw new Error('Failed to decrypt API key. Please re-add your API key in Settings.');
  }
}

// Build platform-specific payload for creators
function buildCreatorPayload(creator: any, options: any) {
  const maxItems = options?.maxItems || 100;
  const maxShortsCount = options?.maxShorts !== undefined ? options.maxShorts : 50;
  const daysBack = options?.daysBack || 7;
  
  switch (creator.platform) {
    case 'youtube': {
      // Build YouTube payload
      // Note: We don't use oldestPostDate filter anymore because:
      // 1. If a creator hasn't posted recently, we get 0 items and no profile data
      // 2. Channel metadata (avatar, subscriber count, etc.) is embedded in video items
      // 3. We need at least 1 video to extract profile data
      // Instead, we limit by maxResults which is more predictable
      const youtubePayload: Record<string, any> = {
        startUrls: [{ url: creator.channel_url }],
        maxResults: maxItems,
        maxResultsShorts: maxShortsCount,
        downloadSubtitles: true,
        preferAutoGeneratedSubtitles: true,
        saveSubsToKVS: true,
        subtitlesFormat: 'plaintext',
        subtitlesLanguage: 'en',
        sortVideosBy: 'NEWEST',
        sortingOrder: 'views',
        hasCC: false,
        hasLocation: false,
        hasSubtitles: false,
        is360: false,
        is3D: false,
        is4K: false,
        isBought: false,
        isHD: false,
        isHDR: false,
        isLive: false,
        isVR180: false,
        maxResultStreams: 0
      };

      // Only apply date filter if explicitly requested AND not for initial profile fetch
      // This ensures we always get at least some videos for profile data extraction
      if (options?.daysBack && options?.applyDateFilter) {
        youtubePayload.oldestPostDate = `${daysBack} days`;
      }

      return youtubePayload;
    }
    
    case 'instagram':
      // Extract username from URL or use channel_id
      const username = creator.channel_id?.replace('@', '') || creator.channel_url?.split('/').pop()?.replace('@', '');
      return {
        username: [username],
        resultsLimit: maxItems || 20,
        onlyPostsNewerThan: '1 week',
        skipPinnedPosts: false
      };
    
    case 'tiktok':
      const tiktokUsername = creator.channel_id || `@${creator.channel_url?.split('/').pop()}`;
      return {
        profiles: [tiktokUsername],
        resultsPerPage: maxItems,
        shouldDownloadSubtitles: true,
        shouldDownloadVideos: false,
        oldestPostDateUnified: daysBack ? `${daysBack} days` : '1 week',
        profileScrapeSections: ['videos'],
        excludePinnedPosts: false,
        proxyCountryCode: 'DE',
        scrapeRelatedVideos: false,
        shouldDownloadAvatars: true,
        shouldDownloadCovers: false,
        shouldDownloadMusicCovers: false,
        shouldDownloadSlideshowImages: false
      };
    
    case 'linkedin':
      // Convert daysBack to ISO date for LinkedIn scrapeUntil
      const daysAgo = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
      const scrapeUntil = daysAgo.toISOString().split('T')[0];

      return {
        urls: [creator.channel_url],
        limitPerSource: maxItems,
        deepScrape: options?.deepScrape || false,
        rawData: options?.rawData || false,
        scrapeUntil
      };

    case 'twitter': {
      const twitterPayload: Record<string, any> = {
        twitterHandles: [creator.channel_id],
        maxItems,
        sort: 'Latest'
      };

      if (options?.daysBack && options?.applyDateFilter) {
        const twitterSince = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
        twitterPayload.start = twitterSince.toISOString().split('T')[0];
      }

      return twitterPayload;
    }

    default:
      throw new Error(`Unsupported platform: ${creator.platform}`);
  }
}

// Build payload for search terms
function buildSearchPayload(searchTerm: any, options: any) {
  const maxItems = options?.maxItems || 50;
  const maxShortsCount = options?.maxShorts !== undefined ? options.maxShorts : 50;
  const daysBack = options?.daysBack || 7;
  
  switch (searchTerm.platform) {
    case 'youtube':
      return {
        searchQueries: [searchTerm.search_term],
        maxResults: maxItems,
        maxResultsShorts: maxShortsCount,
        downloadSubtitles: true,
        preferAutoGeneratedSubtitles: true,
        saveSubsToKVS: true,
        subtitlesFormat: 'plaintext',
        subtitlesLanguage: 'en',
        dateFilter: 'week',
        oldestPostDate: `${daysBack} days`,
        sortVideosBy: 'POPULAR',
        sortingOrder: 'relevance',
        hasCC: false,
        hasLocation: false,
        hasSubtitles: false,
        is360: false,
        is3D: false,
        is4K: false,
        isBought: false,
        isHD: false,
        isHDR: false,
        isLive: false,
        isVR180: false,
        maxResultStreams: 0
      };
    
    case 'tiktok':
      return {
        searchQueries: [searchTerm.search_term],
        resultsPerPage: maxItems,
        shouldDownloadSubtitles: true,
        shouldDownloadVideos: false,
        oldestPostDateUnified: daysBack ? `${daysBack} days` : '1 week',
        profileScrapeSections: ['videos'],
        excludePinnedPosts: false,
        proxyCountryCode: 'DE',
        scrapeRelatedVideos: false,
        shouldDownloadAvatars: true,
        shouldDownloadCovers: false,
        shouldDownloadMusicCovers: false,
        shouldDownloadSlideshowImages: false
      };
    
    case 'linkedin':
      // Map daysBack to LinkedIn date_filter
      let date_filter = 'past-week'; // default
      if (daysBack <= 1) {
        date_filter = 'past-24h';
      } else if (daysBack <= 7) {
        date_filter = 'past-week';
      } else if (daysBack <= 30) {
        date_filter = 'past-month';
      } else {
        date_filter = 'no-filter';
      }
      
      return {
        keyword: searchTerm.search_term,
        limit: Math.min(maxItems, 50), // LinkedIn API max is 50
        date_filter
      };

    case 'twitter': {
      const twitterSearchPayload: Record<string, any> = {
        searchTerms: [searchTerm.search_term],
        maxItems,
        sort: 'Latest'
      };

      if (daysBack) {
        const twitterSearchSince = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000);
        twitterSearchPayload.start = twitterSearchSince.toISOString().split('T')[0];
      }

      return twitterSearchPayload;
    }

    default:
      throw new Error(`Unsupported platform for search: ${searchTerm.platform}`);
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get authorization and determine organization
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    // Parse request body first
    const body: TriggerScrapeRequest = await req.json();
    const { type, targetId, organizationId: requestOrgId, options = {} } = body;

    console.log('[Trigger Scrape] Request:', { type, targetId, requestOrgId, options });

    let orgId: string;
    const token = authHeader.replace('Bearer ', '');
    
    // Check if this is a service role call (from execute-schedules)
    const isServiceRole = token === supabaseKey;
    
    if (isServiceRole) {
      // For service role calls, get orgId from the target record
      console.log('[Trigger Scrape] Service role call detected');
      
      // Get organization from the target
      if (type === 'creator') {
        const { data: creator } = await supabase
          .from('research_creators')
          .select('organization_id')
          .eq('id', targetId)
          .single();
        
        if (!creator) throw new Error('Creator not found');
        orgId = creator.organization_id;
      } else {
        const { data: searchTerm } = await supabase
          .from('research_search_terms')
          .select('organization_id')
          .eq('id', targetId)
          .single();
        
        if (!searchTerm) throw new Error('Search term not found');
        orgId = searchTerm.organization_id;
      }
    } else {
      // Normal JWT authentication
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);

      if (userError || !user) {
        throw new Error('Unauthorized');
      }

      // If organizationId is provided in request body (from frontend impersonation), use it
      // Otherwise fall back to user's active/default organization
      if (requestOrgId) {
        // Verify user has access to this organization (is a member or super admin)
        const { data: membership } = await supabase
          .from('organization_members')
          .select('role')
          .eq('organization_id', requestOrgId)
          .eq('user_id', user.id)
          .single();

        const { data: userRecord } = await supabase
          .from('users')
          .select('is_super_admin')
          .eq('id', user.id)
          .single();

        // Check if user is agency owner impersonating a client
        const { data: agencyCheck } = await supabase
          .from('organizations')
          .select('parent_id')
          .eq('id', requestOrgId)
          .single();

        let hasAgencyAccess = false;
        if (agencyCheck?.parent_id) {
          const { data: agencyMembership } = await supabase
            .from('organization_members')
            .select('role')
            .eq('organization_id', agencyCheck.parent_id)
            .eq('user_id', user.id)
            .single();
          hasAgencyAccess = !!agencyMembership;
        }

        if (!membership && !userRecord?.is_super_admin && !hasAgencyAccess) {
          throw new Error('Unauthorized: No access to specified organization');
        }

        orgId = requestOrgId;
        console.log('[Trigger Scrape] Using organization from request (impersonation):', orgId);
      } else {
        // Get user's organization from database
        const { data: userData, error: orgError } = await supabase
          .from('users')
          .select('organization_id, active_organization_id')
          .eq('id', user.id)
          .single();

        if (orgError) throw orgError;

        orgId = userData.active_organization_id || userData.organization_id;
      }
    }

    // Get Apify API key
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKey) {
      throw new Error('Apify API key not found. Please add your Apify API key in Settings.');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Check for already-running scrapes for this target to prevent duplicates
    const runningField = type === 'creator' ? 'creator_id' : 'search_term_id';
    const { data: existingRuns } = await supabase
      .from('research_scrape_runs')
      .select('run_id')
      .eq(runningField, targetId)
      .in('status', ['RUNNING', 'PROCESSING'])
      .limit(1);

    if (existingRuns && existingRuns.length > 0) {
      throw new Error('A scrape is already in progress for this target. Please wait for it to complete.');
    }

    // Fetch target (creator or search term)
    let target: any;
    let platform: string;
    let actorPayload: any;
    let actorId: string;
    let targetName: string;
    let scrapeConfig: any = null;

    if (type === 'creator') {
      const { data: creator, error: creatorError } = await supabase
        .from('research_creators')
        .select('*')
        .eq('id', targetId)
        .single();

      if (creatorError || !creator) {
        throw new Error('Creator not found');
      }

      target = creator;
      platform = creator.platform;
      targetName = creator.display_name;
      const actorConfig = ACTOR_IDS[platform as keyof typeof ACTOR_IDS] as any;
      actorId = actorConfig?.posts || actorConfig?.profile || '';

      if (!actorId) {
        throw new Error(`No actor configured for platform: ${platform}`);
      }
    } else {
      const { data: searchTerm, error: searchError } = await supabase
        .from('research_search_terms')
        .select('*')
        .eq('id', targetId)
        .single();

      if (searchError || !searchTerm) {
        throw new Error('Search term not found');
      }

      target = searchTerm;
      platform = searchTerm.platform;
      targetName = searchTerm.search_term;
      const actorConfig = ACTOR_IDS[platform as keyof typeof ACTOR_IDS] as any;
      actorId = actorConfig?.search || actorConfig?.posts || '';

      if (!actorId) {
        throw new Error(`No actor configured for platform: ${platform}`);
      }
    }

    // Fetch the per-target scrape_config from any active schedule (used for minIntervalMinutes override)
    const scheduleTable = type === 'creator' ? 'scrape_schedules' : 'search_schedules';
    const scheduleField = type === 'creator' ? 'creator_id' : 'search_term_id';
    const { data: scheduleRow } = await supabase
      .from(scheduleTable)
      .select('scrape_config')
      .eq(scheduleField, targetId)
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    scrapeConfig = scheduleRow?.scrape_config ?? null;

    // Look up last successful run -- used both for the min-interval gate and the dynamic since-cursor.
    const { completedAt: lastSuccessAt } = await getLastSuccessfulRun(supabase, type, targetId);

    // Min-interval gate: refuse to scrape if the last success was too recent, unless forceRefresh.
    const minIntervalMinutes = options.minIntervalMinutes
      ?? scrapeConfig?.minIntervalMinutes
      ?? DEFAULT_MIN_INTERVAL_MINUTES;

    if (!options.forceRefresh && lastSuccessAt) {
      const minutesSince = (Date.now() - new Date(lastSuccessAt).getTime()) / 60000;
      if (minutesSince < minIntervalMinutes) {
        console.log('[Trigger Scrape] Skipping (within min-interval gate):', {
          targetId,
          minutesSince: Math.round(minutesSince),
          minIntervalMinutes,
          lastSuccessAt,
        });
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: `Last successful scrape was ${Math.round(minutesSince)} min ago (min interval: ${minIntervalMinutes} min). Pass forceRefresh=true to override.`,
            lastScrapedAt: lastSuccessAt,
            targetName,
            platform,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Dynamic since-cursor: shrink daysBack to only cover content since the last successful run.
    // Saves Apify cost on daily-scheduled targets where the configured 7-day window mostly overlaps prior runs.
    const configuredDaysBack = options.daysBack ?? 7;
    const effectiveDaysBack = computeEffectiveDaysBack(lastSuccessAt, configuredDaysBack);
    const enrichedOptions = {
      ...options,
      daysBack: effectiveDaysBack,
      // For YouTube creators: only apply the date filter once we have a prior successful run
      // (first scrape needs the full window so we always get >=1 video for profile metadata).
      applyDateFilter: options.applyDateFilter ?? !!lastSuccessAt,
    };

    console.log('[Trigger Scrape] Date window:', {
      configuredDaysBack,
      effectiveDaysBack,
      lastSuccessAt,
      applyDateFilter: enrichedOptions.applyDateFilter,
    });

    actorPayload = type === 'creator'
      ? buildCreatorPayload(target, enrichedOptions)
      : buildSearchPayload(target, enrichedOptions);

    console.log('[Trigger Scrape] Using actor:', actorId);

    // Build webhook URL and encode as base64 for ad-hoc webhook
    // Per Apify docs: ad-hoc webhooks must be passed as base64-encoded URL parameter
    // See: https://docs.apify.com/platform/integrations/webhooks/ad-hoc-webhooks
    const webhookUrl = `${supabaseUrl}/functions/v1/apify-webhook?platform=${platform}`;
    const webhookConfig = [{
      eventTypes: ['ACTOR.RUN.SUCCEEDED', 'ACTOR.RUN.FAILED'],
      requestUrl: webhookUrl
    }];
    const webhooksParam = btoa(JSON.stringify(webhookConfig));

    // Call Apify API to start actor run with webhooks as URL parameter
    const apifyUrl = `https://api.apify.com/v2/acts/${actorId}/runs?token=${apifyToken}&webhooks=${encodeURIComponent(webhooksParam)}`;

    console.log('[Trigger Scrape] Starting Apify actor run');

    const apifyResponse = await fetch(apifyUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(actorPayload)
    });

    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      console.error('[Trigger Scrape] Apify API error:', errorText);

      // A spent monthly cap also comes back as 403, but the key is fine: don't invalidate it
      // (that would break every scrape until the key is re-saved) and don't count it as a
      // schedule failure (3 in a row auto-pauses the schedule). Skip, like the min-interval gate.
      if (apifyResponse.status === 403 && /platform-feature-disabled|usage (hard )?limit/i.test(errorText)) {
        console.warn('[Trigger Scrape] Apify usage limit reached, skipping:', errorText);
        return new Response(
          JSON.stringify({
            skipped: true,
            reason: 'Apify monthly usage limit reached. Raise the limit in your Apify account (Settings > Limits) and scrape again.',
            targetName,
            platform,
          }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if this is an authentication error (expired or invalid API key)
      if (apifyResponse.status === 401 || apifyResponse.status === 403) {
        // Mark the API key as invalid in the database
        console.log('[Trigger Scrape] Apify API key appears to be expired or invalid, marking as invalid');
        await supabase
          .from('api_keys')
          .update({ is_valid: false })
          .eq('organization_id', orgId)
          .eq('provider', 'apify');

        throw new Error('Your Apify API key has expired or is invalid. Apify keys expire every 90 days. Please go to Settings > API Keys to refresh your key.');
      }

      throw new Error(`Apify API error: ${apifyResponse.status} - ${errorText}`);
    }

    let responseData;
    let run;
    
    try {
      responseData = await apifyResponse.json();
      console.log('[Trigger Scrape] Full Apify response:', JSON.stringify(responseData, null, 2));
      
      run = responseData.data;
      
      if (!run) {
        console.error('[Trigger Scrape] No run data in response:', responseData);
        throw new Error('Invalid Apify response: missing run data');
      }
      
      if (!run.id) {
        console.error('[Trigger Scrape] No run ID in response:', run);
        throw new Error('Invalid Apify response: missing run ID');
      }
      
      console.log('[Trigger Scrape] Apify run created successfully:', run.id);
    } catch (parseError) {
      console.error('[Trigger Scrape] Error parsing Apify response:', parseError);
      console.error('[Trigger Scrape] Response was:', responseData);
      throw new Error(`Failed to parse Apify response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`);
    }

    // Store run record in research_scrape_runs
    console.log('[Trigger Scrape] Inserting run record:', {
      run_id: run.id,
      apify_run_id: run.id,
      organization_id: orgId,
      creator_id: type === 'creator' ? targetId : null,
      search_term_id: type === 'search_term' ? targetId : null,
      platform: platform,
      actor_id: actorId
    });

    let insertResult;
    try {
      insertResult = await supabase
        .from('research_scrape_runs')
        .insert({
          run_id: run.id,
          apify_run_id: run.id,
          dataset_id: run.defaultDatasetId,
          organization_id: orgId,
          creator_id: type === 'creator' ? targetId : null,
          search_term_id: type === 'search_term' ? targetId : null,
          actor_id: actorId,
          status: 'RUNNING',
          triggered_at: new Date().toISOString(),
          metadata: {
            platform: platform,
            trigger_type: isServiceRole ? 'scheduled' : 'manual',
            options: enrichedOptions,
            configured_days_back: configuredDaysBack,
            effective_days_back: effectiveDaysBack,
            last_success_at: lastSuccessAt,
            min_interval_minutes: minIntervalMinutes,
            force_refresh: !!options.forceRefresh,
          },
          apify_run_url: `https://console.apify.com/actors/${actorId}/runs/${run.id}`
        });
      
      if (insertResult.error) {
        console.error('[Trigger Scrape] Database insert error:', JSON.stringify(insertResult.error, null, 2));
        throw new Error(`Database insert failed: ${insertResult.error.message} (Code: ${insertResult.error.code})`);
      }
    } catch (dbError) {
      console.error('[Trigger Scrape] Error during database insert:', dbError);
      throw new Error(`Failed to store run record: ${dbError instanceof Error ? dbError.message : 'Unknown error'}`);
    }

    console.log('[Trigger Scrape] Successfully stored run record in database');

    // Return success response
    return new Response(
      JSON.stringify({
        runId: run.id,
        apifyRunId: run.id,
        status: 'RUNNING',
        message: 'Scrape initiated',
        targetName,
        platform,
        apifyRunUrl: `https://console.apify.com/actors/${actorId}/runs/${run.id}`
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Trigger Scrape] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        error: errorMessage,
        code: 'SCRAPE_FAILED'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
