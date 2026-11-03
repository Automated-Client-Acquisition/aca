/**
 * Instagram lead magnets on Unipile v2: the account's own posts, a post's comments, and the
 * commenter's messaging identifier. Results come back in the v1 shapes the auto-add job and the
 * comment poller already store and parse, so those functions only branch on where they fetch from.
 *
 * v2 Instagram DMs go to `specifics.messaging_identifier` (the 1:1 chat id is the same value),
 * not to the profile id a comment carries. resolveMessagingId() turns one into the other.
 *
 * @see docs/planning/unipile-v2-reference.md §3.5 (posts, comments) and §5.2, §6.3 (Instagram ids)
 */

import { accountPath, type UnipileV2Client } from './v2-client.ts';
import type { UnipileInstagramComment } from '../unipile-client.ts';

type Obj = Record<string, unknown>;
interface V2List { data?: Obj[]; next_cursor?: string | null }

const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const obj = (v: unknown): Obj => (v && typeof v === 'object' ? v as Obj : {});

/** The account's own user id: stored at connect time, otherwise asked from `users/me`. */
export async function ownUserId(client: UnipileV2Client, accountId: string, metadata?: unknown): Promise<string> {
  const stored = str(obj(obj(metadata).unipile_v2).user_id);
  if (stored) return stored;
  const me = await client.get<Obj>(accountPath(accountId, '/users/me'));
  const id = str(me?.id);
  if (!id) throw new Error('Unipile v2 users/me returned no id');
  return id;
}

/**
 * The account's posts in the v1 item shape auto-add stores: `id`, `social_id`, `share_url`, `text`,
 * `author{name, profile_picture_url}`, `date`. Newest pages first, up to `maxPages`.
 */
export async function listOwnPosts(
  client: UnipileV2Client,
  accountId: string,
  userId: string,
  maxPages = 2,
): Promise<Obj[]> {
  const posts: Obj[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page++) {
    const res: V2List = await client.get<V2List>(
      accountPath(accountId, `/users/${encodeURIComponent(userId)}/posts`),
      { query: { cursor: cursor ?? undefined }, noCache: true },
    );
    for (const p of res?.data ?? []) {
      const id = str(p.id);
      if (!id) continue;
      const author = obj(p.author);
      posts.push({
        id,
        social_id: id, // v2 has one post id, valid for the comments route
        share_url: str(p.share_url) ?? str(p.url) ?? str(p.permalink) ?? '',
        title: null,
        text: str(p.text) ?? '',
        author: {
          name: str(author.display_name) ?? str(author.public_identifier),
          profile_picture_url: str(author.public_picture_url) ?? str(author.profile_picture_url),
        },
        date: str(p.created_at),
      });
    }
    cursor = str(res?.next_cursor);
    if (!cursor) break;
  }
  return posts;
}

/** One v2 comment in the v1 Instagram shape (`isInstagramComment` accepts it). */
export function toV1InstagramComment(c: Obj): UnipileInstagramComment {
  const author = obj(c.author);
  const specifics = obj(author.specifics);
  const authorId = str(author.id) ?? '';
  const created = str(c.created_at) ? Date.parse(c.created_at as string) : NaN;
  return {
    object: 'Comment',
    provider_id: str(c.id) ?? '',
    author: {
      provider_id: authorId,
      // Present only when the comment payload carries it; resolveMessagingId() fills the gap.
      messaging_id: str(specifics.messaging_identifier) ?? str(author.messaging_identifier) ?? '',
      public_identifier: str(author.public_identifier) ?? str(author.username) ?? str(author.display_name) ?? '',
      pk: authorId,
      profile_pic_url: str(author.public_picture_url) ?? '',
      is_verified: author.is_verified === true,
    },
    text: str(c.text) ?? '',
    created_at: Number.isFinite(created) ? Math.floor(created / 1000) : Math.floor(Date.now() / 1000),
    is_covered: false,
    child_comment_count: typeof c.replies_counter === 'number' ? c.replies_counter : 0,
    restricted_status: null,
    has_liked_comment: false,
    giphy_media_info: null,
    parent_comment_id: str(c.parent_id) ?? str(c.parent_comment_id),
    comment_like_count: typeof c.reactions_counter === 'number' ? c.reactions_counter : 0,
  };
}

/**
 * A post's comments from `startCursor`, same contract as the poller's v1 fetch: the comments and
 * the cursor to resume from next time (null once the end is reached).
 */
export async function listPostComments(
  client: UnipileV2Client,
  accountId: string,
  postId: string,
  startCursor: string | null,
  maxPages = 5,
): Promise<{ comments: UnipileInstagramComment[]; lastCursor: string | null }> {
  const comments: UnipileInstagramComment[] = [];
  let cursor = startCursor;
  for (let page = 0; page < maxPages; page++) {
    const res: V2List = await client.get<V2List>(
      accountPath(accountId, `/posts/${encodeURIComponent(postId)}/comments`),
      { query: { cursor: cursor ?? undefined }, noCache: true },
    );
    for (const c of res?.data ?? []) comments.push(toV1InstagramComment(c));
    cursor = str(res?.next_cursor);
    if (!cursor) break;
  }
  return { comments, lastCursor: cursor };
}

/**
 * The id an Instagram DM must go to. Uses the one on the comment when it has it, otherwise reads the
 * commenter's profile. Returns null when the profile has none (the DM would fail).
 */
export async function resolveMessagingId(
  client: UnipileV2Client,
  accountId: string,
  comment: Pick<UnipileInstagramComment, 'author'>,
): Promise<string | null> {
  if (comment.author.messaging_id) return comment.author.messaging_id;
  if (!comment.author.provider_id) return null;
  const profile = await client.get<Obj>(accountPath(accountId, `/users/${encodeURIComponent(comment.author.provider_id)}`));
  return str(obj(profile?.specifics).messaging_identifier) ?? str(profile?.messaging_identifier);
}
