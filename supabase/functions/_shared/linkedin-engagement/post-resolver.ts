/**
 * LinkedIn post URL parsing + social_id resolution.
 *
 * Unipile's /reactions and /comments endpoints require the post's social_id,
 * not the activity id embedded in the share URL. resolveSocialId() tries four
 * strategies in order (extracted unchanged from linkedin-post-import):
 *   1. GET /posts/{id} with the URL / activity URN / plain id
 *   2. Resolve the author's provider_id, page their posts, match by share_url
 *   3. Probe /reactions with the activity URN directly
 *   4. Raw LinkedIn voyager passthrough
 */

export interface UnipileAccountRef {
  unipileAccountId: string;
  dsnUrl: string;
  apiKey: string;
}

/**
 * Extract post activity ID and author username from a LinkedIn URL
 */
export function extractPostInfo(url: string): { activityId: string | null; username: string | null } {
  let activityId: string | null = null;
  let username: string | null = null;

  // Format: https://www.linkedin.com/posts/username_activity-7123456789012345678-abcd
  const postsMatch = url.match(/linkedin\.com\/posts\/([^_\/]+)_.*activity-(\d+)/i);
  if (postsMatch) {
    username = postsMatch[1];
    activityId = postsMatch[2];
    return { activityId, username };
  }

  // Just activity ID
  const activityMatch = url.match(/activity-(\d+)/i);
  if (activityMatch) activityId = activityMatch[1];

  // Format: https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678
  const urnMatch = url.match(/urn:li:(activity|share):(\d+)/i);
  if (urnMatch) activityId = urnMatch[2];

  return { activityId, username };
}

/**
 * Resolve the Unipile social_id for a LinkedIn post URL.
 * Returns null when every strategy fails. `onApiCall` lets callers meter
 * Unipile requests (poll budgets).
 */
export async function resolveSocialId(
  account: UnipileAccountRef,
  sourceUrl: string,
  logPrefix = '[LinkedIn Engagement]',
  onApiCall?: () => void,
): Promise<string | null> {
  const { dsnUrl, apiKey, unipileAccountId } = account;
  const { activityId, username } = extractPostInfo(sourceUrl);
  if (!activityId) {
    console.log(`${logPrefix} Could not extract post ID from URL: ${sourceUrl}`);
    return null;
  }

  let socialId: string | null = null;

  // Strategy 1: Try to use the full URL or activity URN directly with the posts endpoint
  const urlFormats = [
    sourceUrl,
    `urn:li:activity:${activityId}`,
    activityId,
  ];

  for (const postIdFormat of urlFormats) {
    console.log(`${logPrefix} Trying post fetch with format: ${postIdFormat.substring(0, 80)}`);

    onApiCall?.();
    const testResponse = await fetch(`${dsnUrl}/api/v1/posts/${encodeURIComponent(postIdFormat)}?account_id=${unipileAccountId}`, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (testResponse.ok) {
      const postData = await testResponse.json();
      console.log(`${logPrefix} Success with format. Post data: ${JSON.stringify(postData).substring(0, 300)}`);
      socialId = postData.social_id || postData.id;
      if (socialId) {
        console.log(`${logPrefix} Got social_id: ${socialId}`);
        break;
      }
    } else {
      const errorText = await testResponse.text();
      console.log(`${logPrefix} Format failed (${testResponse.status}): ${errorText.substring(0, 200)}`);
    }
  }

  // Strategy 2: If we have a username, first get the user's provider_id, then fetch their posts
  // The /users/{identifier}/posts endpoint requires the internal provider_id (ACo/ADo format)
  if (!socialId && username) {
    console.log(`${logPrefix} Trying user posts lookup for: ${username}`);

    let userProviderId: string | null = null;

    onApiCall?.();
    const profileResponse = await fetch(`${dsnUrl}/api/v1/users/${encodeURIComponent(username)}?account_id=${unipileAccountId}`, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (profileResponse.ok) {
      const profileData = await profileResponse.json();
      userProviderId = profileData.provider_id;
      console.log(`${logPrefix} Got user provider_id: ${userProviderId}`);
    } else {
      const errorText = await profileResponse.text();
      console.log(`${logPrefix} Could not fetch user profile: ${profileResponse.status} - ${errorText.substring(0, 200)}`);
    }

    const userIdentifier = userProviderId || username;
    let postsCursor: string | null = null;
    let pagesSearched = 0;
    const maxPages = 5;

    while (!socialId && pagesSearched < maxPages) {
      let postsUrl = `${dsnUrl}/api/v1/users/${encodeURIComponent(userIdentifier)}/posts?account_id=${unipileAccountId}&limit=50`;
      if (postsCursor) {
        postsUrl += `&cursor=${postsCursor}`;
      }

      onApiCall?.();
      const postsResponse = await fetch(postsUrl, {
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json',
        },
      });

      if (!postsResponse.ok) {
        const errorText = await postsResponse.text();
        console.log(`${logPrefix} Could not fetch user posts: ${postsResponse.status} - ${errorText.substring(0, 200)}`);
        break;
      }

      const postsData = await postsResponse.json();
      const posts = postsData.items || [];
      postsCursor = postsData.cursor || null;
      pagesSearched++;

      console.log(`${logPrefix} Page ${pagesSearched}: Found ${posts.length} posts (cursor: ${postsCursor ? 'yes' : 'no'})`);

      if (pagesSearched === 1) {
        for (let i = 0; i < Math.min(3, posts.length); i++) {
          console.log(`${logPrefix} Post ${i}: id=${posts[i].id}, social_id=${posts[i].social_id}, share_url=${posts[i].share_url?.substring(0, 100)}`);
        }
      }

      for (const post of posts) {
        const postId = post.id || '';
        const shareUrl = post.share_url || '';

        const shareUrlMatch = shareUrl.match(/activity-(\d+)/);
        const shareUrlActivityId = shareUrlMatch ? shareUrlMatch[1] : null;

        if (
          shareUrlActivityId === activityId ||
          postId === `urn:li:activity:${activityId}` ||
          postId === activityId ||
          postId.includes(activityId) ||
          shareUrl.includes(activityId)
        ) {
          socialId = post.social_id;
          console.log(`${logPrefix} Found matching post with social_id: ${socialId}`);
          break;
        }
      }

      if (!postsCursor || socialId) {
        break;
      }

      await new Promise(resolve => setTimeout(resolve, 200));
    }

    if (!socialId) {
      console.log(`${logPrefix} No match found after searching ${pagesSearched} pages. Looking for activity ID: ${activityId}`);
    }
  }

  // Strategy 3: Try using the activity URN directly as the post_id
  if (!socialId) {
    console.log(`${logPrefix} Strategy 3: Trying activity URN directly as social_id`);
    const activityUrn = `urn:li:activity:${activityId}`;

    onApiCall?.();
    const testReactionsUrl = `${dsnUrl}/api/v1/posts/${encodeURIComponent(activityUrn)}/reactions?account_id=${unipileAccountId}&limit=1`;
    const testReactionsResponse = await fetch(testReactionsUrl, {
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
      },
    });

    if (testReactionsResponse.ok) {
      const testData = await testReactionsResponse.json();
      console.log(`${logPrefix} Activity URN works directly! Response: ${JSON.stringify(testData).substring(0, 200)}`);
      socialId = activityUrn;
    } else {
      const errorText = await testReactionsResponse.text();
      console.log(`${logPrefix} Activity URN didn't work: ${testReactionsResponse.status} - ${errorText.substring(0, 200)}`);
    }
  }

  // Strategy 4: Use the raw LinkedIn API endpoint
  if (!socialId) {
    console.log(`${logPrefix} Strategy 4: Using raw LinkedIn API endpoint`);
    const rawLinkedInUrl = `${dsnUrl}/api/v1/linkedin`;
    const linkedInActivityUrl = `https://www.linkedin.com/voyager/api/feed/updates/urn:li:activity:${activityId}`;

    onApiCall?.();
    const rawResponse = await fetch(rawLinkedInUrl, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        account_id: unipileAccountId,
        request_url: linkedInActivityUrl,
        method: 'GET',
      }),
    });

    if (rawResponse.ok) {
      const rawData = await rawResponse.json();
      console.log(`${logPrefix} Raw LinkedIn API response: ${JSON.stringify(rawData).substring(0, 500)}`);
      const rawPostId = rawData?.data?.updateMetadata?.urn || rawData?.data?.urn || rawData?.urn;
      if (rawPostId) {
        socialId = rawPostId;
        console.log(`${logPrefix} Got ID from raw API: ${socialId}`);
      }
    } else {
      const errorText = await rawResponse.text();
      console.log(`${logPrefix} Raw LinkedIn API failed: ${rawResponse.status} - ${errorText.substring(0, 300)}`);
    }
  }

  return socialId;
}
