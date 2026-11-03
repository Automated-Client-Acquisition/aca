import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { transcribeScrapedContent, type TranscriptRow } from '../_shared/scraped-transcript.ts';
import { parseIntSafe, sanitizeObject, transformContentItem, upgradeTwitterAvatarUrl } from '../_shared/research-content-transform.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};


// Decrypt API key using AES-GCM
// Supports two formats:
// 1. Base64 format (new): IV + ciphertext combined in base64
// 2. Hex with colons format (legacy): ivHex:authTagHex:encryptedHex
async function decryptApiKey(encryptedData: string, encryptionKeyHex: string): Promise<string> {
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
  const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const ciphertext = combined.slice(12);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new TextDecoder().decode(decrypted);
}

// Upload file to storage
async function uploadToStorage(
  supabase: any,
  url: string,
  storagePath: string
): Promise<string> {
  console.log(`[Storage] Downloading from ${url}`);
  const response = await fetch(url);
  
  if (!response.ok) {
    throw new Error(`Failed to download: ${response.status}`);
  }

  const blob = await response.blob();
  const arrayBuffer = await blob.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  console.log(`[Storage] Uploading to ${storagePath}`);
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from('videos')
    .upload(storagePath, uint8Array, {
      contentType: blob.type || 'image/jpeg',
      upsert: true
    });

  if (uploadError) {
    console.error('[Storage] Upload error:', uploadError);
    throw uploadError;
  }

  const { data: { publicUrl } } = supabase.storage
    .from('videos')
    .getPublicUrl(storagePath);

  console.log(`[Storage] Upload successful: ${publicUrl}`);
  return publicUrl;
}

// Process profile data from Apify
async function processProfileData(
  supabase: any,
  runId: string,
  datasetId: string,
  platform: string,
  creatorId: string
) {
  try {
    console.log('[Process Profile] Starting:', { runId, datasetId, platform, creatorId });

    // Get API key for dataset access
    const { data: run } = await supabase
      .from('research_scrape_runs')
      .select('organization_id')
      .eq('apify_run_id', runId)
      .single();

    const { data: apiKey } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', run.organization_id)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .single();

    if (!apiKey) {
      throw new Error('Apify API key not found');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Fetch profile data
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
    const response = await fetch(datasetUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch dataset: ${response.status}`);
    }

    const profileData = await response.json();
    console.log('[Process Profile] Received items:', profileData.length);

    if (!profileData || profileData.length === 0) {
      throw new Error('No profile data in dataset');
    }

    const profile = profileData[0];
    console.log('[Process Profile] Profile data:', {
      id: profile.id,
      uniqueId: profile.uniqueId,
      nickname: profile.nickname
    });

    // Extract profile data based on platform
    let updateData: any = {};
    let avatarSourceUrl: string | null = null;

    if (platform === 'youtube') {
      avatarSourceUrl = profile.thumbnails?.[0]?.url;
      updateData = {
        display_name: profile.title,
        description: profile.description,
        subscriber_count: profile.subscriberCount || 0,
        video_count: profile.videoCount || 0,
        view_count: profile.viewCount || 0,
        follower_count: profile.subscriberCount || 0, // YouTube uses subscriber count
      };
    } else if (platform === 'tiktok') {
      // TikTok wraps profile in 'user' object
      const user = profile.user || profile;
      avatarSourceUrl = user.avatar_larger?.url_list?.[0] || user.avatar_medium?.url_list?.[0];
      
      updateData = {
        display_name: user.nickname || user.unique_id,
        description: user.signature || '',
        follower_count: user.follower_count || 0,
        following_count: user.following_count || 0,
        video_count: user.aweme_count || user.video_count || 0,
        total_likes: user.total_favorited || 0,
        verified: user.verification_type === 1 || user.verified === true,
      };
    } else if (platform === 'instagram') {
      avatarSourceUrl = profile.profile_pic_url || profile.profilePicUrl;
      updateData = {
        display_name: profile.full_name || profile.username,
        description: profile.biography || profile.bio || '',
        follower_count: profile.followers || profile.follower_count || 0,
        following_count: profile.following || profile.following_count || 0,
        video_count: profile.posts || profile.media_count || 0,
        verified: profile.is_verified || profile.verified || false,
      };
    } else if (platform === 'linkedin') {
      avatarSourceUrl = profile.profilePictureUrl || profile.profilePicture;
      updateData = {
        display_name: profile.name || profile.firstName + ' ' + profile.lastName,
        description: profile.headline || '',
        follower_count: profile.followerCount || profile.followers || 0,
      };
    }

    // Download and upload avatar to BYOK storage
    if (avatarSourceUrl) {
      try {
        const storagePath = `research/profiles/${platform}/${creatorId}_avatar_${Date.now()}.jpg`;
        const uploadedUrl = await uploadToStorage(supabase, avatarSourceUrl, storagePath);
        updateData.avatar_url = uploadedUrl;
        console.log('[Process Profile] Avatar uploaded:', uploadedUrl);
      } catch (avatarError) {
        console.error('[Process Profile] Avatar upload failed:', avatarError);
        // Continue without avatar
      }
    }

    // Store full profile data in metadata for reference
    updateData.metadata = profile;
    updateData.last_scraped_at = new Date().toISOString();
    updateData.updated_at = new Date().toISOString();

    // Update creator record
    const { error: updateError } = await supabase
      .from('research_creators')
      .update(updateData)
      .eq('id', creatorId);

    if (updateError) {
      throw updateError;
    }

    // Mark run as complete
    await supabase
      .from('research_scrape_runs')
      .update({
        status: 'SUCCEEDED',
        completed_at: new Date().toISOString(),
        items_scraped: 1
      })
      .eq('apify_run_id', runId);

    console.log('[Process Profile] Completed successfully');

  } catch (error) {
    console.error('[Process Profile] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await supabase
      .from('research_scrape_runs')
      .update({
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        error_message: errorMessage
      })
      .eq('apify_run_id', runId);
  }
}

// Process dataset from harvestapi/linkedin-company-employees into public_signal_people
async function processSignalPeopleDataset(supabase: any, runId: string, datasetId: string) {
  console.log('[Signal Enrichment] Processing dataset:', datasetId);

  const apifyToken = Deno.env.get('APIFY_TOKEN');
  if (!apifyToken) {
    console.error('[Signal Enrichment] Missing APIFY_TOKEN');
    return;
  }

  try {
    // This webhook is unauthenticated. Confirm the run belongs to OUR Apify account and the
    // dataset is that run's output, so a forged payload cannot inject an attacker's dataset.
    const [runResp, meResp] = await Promise.all([
      fetch(`https://api.apify.com/v2/actor-runs/${encodeURIComponent(runId)}?token=${apifyToken}`),
      fetch(`https://api.apify.com/v2/users/me?token=${apifyToken}`),
    ]);
    const run = runResp.ok ? (await runResp.json())?.data : null;
    const me = meResp.ok ? (await meResp.json())?.data : null;
    if (!run || !me?.id || run.userId !== me.id || run.defaultDatasetId !== datasetId || run.status !== 'SUCCEEDED') {
      console.warn('[Signal Enrichment] Rejected unverified run/dataset:', { runId, datasetId });
      return;
    }

    // Fetch all items from the dataset
    const itemsUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
    const itemsResp = await fetch(itemsUrl);
    if (!itemsResp.ok) {
      throw new Error(`Failed to fetch dataset: ${itemsResp.status}`);
    }
    const people = await itemsResp.json();

    console.log(`[Signal Enrichment] Got ${people.length} profiles from dataset`);

    if (!people.length) return;

    // Build INSERT values
    const values: string[] = [];

    for (const person of people) {
      const linkedinUrl = person.linkedinUrl || person.profileUrl || '';
      if (!linkedinUrl) continue;

      const first = (person.firstName || '').trim();
      const last = (person.lastName || '').trim();
      const fullName = `${first} ${last}`.trim() || (person.name || '').trim();
      if (!fullName) continue;

      const headline = person.headline || '';
      const companyName = person.companyName || '';
      const companySlug = person.companySlug || '';

      // Seniority
      let seniorityRank = 50;
      const rawSeniority = person.seniorityLevel;
      if (typeof rawSeniority === 'number' && rawSeniority > 0) {
        seniorityRank = rawSeniority;
      } else {
        const low = headline.toLowerCase();
        if (low.includes('ceo') || low.includes('cto') || low.includes('cfo') || low.includes('cro') || low.includes('cmo')) seniorityRank = 90;
        else if (low.includes('vp ') || low.includes('vice president')) seniorityRank = 80;
        else if (low.includes('director')) seniorityRank = 70;
        else if (low.includes('head of')) seniorityRank = 75;
        else if (low.includes('owner') || low.includes('partner') || low.includes('founder')) seniorityRank = 85;
        else if (low.includes('manager')) seniorityRank = 55;
      }

      // Company key
      let companyKey = '';
      if (companySlug) {
        companyKey = companySlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      if (!companyKey && companyName) {
        companyKey = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      }
      if (!companyKey) {
        const urlMatch = linkedinUrl.match(/linkedin\.com\/company\/([^/]+)/);
        if (urlMatch) companyKey = urlMatch[1];
      }
      if (!companyKey) continue;

      const safeKey = companyKey.replace(/'/g, "''");
      const safeName = fullName.replace(/'/g, "''");
      const safeTitle = headline.replace(/'/g, "''");
      const safeUrl = linkedinUrl.replace(/'/g, "''");
      const safePhoto = (person.profilePicture || person.profilePictureUrl || '').replace(/'/g, "''");

      values.push(`('${safeKey}', '${safeName}', '${safeTitle}', '${safeUrl}', '${safePhoto}', ${seniorityRank})`);
    }

    if (!values.length) {
      console.log('[Signal Enrichment] No valid people to insert');
      return;
    }

    // Build objects for Supabase insert
    const rowsToInsert = people
      .map((person: any) => {
        const linkedinUrl = person.linkedinUrl || person.profileUrl || '';
        if (!linkedinUrl) return null;

        const first = (person.firstName || '').trim();
        const last = (person.lastName || '').trim();
        const fullName = `${first} ${last}`.trim() || (person.name || '').trim();
        if (!fullName) return null;

        const headline = person.headline || '';
        const companySlug = person.companySlug || person.companyName || '';
        let companyKey = companySlug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        if (!companyKey) {
          const m = linkedinUrl.match(/linkedin\.com\/company\/([^/]+)/);
          if (m) companyKey = m[1];
        }
        if (!companyKey) return null;

        let seniorityRank = 50;
        if (typeof person.seniorityLevel === 'number' && person.seniorityLevel > 0) {
          seniorityRank = person.seniorityLevel;
        }

        return {
          company_key: companyKey,
          full_name: fullName,
          title: headline,
          linkedin_url: linkedinUrl,
          photo_url: person.profilePicture || person.profilePictureUrl || null,
          seniority_rank: seniorityRank,
        };
      })
      .filter(Boolean);

    if (rowsToInsert.length === 0) {
      console.log('[Signal Enrichment] No valid rows after mapping');
      return;
    }

    const { error: insertError } = await supabase
      .from('public_signal_people')
      .insert(rowsToInsert, { onConflict: 'linkedin_url' }); // will be ignored due to DO NOTHING in table

    if (insertError) {
      console.error('[Signal Enrichment] Insert error:', insertError);
    } else {
      console.log(`[Signal Enrichment] Successfully inserted ${rowsToInsert.length} people`);
    }
  } catch (err) {
    console.error('[Signal Enrichment] Error processing dataset:', err);
  }
}

// Process dataset and insert content
async function processDataset(
  supabase: any,
  runId: string,
  datasetId: string,
  platform: string,
  orgId: string,
  creatorId: string | null,
  searchTermId: string | null
) {
  try {
    console.log('[Process Dataset] Starting:', { runId, datasetId, platform });

    // Get Apify token
    const { data: apiKey, error: keyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', orgId)
      .eq('provider', 'apify')
      .eq('is_valid', true)
      .single();

    if (keyError || !apiKey) {
      throw new Error('Apify API key not found');
    }

    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const apifyToken = await decryptApiKey(apiKey.key_encrypted, encryptionKey);

    // Fetch dataset from Apify
    const datasetUrl = `https://api.apify.com/v2/datasets/${datasetId}/items?token=${apifyToken}`;
    console.log('[Process Dataset] Fetching from Apify');
    
    const response = await fetch(datasetUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch dataset: ${response.status}`);
    }

    const items = await response.json();
    console.log(`[Process Dataset] Fetched ${items.length} items`);

    if (items.length === 0) {
      console.log('[Process Dataset] No content items to process');

      // Even with 0 items, we should still update the run status
      await supabase
        .from('research_scrape_runs')
        .update({
          status: 'SUCCEEDED',
          completed_at: new Date().toISOString(),
          items_scraped: 0
        })
        .eq('apify_run_id', runId);

      // Update last_scraped_at for creator/search term
      if (creatorId) {
        await supabase
          .from('research_creators')
          .update({
            last_scraped_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', creatorId);
      } else if (searchTermId) {
        await supabase
          .from('research_search_terms')
          .update({ last_scraped_at: new Date().toISOString() })
          .eq('id', searchTermId);
      }

      return;
    }

    // Transform items and sanitize all string fields to remove invalid Unicode
    const transformedItems = items
      .map((item: any) =>
        sanitizeObject(transformContentItem(item, platform, runId, orgId, creatorId, searchTermId))
      )
      .filter((item: any) => {
        // Skip error placeholder entries (e.g., DATE_FILTER_TOO_STRICT)
        if (item.raw_data?.error) {
          console.warn('[Process Dataset] Skipping error item:', {
            platform,
            error: item.raw_data.error,
            note: item.raw_data.note,
            url: item.url
          });
          return false;
        }

        // Filter out items without required fields
        if (!item.url) {
          console.warn('[Process Dataset] Skipping item without URL:', {
            platform,
            title: item.title?.slice(0, 50),
            raw_keys: Object.keys(item.raw_data || {})
          });
          return false;
        }
        return true;
      });

    // Deduplicate by URL to avoid PostgreSQL upsert error:
    // "ON CONFLICT DO UPDATE command cannot affect row a second time"
    const seenUrls = new Set<string>();
    const contentItems = transformedItems.filter((item: any) => {
      if (seenUrls.has(item.url)) {
        console.warn('[Process Dataset] Skipping duplicate URL in batch:', item.url);
        return false;
      }
      seenUrls.add(item.url);
      return true;
    });

    console.log(`[Process Dataset] Transformed ${contentItems.length} unique items (from ${items.length} raw, ${transformedItems.length} valid)`);

    // Bulk insert with upsert to avoid duplicates
    const { data: insertedData, error: insertError } = await supabase
      .from('research_content')
      .upsert(contentItems, {
        onConflict: 'organization_id,url',
        ignoreDuplicates: false
      })
      .select('id, organization_id, platform, raw_data, duration_seconds, transcript, transcript_status');

    if (insertError) {
      console.error('[Process Dataset] Insert error:', insertError);
      throw insertError;
    }

    const insertedCount = insertedData?.length || 0;
    console.log(`[Process Dataset] Inserted ${insertedCount} items`);

    // TikTok captions / Instagram Whisper — links expire, so do it now. Never
    // fails the scrape: errors land on the row's transcript_status instead.
    const needsTranscript = (insertedData || []).filter(
      (r: TranscriptRow) => (r.platform === 'tiktok' || r.platform === 'instagram') && !r.transcript
    );
    if (needsTranscript.length > 0) {
      try {
        const outcomes = await transcribeScrapedContent(supabase, needsTranscript as TranscriptRow[]);
        console.log('[Process Dataset] Transcripts:', Object.values(outcomes).reduce((acc: Record<string, number>, o) => {
          acc[o] = (acc[o] || 0) + 1;
          return acc;
        }, {}));
      } catch (err) {
        console.error('[Process Dataset] Transcription step failed:', err);
      }
    }

    // Update run record
    await supabase
      .from('research_scrape_runs')
      .update({
        status: 'SUCCEEDED',
        completed_at: new Date().toISOString(),
        items_scraped: insertedCount
      })
      .eq('apify_run_id', runId);

    // Update creator/search term last_scraped_at and count
    if (creatorId) {
      // Get current count and update
      const { count } = await supabase
        .from('research_content')
        .select('id', { count: 'exact', head: true })
        .eq('creator_id', creatorId);

      // Load creator identity for author-match guard. The post scrapers
      // (especially LinkedIn) can return reshares / mentions authored by
      // someone OTHER than the target creator, so we must verify before
      // overwriting profile fields with whoever happens to be in items[0].
      const { data: creator } = await supabase
        .from('research_creators')
        .select('channel_id, channel_url')
        .eq('id', creatorId)
        .single();

      const normalizeSlug = (s: any): string => {
        if (!s) return '';
        const str = String(s);
        try {
          return decodeURIComponent(str).toLowerCase().trim();
        } catch {
          return str.toLowerCase().trim();
        }
      };
      const creatorSlug = normalizeSlug(creator?.channel_id);
      const isAuthorMatch = (scrapedSlug: any): boolean => {
        if (!creatorSlug) return true; // no basis to compare; allow legacy behavior
        const got = normalizeSlug(scrapedSlug);
        return got !== '' && got === creatorSlug;
      };

      // Extract profile data from first item
      const firstItem = items[0];
      const profileUpdate: any = {
        last_scraped_at: new Date().toISOString(),
        total_content_items: count || 0,
        updated_at: new Date().toISOString()
      };

      // Platform-specific profile data extraction
      if (platform === 'tiktok' && firstItem.authorMeta) {
        const author = firstItem.authorMeta;
        profileUpdate.display_name = author.nickName || author.name;
        profileUpdate.description = author.signature;
        profileUpdate.verified = author.verified || false;
        profileUpdate.follower_count = author.fans || author.followerCount || null;
        profileUpdate.following_count = author.following || null;
        profileUpdate.video_count = author.aweme_count || author.video_count || author.video || null;
        profileUpdate.total_likes = author.heart || null;
        
        // Upload avatar if available
        if (author.avatar || author.originalAvatarUrl) {
          const avatarUrl = author.avatar || author.originalAvatarUrl;
          try {
            const storagePath = await uploadToStorage(
              supabase,
              avatarUrl,
              `avatars/${platform}/${creatorId}`
            );
            if (storagePath) {
              profileUpdate.avatar_url = storagePath;
            }
          } catch (error) {
            console.error('[Update Profile] Avatar upload failed:', error);
          }
        }
      } else if (platform === 'youtube' && (firstItem.channelName || firstItem.channelTitle)) {
        // Get channel info from aboutChannelInfo if available, or use root-level fields
        const channelInfo = firstItem.aboutChannelInfo || {};
        profileUpdate.display_name = firstItem.channelName || firstItem.channelTitle;
        profileUpdate.description = channelInfo.channelDescription || firstItem.channelDescription || null;
        // Apify returns numberOfSubscribers, channelTotalVideos, channelTotalViews at root or in aboutChannelInfo
        // Values may be strings or numbers, so use parseIntSafe to handle both
        const subscriberCount = parseIntSafe(firstItem.numberOfSubscribers) ?? parseIntSafe(channelInfo.numberOfSubscribers) ?? parseIntSafe(firstItem.subscriberCount);
        const videoCount = parseIntSafe(firstItem.channelTotalVideos) ?? parseIntSafe(channelInfo.channelTotalVideos) ?? parseIntSafe(firstItem.videoCount);
        const viewCount = parseIntSafe(firstItem.channelTotalViews) ?? parseIntSafe(channelInfo.channelTotalViews) ?? parseIntSafe(firstItem.viewCount);

        profileUpdate.subscriber_count = subscriberCount;
        profileUpdate.follower_count = subscriberCount;
        profileUpdate.video_count = videoCount;
        profileUpdate.view_count = viewCount;
        profileUpdate.verified = channelInfo.isChannelVerified || firstItem.isChannelVerified || false;
        console.log('[Update Profile] YouTube data extracted:', {
          display_name: profileUpdate.display_name,
          subscriber_count: subscriberCount,
          video_count: videoCount,
          view_count: viewCount,
          raw_numberOfSubscribers: firstItem.numberOfSubscribers,
          raw_channelInfo_subs: channelInfo.numberOfSubscribers,
          typeof_raw: typeof firstItem.numberOfSubscribers
        });
        
        // Upload avatar if available - check both root level and inside aboutChannelInfo
        const avatarUrl = firstItem.channelAvatarUrl || channelInfo.channelAvatarUrl || firstItem.channelThumbnail || firstItem.authorThumbnail;
        if (avatarUrl) {
          try {
            const storagePath = await uploadToStorage(
              supabase,
              avatarUrl,
              `avatars/${platform}/${creatorId}`
            );
            if (storagePath) {
              profileUpdate.avatar_url = storagePath;
            }
          } catch (error) {
            console.error('[Update Profile] Avatar upload failed:', error);
          }
        }
      } else if (platform === 'instagram' && firstItem.ownerUsername) {
        if (isAuthorMatch(firstItem.ownerUsername)) {
          profileUpdate.display_name = firstItem.ownerFullName || firstItem.ownerUsername;
          profileUpdate.description = firstItem.biography;
          profileUpdate.follower_count = firstItem.followersCount || firstItem.followers || null;
          profileUpdate.following_count = firstItem.followsCount || firstItem.following || null;
          profileUpdate.video_count = firstItem.postsCount || firstItem.posts || firstItem.media_count || null;
          profileUpdate.verified = firstItem.verified || false;

          // Upload avatar if available
          if (firstItem.profilePicUrl) {
            try {
              const storagePath = await uploadToStorage(
                supabase,
                firstItem.profilePicUrl,
                `avatars/${platform}/${creatorId}`
              );
              if (storagePath) {
                profileUpdate.avatar_url = storagePath;
              }
            } catch (error) {
              console.error('[Update Profile] Avatar upload failed:', error);
            }
          }
        } else {
          console.log('[Update Profile] Instagram firstItem owner does not match target creator, skipping author-specific fields:', {
            creatorSlug,
            scrapedOwner: firstItem.ownerUsername,
          });
        }
      } else if (platform === 'linkedin' && (firstItem.author || firstItem.authorName)) {
        const author = firstItem.author || {};

        // Calculate aggregate likes from all posts
        const totalLikes = items.reduce((acc: number, item: any) => {
          return acc + (item.stats?.total_reactions || item.numLikes || item.likeCount || 0);
        }, 0);

        profileUpdate.total_likes = totalLikes;

        // Note: LinkedIn connection/follower counts require separate profile scraper
        // using 'apimaestro~linkedin-profile-detail' actor

        // The LinkedIn post scraper returns reshares / mentions authored by
        // others, so verify the firstItem author is actually our creator
        // before writing display_name / description / avatar.
        const profileUrl = author.profile_url || author.profileUrl || firstItem.authorUrl || firstItem.authorProfileUrl;
        const profileUrlSlug = profileUrl ? String(profileUrl).match(/\/in\/([^/?#]+)/)?.[1] : null;
        const scrapedSlug = author.profile_id || author.publicId || firstItem.authorProfileId || profileUrlSlug;

        if (isAuthorMatch(scrapedSlug)) {
          profileUpdate.display_name = author.name || firstItem.authorName || `${author.firstName} ${author.lastName}`.trim();
          profileUpdate.description = author.occupation || firstItem.authorHeadline;

          // Upload avatar if available
          const avatarUrl = author.picture || firstItem.authorProfilePicture;
          if (avatarUrl) {
            try {
              const storagePath = await uploadToStorage(
                supabase,
                avatarUrl,
                `avatars/${platform}/${creatorId}`
              );
              if (storagePath) {
                profileUpdate.avatar_url = storagePath;
              }
            } catch (error) {
              console.error('[Update Profile] Avatar upload failed:', error);
            }
          }
        } else {
          console.log('[Update Profile] LinkedIn firstItem author does not match target creator, skipping author-specific fields:', {
            creatorSlug,
            scrapedSlug,
          });
        }
      } else if (platform === 'twitter' && firstItem.author?.userName) {
        const author = firstItem.author;

        if (isAuthorMatch(author.userName)) {
          profileUpdate.display_name = author.name || author.userName;
          profileUpdate.description = author.description || '';
          profileUpdate.follower_count = author.followers || 0;
          profileUpdate.following_count = author.following || 0;
          profileUpdate.video_count = author.statusesCount || author.mediaCount || null;
          profileUpdate.verified = author.isBlueVerified || author.isVerified || false;

          // Upload avatar if available
          const twitterAvatarUrl = upgradeTwitterAvatarUrl(author.profilePicture);
          if (twitterAvatarUrl) {
            try {
              const storagePath = await uploadToStorage(
                supabase,
                twitterAvatarUrl,
                `avatars/${platform}/${creatorId}`
              );
              if (storagePath) {
                profileUpdate.avatar_url = storagePath;
              }
            } catch (error) {
              console.error('[Update Profile] Avatar upload failed:', error);
            }
          }
        } else {
          console.log('[Update Profile] Twitter firstItem author does not match target creator, skipping author-specific fields:', {
            creatorSlug,
            scrapedHandle: author.userName,
          });
        }
      }

      console.log('[Update Profile] Updating creator with:', profileUpdate);

      const { error: updateError } = await supabase
        .from('research_creators')
        .update(profileUpdate)
        .eq('id', creatorId);

      if (updateError) {
        console.error('[Update Profile] Failed to update creator:', updateError);
      } else {
        console.log('[Update Profile] Creator updated successfully');
      }
    } else if (searchTermId) {
      // Get current count and update
      const { count } = await supabase
        .from('research_content')
        .select('*', { count: 'exact', head: true })
        .eq('search_term_id', searchTermId);

      await supabase
        .from('research_search_terms')
        .update({
          last_scraped_at: new Date().toISOString(),
          total_results: count || 0
        })
        .eq('id', searchTermId);
    }

    console.log('[Process Dataset] Completed successfully');

  } catch (error) {
    console.error('[Process Dataset] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    await supabase
      .from('research_scrape_runs')
      .update({
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        error_message: errorMessage
      })
      .eq('apify_run_id', runId);
  }
}

Deno.serve(async (req) => {
  // Handle CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const payload = await req.json();
    console.log('[Apify Webhook] Received:', {
      eventType: payload.eventType,
      runId: payload.eventData?.actorRunId,
      status: payload.resource?.status,
      statusMessage: payload.resource?.statusMessage,
      fullPayload: JSON.stringify(payload).slice(0, 2000)
    });

    const runId = payload.eventData?.actorRunId;
    const datasetId = payload.eventData?.datasetId;
    const status = payload.resource?.status;
    const actorId = payload.resource?.actorId;
    const actorName = payload.resource?.actorName || payload.resource?.actId;

    if (!runId) {
      throw new Error('Missing actorRunId in webhook payload');
    }

    // Initialize Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // === Signal Enrichment Path (harvestapi/linkedin-company-employees) ===
    const isSignalEnrichment =
      actorName === "harvestapi/linkedin-company-employees" ||
      actorName === "harvestapi~linkedin-company-employees" ||
      actorId?.includes("harvestapi") ||
      actorId?.includes("linkedin-company-employees");

    if (isSignalEnrichment) {
      console.log('[Apify Webhook] Signal enrichment run detected:', { runId, actorName, status });

      if (status === 'SUCCEEDED' && datasetId) {
        await processSignalPeopleDataset(supabase, runId, datasetId);
      } else if (status === 'FAILED') {
        console.error('[Apify Webhook] Signal enrichment run failed:', runId);
      }

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Look up run in database using Apify's run ID (existing research path)
    const { data: run, error: runError } = await supabase
      .from('research_scrape_runs')
      .select('*')
      .eq('apify_run_id', runId)
      .maybeSingle();

    if (runError) {
      console.error('[Apify Webhook] Database error:', runError);
      return new Response(
        JSON.stringify({ error: 'Database error', details: runError.message }),
        {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    if (!run) {
      console.error('[Apify Webhook] Run not found in database:', runId);
      // Log what's actually in the database for debugging
      const { data: recentRuns } = await supabase
        .from('research_scrape_runs')
        .select('apify_run_id, triggered_at')
        .order('triggered_at', { ascending: false })
        .limit(5);
      console.log('[Apify Webhook] Recent runs in DB:', recentRuns);
      
      return new Response(
        JSON.stringify({ error: 'Run not found', runId }),
        {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Get platform from metadata or fetch from creator/search_term
    let platform = run.metadata?.platform;

    if (!platform) {
      // Fallback: fetch from creator or search term
      if (run.creator_id) {
        const { data: creator } = await supabase
          .from('research_creators')
          .select('platform')
          .eq('id', run.creator_id)
          .single();
        platform = creator?.platform;
      } else if (run.search_term_id) {
        const { data: searchTerm } = await supabase
          .from('research_search_terms')
          .select('platform')
          .eq('id', run.search_term_id)
          .single();
        platform = searchTerm?.platform;
      }
    }
    
    if (!platform) {
      throw new Error('Platform not found in run metadata or related records');
    }

    console.log('[Apify Webhook] Processing run:', {
      runId,
      platform,
      status
    });

    if (status === 'SUCCEEDED') {
      console.log('[Apify Webhook] Success, queuing dataset processing');

      // Use dataset_id from database record (stored during trigger)
      const finalDatasetId = run.dataset_id || datasetId;
      
      if (!finalDatasetId) {
        throw new Error('Dataset ID not found in database or webhook payload');
      }

      // Update status immediately
      await supabase
        .from('research_scrape_runs')
        .update({ status: 'PROCESSING' })
        .eq('apify_run_id', runId);

      // Check if this is a profile scrape
      const isProfileScrape = run.metadata?.scrape_type === 'profile';

      // IMPORTANT: await processing before returning response.
      // In Supabase Edge Functions (Deno Deploy), the runtime terminates
      // after the response is sent, killing any background promises.
      try {
        if (isProfileScrape && run.creator_id) {
          console.log('[Apify Webhook] Processing profile scrape');
          await processProfileData(
            supabase,
            runId,
            finalDatasetId,
            platform,
            run.creator_id
          );
        } else {
          console.log('[Apify Webhook] Processing content scrape');
          await processDataset(
            supabase,
            runId,
            finalDatasetId,
            platform,
            run.organization_id,
            run.creator_id,
            run.search_term_id
          );
        }
      } catch (processingError) {
        // processDataset/processProfileData already mark the run as FAILED internally
        console.error('[Apify Webhook] Processing failed:', processingError);
      }

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Processing completed'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );

    } else if (status === 'FAILED') {
      // Extract detailed error information from Apify webhook payload
      const errorMessage = payload.resource?.statusMessage
        || payload.resource?.errorMessage
        || payload.eventData?.errorMessage
        || 'Apify actor run failed (no details provided)';

      console.error('[Apify Webhook] Run failed:', {
        runId,
        errorMessage,
        statusMessage: payload.resource?.statusMessage,
        exitCode: payload.resource?.exitCode,
        fullResource: payload.resource
      });

      await supabase
        .from('research_scrape_runs')
        .update({
          status: 'FAILED',
          completed_at: new Date().toISOString(),
          error_message: errorMessage
        })
        .eq('apify_run_id', runId);

      return new Response(
        JSON.stringify({
          success: true,
          message: 'Failure recorded',
          errorMessage
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Webhook received'
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );

  } catch (error) {
    console.error('[Apify Webhook] Error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
