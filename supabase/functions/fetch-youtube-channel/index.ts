import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.81.1';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

async function decryptApiKey(encryptedData: string, encryptionKeyHex: string): Promise<string> {
  try {
    // Decode base64 encrypted data
    const combined = Uint8Array.from(atob(encryptedData), c => c.charCodeAt(0));
    
    // Extract IV (first 12 bytes) and ciphertext (rest)
    const iv = combined.slice(0, 12);
    const ciphertext = combined.slice(12);

    // Convert hex key to bytes
    const keyBytes = new Uint8Array(encryptionKeyHex.match(/.{2}/g)!.map(byte => parseInt(byte, 16)));

    // Import the key
    const key = await crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );

    // Decrypt
    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );

    return new TextDecoder().decode(decrypted);
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt API key');
  }
}

interface YouTubeChannelResponse {
  items?: Array<{
    id: string;
    snippet: {
      title: string;
      description: string;
      thumbnails: {
        default: { url: string };
        medium: { url: string };
        high: { url: string };
      };
    };
    statistics: {
      subscriberCount: string;
      videoCount: string;
    };
  }>;
}

interface StorageCredentials {
  provider: string;
  endpoint: string;
  bucket_name: string;
  access_key_id: string;
  secret_access_key: string;
}

async function uploadToStorage(
  imageUrl: string,
  fileName: string,
  credentials: StorageCredentials
): Promise<string> {
  // Download the image
  const imageResponse = await fetch(imageUrl);
  const imageBlob = await imageResponse.blob();
  const imageBuffer = await imageBlob.arrayBuffer();

  // Construct the URL for the storage provider
  const uploadUrl = `${credentials.endpoint}/${credentials.bucket_name}/${fileName}`;

  // Upload to S3-compatible storage
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    body: imageBuffer,
    headers: {
      'Content-Type': imageBlob.type,
      'x-amz-acl': 'public-read',
    },
  });

  if (!uploadResponse.ok) {
    throw new Error(`Failed to upload to storage: ${uploadResponse.statusText}`);
  }

  // Return the public URL
  return uploadUrl;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { creatorId, channelId, channelUrl, organizationId } = await req.json();

    // The service-role client acts on whatever org the body names, so the caller
    // must be able to access it (a valid anon-key JWT alone is not enough).
    try {
      await assertOrgAccess(req, supabase, organizationId);
    } catch (authErr) {
      return unauthorized(authErr, corsHeaders);
    }

    console.log('Fetching YouTube channel info for:', { creatorId, channelId, channelUrl });

    // Get YouTube API key
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('api_keys')
      .select('key_encrypted')
      .eq('organization_id', organizationId)
      .eq('provider', 'youtube')
      .single();

    if (apiKeyError || !apiKeyData) {
      throw new Error('YouTube API key not found');
    }

    // Decrypt the API key
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');
    if (!encryptionKey) {
      throw new Error('Encryption key not configured');
    }

    const youtubeApiKey = await decryptApiKey(apiKeyData.key_encrypted, encryptionKey);

    // Extract channel ID from URL and determine if it's a handle
    let finalChannelId = channelId;
    let isHandle = false;
    
    // ALWAYS check channelUrl first to determine if it's a handle
    if (channelUrl) {
      const handleMatch = channelUrl.match(/@([^\/\?]+)/);
      if (handleMatch) {
        finalChannelId = handleMatch[1]; // Just the handle without @
        isHandle = true;
      } else {
        // Try to match channel ID from URL
        const idMatch = channelUrl.match(/channel\/([^\/\?]+)/);
        if (idMatch) {
          finalChannelId = idMatch[1];
        }
      }
    }
    
    // Fallback to channelId if no URL provided, check if it's a handle
    if (!finalChannelId) {
      finalChannelId = channelId;
      if (finalChannelId?.startsWith('@')) {
        finalChannelId = finalChannelId.substring(1);
        isHandle = true;
      }
    }

    if (!finalChannelId) {
      throw new Error('Could not determine channel ID');
    }

    // Fetch channel data from YouTube API
    const fetchUrl = isHandle
      ? `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&forHandle=${finalChannelId}&key=${youtubeApiKey}`
      : `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${finalChannelId}&key=${youtubeApiKey}`;

    console.log('Fetching from YouTube API:', fetchUrl, 'isHandle:', isHandle);

    const youtubeResponse = await fetch(fetchUrl);
    const youtubeData: YouTubeChannelResponse = await youtubeResponse.json();

    if (!youtubeData.items || youtubeData.items.length === 0) {
      throw new Error('Channel not found');
    }

    const channel = youtubeData.items[0];
    const avatarUrl = channel.snippet.thumbnails.high.url;
    const subscriberCount = parseInt(channel.statistics.subscriberCount);
    const videoCount = parseInt(channel.statistics.videoCount);

    // Get storage credentials
    const { data: storageData, error: storageError } = await supabase
      .from('storage_credentials')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('is_active', true)
      .single();

    let finalAvatarUrl = avatarUrl;

    if (storageData && !storageError) {
      try {
        // Upload avatar to user's BYOK storage
        const fileName = `research/profiles/youtube/${creatorId}_avatar_${Date.now()}.jpg`;
        const decryptedSecret = await decryptApiKey(storageData.secret_access_key, encryptionKey);
        finalAvatarUrl = await uploadToStorage(avatarUrl, fileName, {
          provider: storageData.provider,
          endpoint: storageData.endpoint_url,
          bucket_name: storageData.bucket_name,
          access_key_id: storageData.access_key_id,
          secret_access_key: decryptedSecret,
        });
        console.log('Avatar uploaded to BYOK storage:', finalAvatarUrl);
      } catch (uploadError) {
        console.error('Failed to upload avatar to storage:', uploadError);
        // Fall back to YouTube URL
        finalAvatarUrl = avatarUrl;
      }
    }

    // Update creator with proper columns
    const { error: updateError } = await supabase
      .from('research_creators')
      .update({
        display_name: channel.snippet.title,
        description: channel.snippet.description,
        avatar_url: finalAvatarUrl,
        subscriber_count: subscriberCount,
        video_count: videoCount,
        follower_count: subscriberCount, // YouTube uses subscriber count as follower count
        verified: false, // YouTube API doesn't provide verification status in basic call
        last_scraped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        metadata: {
          youtube: {
            subscriberCount,
            videoCount,
            title: channel.snippet.title,
            description: channel.snippet.description,
            channelId: channel.id,
          },
        },
      })
      .eq('id', creatorId)
      .eq('organization_id', organizationId);

    if (updateError) {
      throw updateError;
    }

    console.log('Creator updated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        avatarUrl: finalAvatarUrl,
        subscriberCount,
        videoCount,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error fetching YouTube channel info:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
