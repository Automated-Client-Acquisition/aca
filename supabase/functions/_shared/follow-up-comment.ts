/**
 * Follow-up (first) comment support.
 *
 * A writing stage can end a post with a line containing only `---FOLLOW-UP---`
 * followed by the comment to post right after publishing (LinkedIn lead magnets
 * put the resource link there, since keyword gating no longer works). Publishers
 * split the stored text here so the marker never reaches a platform.
 *
 * GHL's create-post API takes it as `followUpComment`, supported on Facebook,
 * Instagram, LinkedIn, Community, Threads, Bluesky, YouTube and TikTok (not
 * Pinterest, GMB or X).
 */

export const FOLLOW_UP_MARKER = '---FOLLOW-UP---';

const MARKER_RE = /^[ \t]*-{3}[ \t]*FOLLOW[ -]?UP[ \t]*-{3}[ \t]*$/im;

/** GHL account types (from list accounts) that accept followUpComment. */
export const FOLLOW_UP_ACCOUNT_TYPES = new Set([
  'facebook',
  'instagram',
  'linkedin',
  'community',
  'threads',
  'bluesky',
  'youtube',
  'tiktok',
]);

export interface SplitCaption {
  caption: string;
  followUpComment?: string;
}

export function splitFollowUpComment(text: string | null | undefined): SplitCaption {
  const raw = text ?? '';
  const match = MARKER_RE.exec(raw);
  if (!match) return { caption: raw };

  const caption = raw.slice(0, match.index).trimEnd();
  const followUp = raw.slice(match.index + match[0].length).trim();
  return followUp ? { caption, followUpComment: followUp } : { caption };
}
