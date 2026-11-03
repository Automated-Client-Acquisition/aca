import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { normalizeDsnUrl } from '../_shared/unipile-client.ts';
import { assertOrgAccess } from '../_shared/org-access.ts';
import { unauthorized } from '../_shared/cli-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * LinkedIn Fetch Preview Edge Function
 *
 * Fetches metadata/preview for LinkedIn posts or events.
 * Returns post content, reaction counts, event details, etc.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const encryptionKey = Deno.env.get('ENCRYPTION_KEY');

    if (!supabaseUrl || !supabaseKey || !encryptionKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const { type, url, accountId } = await req.json();

    if (!type || !url || !accountId) {
      throw new Error('type, url, and accountId are required');
    }

    console.log(`[LinkedIn Preview] Fetching ${type} preview for: ${url}`);

    // Get account details
    const { data: account, error: accountError } = await supabase
      .from('unipile_accounts')
      .select('*')
      .eq('id', accountId)
      .single();

    if (accountError || !account) {
      return new Response(JSON.stringify({ error: 'Account not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // The service-role client acts on whatever row the body names, so the caller
    // must be able to access that row's org (a valid anon-key JWT alone is not enough).
    try { await assertOrgAccess(req, supabase, account.organization_id); } catch (authErr) { return unauthorized(authErr, corsHeaders); }

    if (account.status !== 'active') {
      throw new Error('LinkedIn account is not active');
    }

    // Decrypt API key
    const apiKey = await decryptApiKey(account.access_token_encrypted, encryptionKey);
    const dsnUrl = normalizeDsnUrl(account.dsn_url);

    if (type === 'post') {
      const preview = await fetchPostPreview(dsnUrl, apiKey, account.unipile_account_id, url);
      return new Response(JSON.stringify(preview), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (type === 'event') {
      const preview = await fetchEventPreview(dsnUrl, apiKey, account.unipile_account_id, url);
      return new Response(JSON.stringify(preview), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    throw new Error(`Unknown preview type: ${type}`);

  } catch (error) {
    console.error('[LinkedIn Preview] Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

/**
 * Decrypt API key using AES-GCM
 */
async function decryptApiKey(encryptedData: string, encryptionKey: string): Promise<string> {
  const data = JSON.parse(encryptedData);
  const key = await crypto.subtle.importKey(
    "raw",
    hexToBytes(encryptionKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: hexToBytes(data.iv) },
    key,
    hexToBytes(data.ciphertext)
  );

  return new TextDecoder().decode(decrypted);
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Extract post ID from various LinkedIn post URL formats
 */
function extractPostId(url: string): string | null {
  // Format: /posts/username_activity-7123456789012345678-abcd
  let match = url.match(/activity[_-](\d+)/i);
  if (match) return match[1];

  // Format: /feed/update/urn:li:activity:7123456789012345678
  match = url.match(/urn:li:activity:(\d+)/i);
  if (match) return match[1];

  // Format: /feed/update/urn:li:share:7123456789012345678
  match = url.match(/urn:li:share:(\d+)/i);
  if (match) return match[1];

  return null;
}

/**
 * Extract event ID from LinkedIn event URL
 */
function extractEventId(url: string): string | null {
  // Format: /events/eventname-7123456789012345678/
  // Format: /events/7123456789012345678/
  const match = url.match(/\/events\/(?:[\w-]+-)?(\d+)/i);
  return match ? match[1] : null;
}

/**
 * Fetch post preview data from Unipile
 */
async function fetchPostPreview(
  dsnUrl: string,
  apiKey: string,
  unipileAccountId: string,
  url: string
): Promise<Record<string, unknown>> {
  const postId = extractPostId(url);
  if (!postId) {
    throw new Error('Could not extract post ID from URL');
  }

  console.log(`[LinkedIn Preview] Fetching post ${postId}...`);

  // Try to get post details
  const postUrl = `${dsnUrl}/api/v1/posts/${postId}?account_id=${unipileAccountId}`;

  const postResponse = await fetch(postUrl, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  let postData: Record<string, unknown> = {};

  if (postResponse.ok) {
    postData = await postResponse.json();
  } else {
    console.log(`[LinkedIn Preview] Could not fetch post details: ${postResponse.status}`);
  }

  // Get reaction counts
  const reactionsUrl = `${dsnUrl}/api/v1/posts/${postId}/reactions?account_id=${unipileAccountId}&limit=1`;

  const reactionsResponse = await fetch(reactionsUrl, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  let reactionCount = 0;
  const reactions: { type: string; count: number }[] = [];

  if (reactionsResponse.ok) {
    const reactionsData = await reactionsResponse.json();
    reactionCount = reactionsData.total || reactionsData.count || 0;

    // Get reaction breakdown if available
    if (reactionsData.reaction_summary || reactionsData.summary) {
      const summary = reactionsData.reaction_summary || reactionsData.summary || {};
      for (const [type, count] of Object.entries(summary)) {
        if (typeof count === 'number' && count > 0) {
          reactions.push({ type: type.toUpperCase(), count });
        }
      }
    }
  }

  // Get comment count
  const commentsUrl = `${dsnUrl}/api/v1/posts/${postId}/comments?account_id=${unipileAccountId}&limit=1`;

  const commentsResponse = await fetch(commentsUrl, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  let commentCount = 0;

  if (commentsResponse.ok) {
    const commentsData = await commentsResponse.json();
    commentCount = commentsData.total || commentsData.count || 0;
  }

  // Build preview response
  const author = postData.author || postData.user || postData.actor || {};

  return {
    authorName: author.name || author.display_name || author.first_name,
    authorHeadline: author.headline || author.occupation || author.title,
    authorAvatarUrl: author.profile_picture_url || author.avatar_url || author.image,
    content: postData.text || postData.content || postData.commentary,
    reactionCount,
    commentCount,
    shareCount: postData.share_count || postData.shares || 0,
    reactions: reactions.length > 0 ? reactions : undefined,
  };
}

/**
 * Fetch event preview data from Unipile
 */
async function fetchEventPreview(
  dsnUrl: string,
  apiKey: string,
  unipileAccountId: string,
  url: string
): Promise<Record<string, unknown>> {
  const eventId = extractEventId(url);
  if (!eventId) {
    throw new Error('Could not extract event ID from URL');
  }

  console.log(`[LinkedIn Preview] Fetching event ${eventId}...`);

  // Try to get event details
  const eventUrl = `${dsnUrl}/api/v1/events/${eventId}?account_id=${unipileAccountId}`;

  const eventResponse = await fetch(eventUrl, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  if (!eventResponse.ok) {
    console.log(`[LinkedIn Preview] Could not fetch event details: ${eventResponse.status}`);
    // Return minimal preview
    return {
      title: 'LinkedIn Event',
      attendeeCount: 0,
    };
  }

  const eventData = await eventResponse.json();

  // Get attendee count
  const attendeesUrl = `${dsnUrl}/api/v1/events/${eventId}/attendees?account_id=${unipileAccountId}&limit=1`;

  const attendeesResponse = await fetch(attendeesUrl, {
    headers: {
      'X-API-KEY': apiKey,
      'Accept': 'application/json',
    },
  });

  let attendeeCount = 0;

  if (attendeesResponse.ok) {
    const attendeesData = await attendeesResponse.json();
    attendeeCount = attendeesData.total || attendeesData.count || 0;
  }

  // Build preview response
  const host = eventData.host || eventData.organizer || {};

  return {
    title: eventData.title || eventData.name,
    description: eventData.description || eventData.summary,
    imageUrl: eventData.image_url || eventData.cover_image || eventData.logo,
    startDate: eventData.start_date || eventData.start_time || eventData.starts_at,
    endDate: eventData.end_date || eventData.end_time || eventData.ends_at,
    location: eventData.location || eventData.venue,
    attendeeCount,
    hostName: host.name || host.display_name,
    hostAvatarUrl: host.profile_picture_url || host.avatar_url,
  };
}
