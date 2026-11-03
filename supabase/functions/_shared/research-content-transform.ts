/**
 * research_content row shape from an Apify item, per platform. Shared by
 * apify-webhook (creator / search-term scrapes) and import-post (single URL),
 * so an imported post looks exactly like a scraped one.
 */
import { youtubeSubtitlesText } from './scraped-transcript.ts';

// The tweet scraper only returns the 48x48 "_normal" thumbnail from pbs.twimg.com.
// Swapping in the "_400x400" size suffix is the standard trick to get a much
// higher-resolution version of the same image without an extra API call.
export function upgradeTwitterAvatarUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.replace(/_normal(\.[a-zA-Z]+)$/, '_400x400$1');
}

// Parse a value to integer, handling strings and numbers
export function parseIntSafe(value: any): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Math.floor(value);
  if (typeof value === 'string') {
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }
  return null;
}

// Parse ISO 8601 duration to seconds
export function parseDuration(duration: string): number | null {
  if (!duration) return null;
  const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!match) return null;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return hours * 3600 + minutes * 60 + seconds;
}

// Parse duration in HH:MM:SS or MM:SS format to seconds
export function parseTimeDuration(duration: string | null): number | null {
  if (!duration) return null;
  
  const parts = duration.split(':').map(p => parseInt(p, 10));
  
  if (parts.length === 3) {
    // HH:MM:SS
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    // MM:SS
    return parts[0] * 60 + parts[1];
  }
  
  return null;
}

// Full YouTube captions → transcript columns. TikTok/Instagram transcripts are
// fetched after the upsert (their caption/video links need a network call).
function youtubeTranscriptFields(subtitles: any) {
  const text = youtubeSubtitlesText(subtitles);
  if (!text) return { transcript_preview: null };
  return {
    transcript: text,
    transcript_preview: text.slice(0, 500),
    transcript_status: 'completed',
    transcript_source: 'subtitles',
  };
}

// Sanitize Unicode to remove invalid surrogate pairs
function sanitizeUnicode(str: string | null | undefined): string | null {
  if (!str) return null;
  // Replace invalid surrogate pairs with empty string
  return str.replace(/[\uD800-\uDFFF]/g, '');
}

// Deep sanitize object to clean all string values
export function sanitizeObject(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'string') return sanitizeUnicode(obj);
  if (Array.isArray(obj)) return obj.map(sanitizeObject);
  if (typeof obj === 'object') {
    const sanitized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  }
  return obj;
}

// Transform platform-specific data to unified format
export function transformContentItem(item: any, platform: string, runId: string, orgId: string, creatorId: string | null, searchTermId: string | null) {
  const baseContent = {
    id: crypto.randomUUID(),
    organization_id: orgId,
    platform,
    creator_id: creatorId,
    search_term_id: searchTermId,
    source_run_ids: [runId],
    raw_data: item,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  switch (platform) {
    case 'youtube':
      return {
        ...baseContent,
        title: item.title,
        description: item.text || item.description,
        url: item.url,
        thumbnail_url: item.thumbnailUrl,
        author_name: item.channelName || item.channelTitle,
        author_handle: item.channelUsername || item.channelHandle,
        author_avatar_url: item.channelAvatarUrl || item.channelThumbnail || item.authorThumbnail || item.avatar,
        author_url: item.channelUrl || (item.channelUsername ? `https://youtube.com/@${item.channelUsername}` : null),
        published_at: item.date || item.publishedAt,
        duration_seconds: parseTimeDuration(item.duration) || parseDuration(item.duration),
        engagement: {
          viewCount: item.viewCount || 0,
          likeCount: item.likes || item.likeCount || 0,
          commentCount: item.commentsCount || item.commentCount || 0
        },
        platform_data: {
          videoId: item.id || item.videoId,
          channelId: item.channelId,
          categoryId: item.categoryId,
          tags: item.tags || [],
          hashtags: item.hashtags || []
        },
        ...youtubeTranscriptFields(item.subtitles),
        author_audience: parseIntSafe(item.numberOfSubscribers)
      };

    case 'instagram':
      return {
        ...baseContent,
        title: item.caption?.slice(0, 200),
        description: item.caption,
        url: item.url,
        thumbnail_url: item.displayUrl,
        author_name: item.ownerUsername,
        author_handle: item.ownerUsername,
        author_url: `https://instagram.com/${item.ownerUsername}`,
        published_at: item.timestamp,
        engagement: {
          likeCount: item.likesCount || 0,
          commentCount: item.commentsCount || 0
        },
        platform_data: {
          type: item.type,
          isVideo: item.isVideo,
          hashtags: item.hashtags || []
        }
      };

    case 'tiktok':
      return {
        ...baseContent,
        title: item.text?.slice(0, 200),
        description: item.text,
        url: item.webVideoUrl,
        thumbnail_url: item.videoMeta?.coverUrl || item.videoMeta?.originalCoverUrl,
        author_name: item.authorMeta?.name,
        author_handle: item.authorMeta?.name,
        author_avatar_url: item.authorMeta?.avatar,
        author_audience: parseIntSafe(item.authorMeta?.fans),
        author_url: item.authorMeta?.profileUrl,
        published_at: item.createTimeISO ? new Date(item.createTimeISO).toISOString() : null,
        duration_seconds: item.videoMeta?.duration,
        engagement: {
          viewCount: item.playCount || 0,
          likeCount: item.diggCount || 0,
          commentCount: item.commentCount || 0,
          shareCount: item.shareCount || 0
        },
        platform_data: {
          videoId: item.id,
          hashtags: item.hashtags || [],
          musicName: item.musicMeta?.musicName,
          effectIds: item.effectStickers?.map((e: any) => e.id) || []
        }
      };

    case 'linkedin':
      // LinkedIn search scraper format (apimaestro~linkedin-posts-search-scraper-no-cookies)
      const linkedinUrl = item.post_url || item.postUrl || item.url || item.postLink || item.link;
      
      // Extract post thumbnail from content object
      let linkedinThumbnail = null;
      if (item.content) {
        if (item.content.article?.thumbnail_url) {
          linkedinThumbnail = item.content.article.thumbnail_url;
        } else if (item.content.celebration_image_url) {
          linkedinThumbnail = item.content.celebration_image_url;
        } else if (item.content.images?.[0]) {
          linkedinThumbnail = item.content.images[0];
        } else if (item.content.media?.[0]?.url) {
          linkedinThumbnail = item.content.media[0].url;
        }
      }
      // Fallback to root-level image fields
      if (!linkedinThumbnail) {
        linkedinThumbnail = item.images?.[0] || item.image_url || null;
      }
      
      // Parse published date - search scraper returns posted_at object with date string
      const publishedAt = item.posted_at?.date || item.postedAt || item.postedAtISO || item.publishedAt || item.date;
      
      // Extract title from text - use first line or first 100 chars
      const extractTitle = (text: string | null | undefined): string => {
        if (!text) return 'Untitled';
        const firstLine = text.split('\n')[0].trim();
        return firstLine.length > 100 ? firstLine.substring(0, 97) + '...' : firstLine;
      };
      
      const linkedinTitle = item.content?.article?.title || extractTitle(item.text || item.content?.text);
      
      const linkedinContent = {
        ...baseContent,
        platform: 'linkedin',
        title: linkedinTitle,
        description: item.text || item.content?.text || item.content?.article?.subtitle,
        url: linkedinUrl,
        thumbnail_url: linkedinThumbnail,
        author_name: item.author?.name || item.authorName,
        author_handle: item.author?.profile_id || item.author?.publicId || item.authorProfileId,
        author_avatar_url: item.author?.image_url || item.author?.picture || item.authorProfilePicture,
        author_url: item.author?.profile_url || item.author?.profileUrl || item.authorUrl || item.authorProfileUrl,
        published_at: publishedAt,
        engagement: {
          likeCount: item.stats?.total_reactions || item.numLikes || item.likeCount || 0,
          commentCount: item.stats?.comments || item.numComments || item.commentCount || 0,
          shareCount: item.stats?.shares || item.numShares || item.shareCount || 0
        },
        platform_data: {
          urn: item.full_urn || item.urn || item.activityUrn,
          activityUrn: item.activity_id || item.activityUrn,
          activityId: item.activity_id,
          authorHeadline: item.author?.headline || item.author?.occupation || item.authorHeadline,
          isReshare: item.is_reshare || false,
          contentType: item.content?.type,
          celebrationType: item.content?.celebration_type,
          hashtags: item.hashtags || [],
          reactions: item.stats?.reactions || [],
          edited: item.posted_at?.edited || false
        }
      };
      
      return linkedinContent;

    case 'twitter': {
      const tweetText = item.fullText || item.text || '';
      const tweetMedia = item.media?.[0] || item.extendedEntities?.media?.[0]?.media_url_https || null;

      return {
        ...baseContent,
        title: tweetText.slice(0, 200) || 'Untitled',
        description: tweetText,
        url: item.twitterUrl || item.url,
        thumbnail_url: tweetMedia,
        author_name: item.author?.name,
        author_handle: item.author?.userName,
        author_avatar_url: upgradeTwitterAvatarUrl(item.author?.profilePicture),
        author_audience: parseIntSafe(item.author?.followers),
        author_url: item.author?.twitterUrl || (item.author?.userName ? `https://x.com/${item.author.userName}` : null),
        published_at: item.createdAt,
        engagement: {
          viewCount: item.viewCount || 0,
          likeCount: item.likeCount || 0,
          commentCount: item.replyCount || 0,
          shareCount: item.retweetCount || 0
        },
        platform_data: {
          tweetId: item.id,
          lang: item.lang,
          hashtags: (item.entities?.hashtags || []).map((h: any) => h.text),
          isRetweet: item.isRetweet || false,
          isReply: item.isReply || false,
          isQuote: item.isQuote || false,
          quoteCount: item.quoteCount || 0,
          bookmarkCount: item.bookmarkCount || 0
        }
      };
    }

    default:
      return baseContent;
  }
}
