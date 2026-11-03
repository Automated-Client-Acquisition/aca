/**
 * Cold-email content quality scorer (Phase 8.1.4).
 *
 * Returns a 0-100 score (higher = cleaner, less spammy) plus a list of warnings.
 * Used as a pre-flight gate in the sequence processor: scores below
 * `scoreThreshold` are blocked before the email leaves the server.
 *
 * This is heuristic, not ML — it catches the obvious offenders that ESPs flag:
 *   - Spam-trigger phrases ("act now", "click below", "guarantee")
 *   - Excessive links / images / ALL CAPS / emoji density
 *   - Subject line patterns that fail Gmail's promotional-tab classifier
 *   - Image-to-text ratio (image-only emails get sandboxed)
 *   - Missing personalization (template detection)
 *
 * Scoring deltas are conservative; a single warning costs 5-15 points so
 * 2-3 minor issues still pass. Hard fails (multiple ALL CAPS phrases,
 * money symbols in subject) drop you below 50 instantly.
 */

export interface ContentScoreInput {
  subject: string;
  body: string;
  /** Whether the body is rendered HTML or plain text. Affects image/link detection. */
  isHtml: boolean;
  /** Whether this is the FIRST email in the sequence — first emails are held to a higher bar. */
  isFirstStep: boolean;
}

export interface ContentScoreWarning {
  code: string;
  message: string;
  severity: 'minor' | 'major' | 'critical';
  delta: number;
}

export interface ContentScoreResult {
  score: number;            // 0-100, higher = better
  warnings: ContentScoreWarning[];
  /** Quick rollups for the UI. */
  metrics: {
    word_count: number;
    link_count: number;
    image_count: number;
    image_to_text_ratio: number;
    spam_trigger_count: number;
    /** Every distinct trigger phrase found (the warning message truncates to 5). */
    spam_triggers: string[];
    all_caps_words: number;
    emoji_count: number;
  };
}

// Curated trigger words from Gmail/Outlook spam classifier patterns. Not
// exhaustive — focused on the high-precision false-positive-prone offenders
// that show up in cold email templates.
const SPAM_TRIGGERS: string[] = [
  'act now', 'click below', 'click here', 'limited time', 'limited offer',
  'no obligation', 'risk-free', 'risk free', 'guarantee', 'guaranteed',
  '100% free', '100% off', 'free trial', 'no cost', 'no fees',
  'cash bonus', 'extra cash', 'make money', 'earn money', 'earn extra',
  'get rich', 'million dollars', 'billion dollars', 'wealth',
  'lowest price', 'best price', 'cheap', 'discount', 'huge discount',
  'amazing', 'incredible deal', 'unbelievable', 'once in a lifetime',
  'this is not spam', 'this isn\'t spam', 'not a scam',
  'urgent', 'urgent response', 'final notice', 'last chance',
  'order now', 'order today', 'buy now', 'buy direct',
  'apply now', 'apply online', 'pre-approved', 'pre approved',
  'congratulations', 'you have won', 'you are a winner', 'winner',
  'viagra', 'cialis', 'prescription', 'meds', 'pharmacy',
  'casino', 'lottery', 'jackpot', 'gambling', 'bet',
  'click', 'subscribe', 'unsubscribe', 'opt-in', // safe-ish but penalize cluster
  'crypto', 'bitcoin', 'nft', 'mining', // 2026-relevant additions
  // From the trigger-word list in our own deliverability guide
  // (src/data/blogPosts/email-spam-trigger-words.ts). Multi-word phrases only:
  // single words like "perfect" or "trusted" misfire on normal B2B copy.
  'big bucks', 'save big', 'special offer', 'money back', 'no hidden costs',
  'no risk', 'no catch', '100% satisfied', 'promise you', 'award winning',
  'hurry', 'don\'t delete', 'get started now', 'sign up free', 'visit our website',
  'this won\'t last', 'expires today', 'while supplies last',
  'free gift', 'free sample', 'free quote', 'free consultation', 'free preview',
  'you have been selected', 'you\'re a winner', 'miracle',
  'dear friend', 'dear sir or madam', 'hi friend',
  'work from home', 'be your own boss', 'online pharmacy',
  'increase sales', 'increase traffic', 'search engine listings',
  'lose weight', 'weight loss', 'consolidate debt', 'get out of debt',
];

const HARD_BLOCK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /\$\d{3,}/, label: 'a dollar amount of $100 or more' },
  { re: /\b(FREE|URGENT|BUY NOW|ACT NOW)\b/, label: 'an ALL-CAPS spam classic (FREE, URGENT, BUY NOW, ACT NOW)' },
  { re: /\b\d{3,}\s?%\s?(off|discount|free)/i, label: 'an inflated "100%+ off/discount/free" claim' },
  { re: /[!]{3,}/, label: 'three or more exclamation marks (!!!)' },
  { re: /(.)\1{4,}/, label: 'the same character repeated 5+ times' },
];

function countMatches(haystack: string, needle: string): number {
  // Escape regex specials in needle
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`\\b${escaped}\\b`, 'gi');
  return (haystack.match(re) ?? []).length;
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}]/gu;
const URL_RE = /https?:\/\/[^\s<>"]+/g;
const IMG_TAG_RE = /<img\b[^>]*>/gi;

export function scoreContent(input: ContentScoreInput): ContentScoreResult {
  const subject = input.subject || '';
  const rawBody = input.body || '';
  const textBody = input.isHtml ? stripHtml(rawBody) : rawBody;

  const warnings: ContentScoreWarning[] = [];
  let score = 100;

  // ── Subject line checks ──────────────────────────────────────────────────
  if (subject.length < 8) {
    warnings.push({ code: 'subject_too_short', message: 'Subject is shorter than 8 chars — looks generic.', severity: 'minor', delta: 5 });
    score -= 5;
  }
  if (subject.length > 80) {
    warnings.push({ code: 'subject_too_long', message: 'Subject longer than 80 chars — Gmail truncates and ranks down.', severity: 'minor', delta: 5 });
    score -= 5;
  }
  // ALL CAPS in subject (3+ consecutive uppercase words)
  const subjectAllCaps = (subject.match(/\b[A-Z]{2,}\b/g) ?? []).length;
  if (subjectAllCaps >= 2) {
    warnings.push({ code: 'subject_all_caps', message: `Subject has ${subjectAllCaps} ALL-CAPS words — strong spam signal.`, severity: 'major', delta: 15 });
    score -= 15;
  }
  // Money symbols / large numbers in subject
  if (/\$|€|£|¥|￥|₹/.test(subject)) {
    warnings.push({ code: 'subject_money_symbol', message: 'Currency symbol in subject — Gmail flags as promotional.', severity: 'major', delta: 12 });
    score -= 12;
  }
  // Excessive punctuation
  const subjectPunct = (subject.match(/[!?]{2,}/g) ?? []).length;
  if (subjectPunct > 0) {
    warnings.push({ code: 'subject_punct', message: 'Multiple !! or ?? in subject.', severity: 'major', delta: 10 });
    score -= 10;
  }
  // Emoji in subject (acceptable in moderation, but >2 reads as marketing)
  const subjectEmoji = (subject.match(EMOJI_RE) ?? []).length;
  if (subjectEmoji > 2) {
    warnings.push({ code: 'subject_emoji_overload', message: `${subjectEmoji} emoji in subject — promotional-tab signal.`, severity: 'minor', delta: 8 });
    score -= 8;
  }

  // ── Body checks ──────────────────────────────────────────────────────────
  const wordCount = textBody.split(/\s+/).filter(Boolean).length;
  const linkCount = (rawBody.match(URL_RE) ?? []).length;
  const imageCount = input.isHtml ? (rawBody.match(IMG_TAG_RE) ?? []).length : 0;
  const imageToTextRatio = wordCount === 0 ? 1 : imageCount / Math.max(1, wordCount / 50);
  const allCapsWords = (textBody.match(/\b[A-Z]{2,}\b/g) ?? []).length;
  const emojiCount = (textBody.match(EMOJI_RE) ?? []).length;

  // Spam trigger phrases in body or subject
  let spamTriggerCount = 0;
  const triggersHit: string[] = [];
  const haystack = `${subject} ${textBody}`;
  for (const trig of SPAM_TRIGGERS) {
    const n = countMatches(haystack, trig);
    if (n > 0) {
      spamTriggerCount += n;
      triggersHit.push(trig);
    }
  }
  if (spamTriggerCount > 0) {
    const delta = Math.min(35, spamTriggerCount * 7);
    warnings.push({
      code: 'spam_triggers',
      message: `${spamTriggerCount} spam-trigger phrase${spamTriggerCount > 1 ? 's' : ''}: ${triggersHit.slice(0, 5).join(', ')}${triggersHit.length > 5 ? '...' : ''}`,
      severity: spamTriggerCount >= 4 ? 'critical' : 'major',
      delta,
    });
    score -= delta;
  }

  // First-email link policy: 0 links is best, 1 acceptable, 2+ penalized
  if (input.isFirstStep && linkCount > 0) {
    const delta = linkCount === 1 ? 5 : 10 + (linkCount - 1) * 5;
    warnings.push({
      code: 'first_email_links',
      message: `First email has ${linkCount} link${linkCount > 1 ? 's' : ''} — best practice: 0 links in opener.`,
      severity: linkCount > 2 ? 'major' : 'minor',
      delta,
    });
    score -= delta;
  }

  // First-email image policy: any image in opener is a spam signal
  if (input.isFirstStep && imageCount > 0) {
    warnings.push({
      code: 'first_email_images',
      message: `First email has ${imageCount} image${imageCount > 1 ? 's' : ''} — best practice: text-only opener.`,
      severity: 'major',
      delta: 12,
    });
    score -= 12;
  }

  // Image-to-text ratio (HTML emails)
  if (input.isHtml && wordCount > 0 && imageToTextRatio > 0.6) {
    warnings.push({
      code: 'image_heavy',
      message: 'Image-to-text ratio too high — image-only emails get sandboxed.',
      severity: 'major',
      delta: 12,
    });
    score -= 12;
  }

  // ALL CAPS density
  const allCapsRatio = wordCount === 0 ? 0 : allCapsWords / wordCount;
  if (allCapsRatio > 0.05) {
    const delta = Math.min(20, Math.floor(allCapsRatio * 100));
    warnings.push({
      code: 'all_caps_density',
      message: `${allCapsWords} ALL-CAPS words in body (${(allCapsRatio * 100).toFixed(1)}%).`,
      severity: 'major',
      delta,
    });
    score -= delta;
  }

  // Hard block patterns
  for (const { re, label } of HARD_BLOCK_PATTERNS) {
    if (re.test(haystack)) {
      warnings.push({
        code: 'hard_block_pattern',
        message: `Contains ${label} — heavy spam signal.`,
        severity: 'critical',
        delta: 25,
      });
      score -= 25;
      break; // one hard-block hit is enough
    }
  }

  // Word count: too short (<20) or too long (>400) for cold email
  if (wordCount > 0 && wordCount < 20) {
    warnings.push({
      code: 'too_short',
      message: `Body is ${wordCount} words — cold email should be 40-150.`,
      severity: 'minor',
      delta: 5,
    });
    score -= 5;
  }
  if (wordCount > 400) {
    warnings.push({
      code: 'too_long',
      message: `Body is ${wordCount} words — cold email should be 40-150.`,
      severity: 'minor',
      delta: 5,
    });
    score -= 5;
  }

  // Personalization heuristic: if first email is identical to template (no
  // first_name / company / role / pain point in body) it reads as bulk.
  // We can't know the merge vars from this layer — but unresolved {{var}}
  // means the template wasn't filled. Catch that.
  if (/\{\{[^}]+\}\}/.test(rawBody) || /\{\{[^}]+\}\}/.test(subject)) {
    warnings.push({
      code: 'unresolved_merge_var',
      message: 'Subject or body contains unresolved {{merge_var}} — variable was not filled.',
      severity: 'critical',
      delta: 30,
    });
    score -= 30;
  }

  // Floor + clamp
  score = Math.max(0, Math.min(100, score));

  return {
    score,
    warnings,
    metrics: {
      word_count: wordCount,
      link_count: linkCount,
      image_count: imageCount,
      image_to_text_ratio: Number(imageToTextRatio.toFixed(2)),
      spam_trigger_count: spamTriggerCount,
      spam_triggers: triggersHit,
      all_caps_words: allCapsWords,
      emoji_count: emojiCount,
    },
  };
}

/**
 * Default block threshold: anything below 60 is blocked at the edge fn.
 * Unresolved merge vars (delta 30) + 2-3 minor issues will trip this.
 */
export const DEFAULT_BLOCK_THRESHOLD = 60;
