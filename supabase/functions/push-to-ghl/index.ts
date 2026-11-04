import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { requireFeature } from "../_shared/featureAccess.ts";
import { getLatestGHLOAuthTokenRow } from "../_shared/ghl-oauth.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";
import { splitFollowUpComment, FOLLOW_UP_ACCOUNT_TYPES } from "../_shared/follow-up-comment.ts";
import { stageText } from "../_shared/stage-text.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to upload base64 media to GHL storage
async function uploadMediaToGHL(
  base64Data: string,
  accessToken: string,
  locationId: string
): Promise<string> {
  // Extract MIME type from base64 string (e.g., "data:image/png;base64,...")
  const mimeTypeMatch = base64Data.match(/data:([^;]+);base64,/);
  const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';
  
  // Extract the base64 content (after "base64,")
  const base64Content = base64Data.split(',')[1];
  
  // Convert base64 to binary
  const binaryString = atob(base64Content);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  
  // Create a blob from the binary data
  const blob = new Blob([bytes], { type: mimeType });
  
  // Create FormData
  const formData = new FormData();
  formData.append('file', blob, `upload-${Date.now()}.${mimeType.split('/')[1]}`);
  formData.append('hosted', 'false');
  
  // Upload to GHL media storage
  const uploadResponse = await fetch(
    'https://services.leadconnectorhq.com/medias/upload-file',
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Version': '2021-07-28',
      },
      body: formData,
    }
  );
  
  if (!uploadResponse.ok) {
    const errorText = await uploadResponse.text();
    throw new Error(`GHL media upload failed: ${uploadResponse.status} ${errorText}`);
  }
  
  const uploadResult = await uploadResponse.json();
  return uploadResult.url; // Return the hosted URL
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      contentOutputIds, // Array of output IDs for batch mode, or single ID
      platforms, // Array of platform identifiers (e.g., ['facebook', 'instagram'])
      scheduleDate, // Optional ISO date string (base date for stagger mode)
      scheduleDates, // Optional array of ISO date strings (one per output, takes precedence over scheduleDate+stagger)
      staggerMinutes, // For batch mode: minutes between posts
      organizationId,
      baseContent, // Custom content from UI (caption, images, videoUrl, tags, postType)
      customizePerChannel, // Whether to use platform-specific overrides
      platformOverrides, // Platform-specific content overrides
    } = await req.json();

    console.log('Push to GHL request:', { contentOutputIds, platforms, scheduleDate, staggerMinutes });

    // verify_jwt only proves the JWT is valid, not that the caller belongs to the body's
    // organizationId. Internal callers (process-publish-queue, submit-content, mcp) send
    // the service key; the app sends a user JWT.
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Validate feature access - Push to GHL requires Pro plan
    await requireFeature(supabase, organizationId, "push_to_ghl");

    // Get GHL OAuth tokens for organization
    let tokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

    if (!tokenData) {
      throw new Error('LeadConnector not connected. Please connect your GHL account first.');
    }

    // Check if token is expired or near expiry (refresh if < 5 minutes remaining)
    const expiresAt = new Date(tokenData.expires_at);
    const now = new Date();
    const minutesUntilExpiry = (expiresAt.getTime() - now.getTime()) / (1000 * 60);

    if (minutesUntilExpiry < 5) {
      console.log('Token expired or near expiry, refreshing...');
      
      // Call refresh token function
      const refreshResponse = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/ghl-refresh-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
        },
        body: JSON.stringify({ organizationId }),
      });

      if (!refreshResponse.ok) {
        const refreshBody = await refreshResponse.json().catch(() => null);
        throw new Error(`Failed to refresh OAuth token: ${refreshBody?.error || `HTTP ${refreshResponse.status}`}`);
      }

      // Re-fetch updated tokens
      const refreshedTokenData = await getLatestGHLOAuthTokenRow(supabase, organizationId);

      if (!refreshedTokenData) {
        throw new Error('Failed to get refreshed tokens');
      }

      tokenData = refreshedTokenData;
    }

    // Decrypt access token
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY')!;
    const accessToken = await decryptApiKey(tokenData.access_token_encrypted, encryptionKey);
    const locationId = tokenData.location_id;
    const ghlUserId = tokenData.ghl_user_id;

    // Validate User ID is configured
    if (!ghlUserId) {
      throw new Error('GHL User ID not configured. Please go to Settings → Integrations and add your GHL User ID before publishing.');
    }

    console.log('Location ID:', locationId, 'User ID:', ghlUserId);

    // Fetch connected social accounts from GHL API for platform/name resolution
    let ghlAccounts: Array<{ id: string; type: string; name: string }> = [];
    try {
      const accountsResponse = await fetch(
        `https://services.leadconnectorhq.com/social-media-posting/${locationId}/accounts`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Version': '2021-07-28',
          },
        }
      );
      if (accountsResponse.ok) {
        const accountsJson = await accountsResponse.json();
        const rawAccounts = accountsJson.results?.accounts || accountsJson.accounts || [];
        ghlAccounts = rawAccounts.map((a: any) => ({
          id: a.id || a._id,
          type: a.platform || 'unknown',
          name: a.name || a.userName || null,
        }));
        console.log('Resolved GHL accounts:', ghlAccounts.length);
      } else {
        console.warn('Failed to fetch GHL accounts for metadata:', accountsResponse.status);
      }
    } catch (e) {
      console.warn('Failed to fetch GHL accounts for metadata:', e);
    }

    // Process outputs (batch or single)
    const outputIds = Array.isArray(contentOutputIds) ? contentOutputIds : [contentOutputIds];
    const results = [];
    
    for (let i = 0; i < outputIds.length; i++) {
      const outputId = outputIds[i];
      
      // Fetch output data (service key, so scope to the authorized org)
      const { data: output, error: outputError } = await supabase
        .from('content_outputs')
        .select('*, content_ideas(title)')
        .eq('id', outputId)
        .eq('organization_id', organizationId)
        .single();

      if (outputError || !output) {
        console.error('Failed to fetch output:', outputId);
        results.push({ outputId, success: false, error: 'Output not found' });
        continue;
      }

      const data = output.data as any;
      const stageData = output.stage_data as any;

      // Check if baseContent was provided from UI - if so, use it exclusively
      // This allows users to remove media by setting images to [] or videoUrl to undefined
      const hasBaseContent = baseContent !== undefined && baseContent !== null;

      // Extract caption: prefer baseContent (if provided AND non-empty), then stage_data, then data fields.
      // captionExact (the Scheduler's per-row caption) is used as is, even blank.
      let caption = '';
      if (hasBaseContent && baseContent.captionExact === true && typeof baseContent.caption === 'string') {
        caption = baseContent.caption;
      } else if (hasBaseContent && baseContent.caption) {
        // Use baseContent caption if it's a non-empty string
        caption = baseContent.caption;
      } else {
        // Check multiple possible locations for caption (different pipelines store it differently).
        // content before text: hand edits only update stage_data.caption.content.
        caption = stageText(stageData?.caption) ||
                  stageData?.final?.caption || data.text || data.content || data.caption || '';
      }

      // The stored text can end with a ---FOLLOW-UP--- block (first comment).
      // Never publish the marker; keep the comment for GHL's followUpComment.
      const captionSplit = splitFollowUpComment(caption);
      caption = captionSplit.caption;
      const followUpComment: string | undefined =
        (typeof baseContent?.followUpComment === 'string' && baseContent.followUpComment.trim())
          ? baseContent.followUpComment.trim()
          : captionSplit.followUpComment;

      // Log caption extraction for debugging
      console.log('📝 [push-to-ghl] Caption extraction:', {
        hasBaseContent,
        baseContentCaption: baseContent?.caption ? `${baseContent.caption.substring(0, 50)}...` : '(empty)',
        stageDataCaptionText: stageData?.caption?.text ? `${stageData.caption.text.substring(0, 50)}...` : '(empty)',
        stageDataCaptionContent: stageData?.caption?.content ? `${stageData.caption.content.substring(0, 50)}...` : '(empty)',
        finalCaption: caption ? `${caption.substring(0, 50)}...` : '(empty)',
        stageDataKeys: Object.keys(stageData || {}),
      });

      // Extract media URLs
      // IMPORTANT: When baseContent is provided, respect its values even if empty
      // This allows users to remove media from the UI
      let imageUrl: string | undefined;
      let imageUrls: string[] = [];
      let videoUrl: string | undefined;

      if (hasBaseContent) {
        // Use baseContent values directly - empty array means user removed all images
        videoUrl = baseContent.videoUrl; // undefined means user removed video
        imageUrls = baseContent.images || [];
        imageUrl = imageUrls[0];
      } else {
        // Fall back to database data only when no baseContent provided
        // Check all possible locations across different pipeline types
        videoUrl = stageData?.final?.url || data.video_url || data.videoUrl;

        // Carousel slides (instagram_carousel pipeline)
        const carouselSlides = stageData?.carousel_slides?.slides;
        if (carouselSlides?.length > 0) {
          const slideImages = carouselSlides
            .filter((s: any) => s.image_url)
            .sort((a: any, b: any) => (a.slide_number || 0) - (b.slide_number || 0))
            .map((s: any) => s.image_url);
          if (slideImages.length > 0) imageUrls = slideImages;
        }

        // Social media post image (stage_data.image)
        if (imageUrls.length === 0) {
          const stageImage = stageData?.image?.url || stageData?.image?.image_url;
          if (stageImage) imageUrls = [stageImage];
        }

        // Storyboard scenes (video pipelines)
        if (imageUrls.length === 0 && stageData?.storyboard?.scenes) {
          const sceneImages = stageData.storyboard.scenes
            .filter((s: any) => s.image_url)
            .map((s: any) => s.image_url);
          if (sceneImages.length > 0) imageUrls = sceneImages;
        }

        // Direct data fields
        if (imageUrls.length === 0) {
          if (data.images?.length > 0) {
            imageUrls = data.images;
          } else {
            imageUrl = data.image_url || data.imageUrl;
            if (imageUrl) imageUrls = [imageUrl];
          }
        }
      }

      console.log('Content sources:', {
        hasBaseContent,
        hasBaseCaption: !!baseContent?.caption,
        hasBaseImages: baseContent?.images?.length || 0,
        hasBaseVideo: !!baseContent?.videoUrl,
        caption: caption.substring(0, 100) + '...',
        imageUrls,
        videoUrl
      });

      // Determine post type
      // For Instagram carousels (multiple images), GHL uses 'post' type with multiple media items
      // For videos, use 'reel' type
      // The postType from baseContent can be 'carousel', 'feed', 'reel', 'story', etc.
      // An explicit story wins: a video story used to go out as a reel because
      // the video check came first.
      let ghlPostType = 'post';
      if (baseContent?.postType === 'story') {
        ghlPostType = 'story';
      } else if (videoUrl || baseContent?.postType === 'reel') {
        ghlPostType = 'reel';
      }
      // 'carousel' and 'feed' both map to 'post' in GHL API

      // Build GHL payload
      const ghlPayload: any = {
        accountIds: platforms,
        summary: caption,
        type: ghlPostType,
        userId: ghlUserId, // Required: GHL user creating the post
      };

      // First comment, posted by GHL right after publish. Only send it when at
      // least one target account supports it (not X, Pinterest or GMB).
      if (followUpComment) {
        const supportsFollowUp = platforms.some((accountId: string) => {
          const account = ghlAccounts.find((a) => a.id === accountId);
          return !!account && FOLLOW_UP_ACCOUNT_TYPES.has(String(account.type).toLowerCase());
        });
        if (supportsFollowUp) ghlPayload.followUpComment = followUpComment;
      }

      // LinkedIn document carousel: when this is a multi-image carousel AND at
      // least one destination is a LinkedIn account, ask GHL to publish the
      // slides as a native LinkedIn PDF document (swipeable carousel) rather
      // than a flat multi-image post. GHL assembles the PDF from the media[]
      // images server-side when linkedinPostDetails.postAsPdf is true — we do
      // NOT upload a PDF ourselves. Captured from the Social Planner UI:
      //   linkedinPostDetails: { postAsPdf: true, pdfTitle: "carousel" }
      // The UI and MCP send 'carousel', process-publish-queue sends 'CAROUSEL'.
      const isCarousel =
        (String(baseContent?.postType ?? '').toLowerCase() === 'carousel' && imageUrls.length > 0) ||
        (!videoUrl && imageUrls.length > 1);
      const hasLinkedInTarget = platforms.some((accountId: string) => {
        const account = ghlAccounts.find((a) => a.id === accountId);
        return account?.type === 'linkedin';
      });
      if (isCarousel && hasLinkedInTarget) {
        const pdfTitle =
          (output.content_ideas?.title || data.title || 'carousel')
            .toString()
            .slice(0, 100);
        ghlPayload.linkedinPostDetails = {
          postAsPdf: true,
          pdfTitle,
        };
        console.log('[push-to-ghl] LinkedIn document carousel enabled (postAsPdf=true):', pdfTitle);
      }

      // Build media array - include both video and images if present
      const mediaArray: Array<{ url: string; type: string }> = [];

      // Add video first if present
      if (videoUrl) {
        let mimeType = 'video/mp4';
        if (videoUrl.match(/\.webm$/i)) mimeType = 'video/webm';
        else if (videoUrl.match(/\.mov$/i)) mimeType = 'video/quicktime';

        mediaArray.push({
          url: videoUrl,
          type: mimeType
        });
        console.log('Adding video media:', videoUrl);
      }

      // Add images (these serve as thumbnails when video is present)
      if (imageUrls.length > 0) {
        for (const imgUrl of imageUrls) {
          if (imgUrl.startsWith('data:')) {
            // Base64 image - upload to GHL media storage first
            console.log('Uploading base64 image to GHL media storage for output:', outputId);
            try {
              const hostedUrl = await uploadMediaToGHL(imgUrl, accessToken, locationId);
              console.log('Successfully uploaded image to GHL. Hosted URL:', hostedUrl);

              // Determine MIME type from original base64
              const mimeTypeMatch = imgUrl.match(/data:([^;]+);base64,/);
              const mimeType = mimeTypeMatch ? mimeTypeMatch[1] : 'image/png';

              mediaArray.push({
                url: hostedUrl,
                type: mimeType
              });
            } catch (uploadError) {
              console.error('Failed to upload image to GHL storage:', uploadError);
              results.push({
                outputId,
                success: false,
                error: `Failed to upload image to GHL storage: ${uploadError instanceof Error ? uploadError.message : 'Unknown error'}`
              });
              continue;
            }
          } else {
            // Regular hosted URL - use directly
            let mimeType = 'image/png';
            if (imgUrl.match(/\.(jpg|jpeg)$/i)) mimeType = 'image/jpeg';
            else if (imgUrl.match(/\.gif$/i)) mimeType = 'image/gif';
            else if (imgUrl.match(/\.webp$/i)) mimeType = 'image/webp';

            mediaArray.push({
              url: imgUrl,
              type: mimeType
            });
          }
        }
        console.log('Added', imageUrls.length, 'image(s) to media array');
      }

      // Set the final media payload
      ghlPayload.media = mediaArray;
      console.log('Total media items:', mediaArray.length, videoUrl ? '(includes video)' : '(images only)');

      // Add schedule date
      // GHL API requires BOTH status: 'scheduled' AND scheduleDate for future scheduling
      // Priority: scheduleDates[i] (per-output) > scheduleDate + stagger (uniform)
      if (scheduleDates && scheduleDates[i]) {
        ghlPayload.scheduleDate = scheduleDates[i];
        ghlPayload.status = 'scheduled';
      } else if (scheduleDate) {
        const baseDate = new Date(scheduleDate);
        if (staggerMinutes && i > 0) {
          baseDate.setMinutes(baseDate.getMinutes() + (staggerMinutes * i));
        }
        ghlPayload.scheduleDate = baseDate.toISOString();
        ghlPayload.status = 'scheduled';
      }

      console.log('Posting to GHL:', ghlPayload);

      // Post to GHL
      const response = await fetch(
        `https://services.leadconnectorhq.com/social-media-posting/${locationId}/posts`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify(ghlPayload),
        }
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error('GHL API error:', response.status, errorText);
        // GHL errors look like {"message":["TikTok needs a video ..."],"statusCode":422}
        let detail = errorText.slice(0, 500);
        try {
          const parsed = JSON.parse(errorText);
          const msg = parsed?.message ?? parsed?.error;
          if (msg) detail = Array.isArray(msg) ? msg.join('; ') : String(msg);
        } catch {
          // not JSON, keep the raw text
        }
        results.push({ outputId, success: false, status: response.status, error: `GHL API error ${response.status}: ${detail}` });
        continue;
      }

      const ghlResponse = await response.json();
      console.log('GHL response:', ghlResponse);

      // Record each platform publication
      // Use ghlPayload.status to determine if this was scheduled (covers both scheduleDate and scheduleDates paths)
      const isScheduled = ghlPayload.status === 'scheduled';
      const publishedPostsInserts = platforms.map((platformAccountId: string) => {
        const account = ghlAccounts.find((a) => a.id === platformAccountId);

        return {
          content_output_id: outputId,
          organization_id: organizationId,
          platform: account?.type || 'unknown',
          platform_account_id: platformAccountId,
          platform_account_name: account?.name || null,
          ghl_post_id: ghlResponse.id || ghlResponse._id,
          scheduled_for: isScheduled ? ghlPayload.scheduleDate : null,
          published_at: isScheduled ? null : new Date().toISOString(),
          status: isScheduled ? 'scheduled' : 'published',
        };
      });

      // Insert all platform publications
      const { error: insertError } = await supabase
        .from('ghl_published_posts')
        .insert(publishedPostsInserts);
      
      if (insertError) {
        console.error('Failed to record published posts:', insertError);
      }

      results.push({ outputId, success: true, ghlPostId: ghlResponse.id || ghlResponse._id });
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        results,
        totalProcessed: results.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Push to GHL error:', error);
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Decrypt API key using AES-256-GCM
async function decryptApiKey(encryptedBase64: string, encryptionKeyHex: string): Promise<string> {
  try {
    // Convert hex key to bytes
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
    
    // Import key
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decode base64
    const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
    
    // Extract IV and ciphertext
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Decrypt
    const decryptedBytes = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      cryptoKey,
      ciphertext
    );

    return new TextDecoder().decode(decryptedBytes);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}
