import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { checkFeatureAccess } from "../_shared/featureAccess.ts";
import { buildAuthHeader } from "../_shared/twitter-oauth.ts";
import { assertOrgAccess } from "../_shared/org-access.ts";
import { unauthorized } from "../_shared/cli-auth.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Safe base64 encoding for large Uint8Arrays (avoids call stack overflow from spread operator)
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Decrypt credentials (AES-256-GCM, hex:hex:hex format)
async function decryptCredentials(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  const [ivHex, authTagHex, encryptedHex] = encryptedData.split(':');

  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const authTag = new Uint8Array(authTagHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const ciphertext = new Uint8Array(encryptedHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));

  const keyData = new Uint8Array(encryptionKeyHex.match(/.{1,2}/g)!.map(byte => parseInt(byte, 16)));
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  const combined = new Uint8Array(ciphertext.length + authTag.length);
  combined.set(ciphertext);
  combined.set(authTag, ciphertext.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    combined
  );

  return new TextDecoder().decode(decrypted);
}

/** An X API rejection, carrying X's HTTP status. */
class TweetError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

interface TwitterCredentials {
  consumerKey: string;
  consumerSecret: string;
  accessToken: string;
  accessTokenSecret: string;
}

/**
 * Upload media to Twitter via the v1.1 media upload endpoint.
 * For images: simple upload with base64.
 * For videos: chunked upload (INIT → APPEND → FINALIZE → STATUS polling).
 */
async function uploadMedia(
  mediaUrl: string,
  creds: TwitterCredentials
): Promise<string> {
  // Fetch the media file
  const mediaResponse = await fetch(mediaUrl);
  if (!mediaResponse.ok) {
    throw new Error(`Failed to fetch media from ${mediaUrl}: ${mediaResponse.status}`);
  }

  const mediaBytes = new Uint8Array(await mediaResponse.arrayBuffer());
  const contentType = mediaResponse.headers.get('content-type') || 'application/octet-stream';
  const isVideo = contentType.startsWith('video/') || mediaUrl.includes('.mp4') || mediaUrl.includes('.mov');

  const uploadUrl = 'https://upload.twitter.com/1.1/media/upload.json';

  if (isVideo) {
    return await uploadVideoChunked(uploadUrl, mediaBytes, contentType, creds);
  } else {
    return await uploadImage(uploadUrl, mediaBytes, creds);
  }
}

async function uploadImage(
  uploadUrl: string,
  mediaBytes: Uint8Array,
  creds: TwitterCredentials
): Promise<string> {
  // Use multipart/form-data — per OAuth 1.0a spec, body params are NOT included
  // in the signature for multipart requests. This is the standard approach.
  const authHeader = await buildAuthHeader(
    'POST',
    uploadUrl,
    creds.consumerKey,
    creds.consumerSecret,
    creds.accessToken,
    creds.accessTokenSecret
  );

  const formData = new FormData();
  formData.append('media_data', uint8ArrayToBase64(mediaBytes));
  formData.append('media_category', 'tweet_image');

  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': authHeader,
      // Don't set Content-Type — fetch sets it automatically with boundary for FormData
    },
    body: formData,
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Image upload failed (${response.status}): ${err}`);
  }

  const data = await response.json();
  return data.media_id_string;
}

async function uploadVideoChunked(
  uploadUrl: string,
  mediaBytes: Uint8Array,
  contentType: string,
  creds: TwitterCredentials
): Promise<string> {
  // INIT
  const initParams: Record<string, string> = {
    command: 'INIT',
    total_bytes: mediaBytes.length.toString(),
    media_type: contentType,
    media_category: 'tweet_video',
  };

  const initAuth = await buildAuthHeader(
    'POST', uploadUrl,
    creds.consumerKey, creds.consumerSecret,
    creds.accessToken, creds.accessTokenSecret,
    initParams
  );

  const initBody = Object.entries(initParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const initResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': initAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: initBody,
  });

  if (!initResponse.ok) {
    const err = await initResponse.text();
    throw new Error(`Video INIT failed (${initResponse.status}): ${err}`);
  }

  const initData = await initResponse.json();
  const mediaId = initData.media_id_string;

  // APPEND - upload in 5MB chunks
  const chunkSize = 5 * 1024 * 1024;
  let segmentIndex = 0;

  for (let offset = 0; offset < mediaBytes.length; offset += chunkSize) {
    const chunk = mediaBytes.slice(offset, Math.min(offset + chunkSize, mediaBytes.length));

    // Use multipart/form-data for APPEND — avoids including large media_data in OAuth signature
    const appendAuth = await buildAuthHeader(
      'POST', uploadUrl,
      creds.consumerKey, creds.consumerSecret,
      creds.accessToken, creds.accessTokenSecret
    );

    const appendForm = new FormData();
    appendForm.append('command', 'APPEND');
    appendForm.append('media_id', mediaId);
    appendForm.append('segment_index', segmentIndex.toString());
    appendForm.append('media_data', uint8ArrayToBase64(chunk));

    const appendResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': appendAuth,
      },
      body: appendForm,
    });

    if (!appendResponse.ok) {
      const err = await appendResponse.text();
      throw new Error(`Video APPEND segment ${segmentIndex} failed (${appendResponse.status}): ${err}`);
    }

    segmentIndex++;
  }

  // FINALIZE
  const finalizeParams: Record<string, string> = {
    command: 'FINALIZE',
    media_id: mediaId,
  };

  const finalizeAuth = await buildAuthHeader(
    'POST', uploadUrl,
    creds.consumerKey, creds.consumerSecret,
    creds.accessToken, creds.accessTokenSecret,
    finalizeParams
  );

  const finalizeBody = Object.entries(finalizeParams)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const finalizeResponse = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Authorization': finalizeAuth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: finalizeBody,
  });

  if (!finalizeResponse.ok) {
    const err = await finalizeResponse.text();
    throw new Error(`Video FINALIZE failed (${finalizeResponse.status}): ${err}`);
  }

  const finalizeData = await finalizeResponse.json();

  // Poll for processing status if needed
  if (finalizeData.processing_info) {
    await pollMediaStatus(uploadUrl, mediaId, creds);
  }

  return mediaId;
}

async function pollMediaStatus(
  uploadUrl: string,
  mediaId: string,
  creds: TwitterCredentials
): Promise<void> {
  const maxAttempts = 30;

  for (let i = 0; i < maxAttempts; i++) {
    const statusParams: Record<string, string> = {
      command: 'STATUS',
      media_id: mediaId,
    };

    const statusAuth = await buildAuthHeader(
      'GET', uploadUrl,
      creds.consumerKey, creds.consumerSecret,
      creds.accessToken, creds.accessTokenSecret,
      statusParams
    );

    const statusUrl = `${uploadUrl}?command=STATUS&media_id=${mediaId}`;
    const statusResponse = await fetch(statusUrl, {
      method: 'GET',
      headers: { 'Authorization': statusAuth },
    });

    if (!statusResponse.ok) {
      throw new Error(`Media STATUS check failed: ${statusResponse.status}`);
    }

    const statusData = await statusResponse.json();
    const state = statusData.processing_info?.state;

    if (state === 'succeeded') {
      return;
    } else if (state === 'failed') {
      throw new Error(`Video processing failed: ${JSON.stringify(statusData.processing_info?.error)}`);
    }

    // Wait before polling again
    const waitSeconds = statusData.processing_info?.check_after_secs || 5;
    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
  }

  throw new Error('Video processing timed out');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

  if (!encryptionKey) {
    return new Response(JSON.stringify({ success: false, error: 'ENCRYPTION_KEY not configured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    const body = await req.json();
    const { account_id, tweet, output_id, thread } = body;

    if (!account_id) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing required field: account_id'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch the Twitter account
    const { data: account, error: accountError } = await supabase
      .from('twitter_accounts')
      .select('*')
      .eq('id', account_id)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ success: false, error: 'Twitter account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // verify_jwt=false: without this anyone with an account id could tweet from it.
    // process-publish-queue sends the service key; the app sends a user JWT.
    try {
      await assertOrgAccess(req, supabase, account.organization_id);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    // Outputs are read with the service key: they must belong to the account's org.
    let output: { stage_data: any; data: any; pipeline: string } | null = null;
    if (output_id) {
      const { data } = await supabase
        .from('content_outputs')
        .select('stage_data, data, pipeline')
        .eq('id', output_id)
        .eq('organization_id', account.organization_id)
        .maybeSingle();

      if (!data) {
        return new Response(JSON.stringify({ success: false, error: 'Content output not found' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      output = data;
    }

    // If tweet text not provided, try to extract from output
    let tweetInput = tweet;
    if (!tweetInput?.text && output) {
      const sd = (output.stage_data as any) || {};
      const d = (output.data as any) || {};

      // Extract text
      const text = sd?.final?.caption || sd?.caption?.content ||
        d?.text || d?.content || output.data?.text || '';

      // Extract media URLs
      const mediaUrls: string[] = [];
      // Video
      const videoUrl = sd?.final?.url || d?.videoUrl || d?.video_url;
      if (videoUrl) mediaUrls.push(videoUrl);
      // Images (if no video)
      if (mediaUrls.length === 0) {
        const imgUrl = sd?.image?.url || sd?.image?.image_url || d?.imageUrl || d?.image_url;
        if (imgUrl) mediaUrls.push(imgUrl);
        // Carousel slides
        const slides = sd?.carousel_slides?.slides || [];
        for (const slide of slides) {
          if (slide?.image_url) mediaUrls.push(slide.image_url);
        }
        // Array images
        if (d?.images && Array.isArray(d.images)) {
          for (const img of d.images) {
            const url = typeof img === 'string' ? img : img?.url;
            if (url) mediaUrls.push(url);
          }
        }
      }

      tweetInput = {
        text: text || '',
        media_urls: mediaUrls.length > 0 ? mediaUrls : undefined,
      };
    }

    if (!tweetInput?.text) {
      return new Response(JSON.stringify({
        success: false,
        error: 'Missing tweet text. Provide tweet.text or a valid output_id.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!account.is_valid) {
      return new Response(JSON.stringify({
        success: false,
        error: account.error_message || 'Twitter account credentials are invalid. Please re-test the connection in Settings.'
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check feature access
    const featureCheck = await checkFeatureAccess(supabase, account.organization_id, "publishing");
    if (!featureCheck.allowed) {
      return new Response(JSON.stringify({
        success: false,
        error: featureCheck.reason || "Publishing feature not available for this plan"
      }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Decrypt credentials
    const creds: TwitterCredentials = {
      consumerKey: await decryptCredentials(account.consumer_key_encrypted, encryptionKey),
      consumerSecret: await decryptCredentials(account.consumer_secret_encrypted, encryptionKey),
      accessToken: await decryptCredentials(account.access_token_encrypted, encryptionKey),
      accessTokenSecret: await decryptCredentials(account.access_token_secret_encrypted, encryptionKey),
    };

    // ── Helper: post a single tweet, optionally as reply ──
    async function postSingleTweet(
      text: string,
      mediaUrls: string[] | undefined,
      inReplyToTweetId?: string
    ): Promise<string> {
      const tweetApiUrl = 'https://api.twitter.com/2/tweets';

      // Upload media
      const mediaIds: string[] = [];
      if (mediaUrls && mediaUrls.length > 0) {
        const urls = mediaUrls.slice(0, 4); // max 4 images or 1 video
        for (const url of urls) {
          try {
            const mediaId = await uploadMedia(url, creds);
            mediaIds.push(mediaId);
          } catch (err) {
            console.error(`Failed to upload media ${url}:`, err);
          }
        }
      }

      const tweetBody: any = { text };
      if (mediaIds.length > 0) {
        tweetBody.media = { media_ids: mediaIds };
      }
      if (inReplyToTweetId) {
        tweetBody.reply = { in_reply_to_tweet_id: inReplyToTweetId };
      }

      const authHeader = await buildAuthHeader(
        'POST', tweetApiUrl,
        creds.consumerKey, creds.consumerSecret,
        creds.accessToken, creds.accessTokenSecret
      );

      const resp = await fetch(tweetApiUrl, {
        method: 'POST',
        headers: { 'Authorization': authHeader, 'Content-Type': 'application/json' },
        body: JSON.stringify(tweetBody),
      });

      if (!resp.ok) {
        const errorBody = await resp.text();
        console.error('Tweet creation failed:', resp.status, errorBody);
        // X errors look like {"title":"Payment Required","detail":"credits depleted","status":402}
        let detail = errorBody.slice(0, 500);
        try {
          const parsed = JSON.parse(errorBody);
          detail = parsed?.detail || parsed?.errors?.[0]?.message || parsed?.title || detail;
        } catch {
          // not JSON, keep the raw text
        }
        // X also answers 403 for "duplicate content" (e.g. an exact evergreen repost):
        // that's this tweet's problem, not the account's, and flagging it would
        // pause the account's autopilots (process-autopilots preflight).
        if (resp.status === 401 || (resp.status === 403 && !/duplicate/i.test(detail))) {
          await supabase.from('twitter_accounts').update({
            is_valid: false,
            error_message: `Auth failed (${resp.status}): ${detail}`,
            updated_at: new Date().toISOString(),
          }).eq('id', account_id);
        } else if (resp.status === 402) {
          // Pay-per-use credits (or spend cap) exhausted on the user's own X app:
          // nothing posts until they top up, so stop the account like an auth failure.
          await supabase.from('twitter_accounts').update({
            is_valid: false,
            error_message: `X API ${detail}. Top up at console.x.com.`,
            updated_at: new Date().toISOString(),
          }).eq('id', account_id);
        }
        throw new TweetError(`Tweet failed (${resp.status}): ${detail}`, resp.status);
      }

      const data = await resp.json();
      return data.data?.id as string;
    }

    // ── Thread mode: chain tweets via reply.in_reply_to_tweet_id ──
    const isThread = Array.isArray(thread) && thread.length > 1;

    let tweetId: string;
    const allTweetIds: string[] = [];

    if (isThread) {
      console.log(`Posting thread with ${thread.length} tweets...`);
      let previousTweetId: string | undefined;

      for (let i = 0; i < thread.length; i++) {
        const item = thread[i] as { text: string; media_urls?: string[] };
        const id = await postSingleTweet(item.text, item.media_urls, previousTweetId);
        allTweetIds.push(id);
        previousTweetId = id;
        console.log(`Thread tweet ${i + 1}/${thread.length} posted: ${id}`);
      }

      tweetId = allTweetIds[0]; // first tweet is the thread root
    } else {
      // Single tweet (original path, backward compatible)
      const mediaUrls: string[] = [];
      if (tweetInput.media_urls && tweetInput.media_urls.length > 0) {
        mediaUrls.push(...tweetInput.media_urls.slice(0, 4));
      }
      tweetId = await postSingleTweet(tweetInput.text, mediaUrls.length > 0 ? mediaUrls : undefined);
      allTweetIds.push(tweetId);
    }

    const tweetResultUrl = tweetId
      ? `https://twitter.com/${account.twitter_handle}/status/${tweetId}`
      : null;

    console.log(`Tweet posted successfully: ${tweetResultUrl}`);

    // Optionally track the publication on the content output
    if (output_id) {
      try {
        await supabase.from('ghl_published_posts').insert({
          content_output_id: output_id,
          organization_id: account.organization_id,
          platform: 'twitter',
          platform_account_id: account_id,
          platform_account_name: account.name,
          ghl_post_id: tweetId,
          status: 'published',
          published_at: new Date().toISOString(),
        });
      } catch (trackErr) {
        console.warn('Failed to track publication:', trackErr);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      tweet_id: tweetId,
      tweet_url: tweetResultUrl,
      thread_ids: allTweetIds.length > 1 ? allTweetIds : undefined,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('publish-to-twitter error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      // Pass X's status through so process-publish-queue can tell a 402/400
      // (fails the same way again) from a 429/5xx (worth a retry).
      status: error instanceof TweetError ? error.status : 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
