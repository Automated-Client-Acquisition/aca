/**
 * Native LinkedIn publishing on Unipile v2, for unipile_accounts rows with api_version = 'v2'
 * (the v1 path is publishLinkedInPost in ../linkedin-publishing.ts, on the SDK).
 *
 * POST /v2/{account_id}/posts            { text, attachments?, post_as? }  (v1 as_organization → post_as)
 * POST /v2/{account_id}/posts/{id}/comments { text, comment_as? }          (the first comment)
 * GET  /v2/{account_id}/linkedin/company/pages                              (pages the member manages)
 *
 * v2 takes attachments as base64 JSON objects { filename, content_type, content }. The whole body
 * sits in memory twice (bytes, then base64), so v2 caps media lower than v1's multipart path.
 *
 * @see docs/planning/unipile-v2-reference.md §3.5 (posts, comments), §1.11 (attachments)
 */
import { accountPath, type UnipileV2Client } from './v2-client.ts';
import {
  downloadLinkedInMedia,
  LinkedInPublishValidationError,
  type LinkedInPublishContent,
  type LinkedInPublishResult,
} from '../linkedin-publishing.ts';

/** Combined media per post on v2 (base64 inflates it by a third inside the edge function). */
export const V2_MAX_MEDIA_BYTES = 50 * 1024 * 1024;

export interface V2CompanyPage {
  id: string;
  name: string;
  avatar_url?: string;
}

type V2Client = Pick<UnipileV2Client, 'get' | 'post'>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function str(value: unknown): string | undefined {
  if (typeof value === 'string' && value) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

/** Company pages the account's member administers. Ids are LinkedIn's numeric organization ids. */
export async function listCompanyPagesV2(client: V2Client, accountId: string): Promise<V2CompanyPage[]> {
  const res = await client.get<unknown>(accountPath(accountId, '/linkedin/company/pages'), { noCache: true });
  const body = record(res);
  const items = Array.isArray(res) ? res : Array.isArray(body.items) ? body.items : Array.isArray(body.data) ? body.data : [];
  const pages = new Map<string, V2CompanyPage>();
  for (const raw of items) {
    const page = record(raw);
    const id = str(page.id) ?? str(page.organization_id) ?? str(page.company_id);
    const name = str(page.name) ?? str(page.display_name);
    if (!id || !/^\d+$/.test(id) || !name) continue;
    const avatar = str(page.logo) ?? str(page.profile_picture_url) ?? str(page.picture_url);
    pages.set(id, { id, name, ...(avatar ? { avatar_url: avatar } : {}) });
  }
  return [...pages.values()];
}

/** Fresh check so a cached page choice can't post after the member lost admin rights. */
export async function assertCompanyPageAccessV2(client: V2Client, accountId: string, organizationId: string): Promise<void> {
  if (!/^\d+$/.test(organizationId)) throw new LinkedInPublishValidationError('Invalid LinkedIn company page ID');
  const pages = await listCompanyPagesV2(client, accountId);
  if (!pages.some((p) => p.id === organizationId)) {
    throw new LinkedInPublishValidationError('This LinkedIn account no longer manages the selected company page');
  }
}

/**
 * Publishes a post as the member or one of their company pages. `onPublished` runs right after the
 * post exists (it records the publication), before the optional first comment, so a failed comment
 * can never make the caller retry and double-post.
 */
export async function publishLinkedInPostV2(
  client: V2Client,
  accountId: string,
  organizationId: string | undefined,
  content: LinkedInPublishContent,
  onPublished: (result: LinkedInPublishResult) => Promise<void>,
  download = downloadLinkedInMedia,
): Promise<LinkedInPublishResult> {
  const attachments: Array<{ filename: string; content_type: string; content: string }> = [];
  let totalBytes = 0;
  const add = async (url: string, kind: 'image' | 'video') => {
    const [filename, bytes] = await download(url, kind);
    totalBytes += bytes.byteLength;
    if (totalBytes > V2_MAX_MEDIA_BYTES) throw new LinkedInPublishValidationError('Media is too large for one LinkedIn post (50 MB)');
    const ext = filename.split('.').pop() || (kind === 'image' ? 'jpg' : 'mp4');
    attachments.push({ filename, content_type: `${kind}/${ext === 'jpg' ? 'jpeg' : ext}`, content: bytes.toString('base64') });
  };
  for (const url of content.images || []) await add(url, 'image');
  if (content.videoUrl) await add(content.videoUrl, 'video');

  const created = record(await client.post<unknown>(accountPath(accountId, '/posts'), {
    body: {
      text: content.caption,
      ...(attachments.length ? { attachments } : {}),
      ...(organizationId ? { post_as: organizationId } : {}),
    },
  }));
  const result: LinkedInPublishResult = {};
  const postId = str(created.id) ?? str(created.post_id);
  if (postId) result.post_id = postId;
  const url = str(created.share_url) ?? str(created.url);
  if (url) result.post_url = url;

  const warnings: string[] = [];
  try { await onPublished(result); } catch { warnings.push('Post published, but ACA could not save its publication record.'); }
  if (content.followUpComment) {
    if (!postId) warnings.push('Post published, but its id was unavailable; add the first comment manually.');
    else {
      try {
        await client.post(accountPath(accountId, `/posts/${encodeURIComponent(postId)}/comments`), {
          body: { text: content.followUpComment, ...(organizationId ? { comment_as: organizationId } : {}) },
        });
      } catch { warnings.push('Post published, but the first comment failed; add it manually.'); }
    }
  }
  if (warnings.length) result.warning = warnings.join(' ');
  return result;
}
