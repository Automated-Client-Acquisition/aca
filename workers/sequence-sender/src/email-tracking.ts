/**
 * Email Tracking Module
 *
 * Pixel insertion, click URL rewriting, tracking domain support,
 * and per-provider pixel disabling.
 */

export interface TrackingSettings {
  open_tracking: boolean;
  click_tracking: boolean;
  custom_tracking_domain?: string | null;
  first_email_text_only?: boolean;
  unsubscribe_link_footer?: boolean;
  /** Sequence-level spintax template for the footer wording. See renderUnsubscribeHtml. */
  unsubscribe_footer_text?: string | null;
}

export function shouldInsertPixel(
  recipientEmail: string,
  settings: TrackingSettings
): boolean {
  if (!settings.open_tracking) return false;

  const domain = recipientEmail.split('@')[1]?.toLowerCase() || '';

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return false;
  }

  if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) {
    return false;
  }

  return true;
}

function resolveTrackingBaseUrl(trackingDomain?: string | null): string {
  if (trackingDomain) {
    return `https://${trackingDomain}`;
  }
  // No fallback — custom tracking domain is required.
  // The pre-send guard in the worker should prevent reaching here without a domain.
  throw new Error('[Email Tracking] No tracking domain provided — cannot build tracking URLs. Ensure a tracking domain is configured.');
}

function buildPixelUrl(sendLogId: string, trackingDomain?: string | null): string {
  const baseUrl = resolveTrackingBaseUrl(trackingDomain);
  return `${baseUrl}/functions/v1/email-track-open?id=${sendLogId}`;
}

function buildClickUrl(
  originalUrl: string,
  sendLogId: string,
  trackingDomain?: string | null
): string {
  const baseUrl = resolveTrackingBaseUrl(trackingDomain);
  const encoded = encodeURIComponent(originalUrl);
  return `${baseUrl}/functions/v1/email-track-click?id=${sendLogId}&url=${encoded}`;
}

export function insertTrackingPixel(
  html: string,
  sendLogId: string,
  trackingDomain?: string | null
): string {
  const pixelUrl = buildPixelUrl(sendLogId, trackingDomain);
  const pixelTag = `<img src="${pixelUrl}" width="1" height="1" style="display:none" alt="" />`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${pixelTag}</body>`);
  }

  return html + pixelTag;
}

export function rewriteClickUrls(
  html: string,
  sendLogId: string,
  trackingDomain?: string | null,
  unsubscribeUrl?: string
): string {
  return html.replace(
    /<a\s+([^>]*?)href=["']([^"']+)["']([^>]*?)>/gi,
    (_match, before, url, after) => {
      if (
        url.startsWith('mailto:') ||
        url.startsWith('#') ||
        url.startsWith('tel:') ||
        url.includes('unsubscribe') ||
        isUnsubscribeUrl(url, unsubscribeUrl)
      ) {
        return `<a ${before}href="${url}"${after}>`;
      }

      // Normalize protocol-less URLs (e.g. "skool.com/..." → "https://skool.com/...")
      let normalizedUrl = url;
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        normalizedUrl = `https://${url}`;
      }

      const trackingUrl = buildClickUrl(normalizedUrl, sendLogId, trackingDomain);
      return `<a ${before}href="${trackingUrl}"${after}>`;
    }
  );
}

export function stripHtmlToPlainText(html: string): string {
  let text = html;

  text = text.replace(/<br\s*\/?>/gi, '\n');
  text = text.replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n');
  text = text.replace(/<(p|div|h[1-6]|li|tr)[^>]*>/gi, '');

  text = text.replace(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>([^<]+)<\/a>/gi, '$2 ($1)');

  text = text.replace(/<[^>]+>/g, '');

  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, ' ');

  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

/**
 * Unsubscribe link rendering.
 *
 * Three rules, all of them deliverability-driven:
 *  1. Never show the raw URL to a recipient — it is a signed token on an infra
 *     host and reads like a phishing link. Always hyperlink human anchor text.
 *  2. Vary the wording (spintax) so every ACA email doesn't end with the exact
 *     same byte sequence — an identical footer across senders is a trivial
 *     fingerprint for filters.
 *  3. Vary the wrapper markup for the same reason.
 *
 * Keep this block byte-identical with supabase/functions/_shared/email-tracking.ts.
 */
const UNSUBSCRIBE_PHRASES = [
  '{Unsubscribe|unsubscribe}',
  '{Opt out|opt out}',
  '{Unsubscribe here|Opt out here}',
  '{Remove me|Take me off this list}',
  '{Not interested?|Not a fit?|Wrong person?} {Unsubscribe|Opt out}',
  "{Don't want these?|Prefer not to get these?} {Unsubscribe|Opt out}",
];

const UNSUBSCRIBE_WRAPPERS = [
  (link: string) => `<div style="margin-top:32px;font-size:10px;color:#bcbcbc;">${link}</div>`,
  (link: string) => `<p style="margin-top:28px;font-size:11px;color:#c0c0c0;">${link}</p>`,
  (link: string) => `<div style="margin-top:36px;font-size:10px;color:#b8b8b8;">${link}</div>`,
];

/** Resolve flat spintax `{a|b|c}` -> one branch, chosen uniformly. */
function resolveSpintax(text: string): string {
  if (!text || text.indexOf('|') === -1) return text;
  return text.replace(/\{([^{}]*\|[^{}]*)\}/g, (_m, group: string) => {
    const options = group.split('|');
    return options[Math.floor(Math.random() * options.length)];
  });
}

function pickRandom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

/**
 * Resolve the footer wording for one send.
 *
 * `template` is the sequence's own spintax string (Compliance → "Unsubscribe
 * wording"); empty/undefined falls back to the built-in rotation above.
 *
 * Two authoring rules, both surfaced in the UI:
 *   {a|b|c}  — pick one at random, same spintax as the email body
 *   [text]   — hyperlink just this part; everything outside stays plain text.
 *              With no brackets the whole line becomes the link.
 *
 * Returns the resolved string still carrying its brackets — callers decide
 * whether to render it as HTML (anchor) or plain text (bracket stripped).
 */
export function resolveUnsubscribeTemplate(template?: string | null): string {
  const source = template && template.trim() ? template : pickRandom(UNSUBSCRIBE_PHRASES);
  return resolveSpintax(source);
}

/** Spintax-varied anchor text for an unsubscribe link. */
export function unsubscribeLabel(template?: string | null): string {
  return resolveUnsubscribeTemplate(template).replace(/\[([^\]]*)\]/, '$1');
}

const LINK_STYLE = 'color:inherit;text-decoration:underline;';

/** Hyperlinked unsubscribe, never a bare URL. */
export function buildUnsubscribeAnchor(unsubscribeUrl: string, template?: string | null): string {
  const resolved = resolveUnsubscribeTemplate(template);

  // [bracketed] segment → link only that part, keep the rest as plain text.
  const bracketed = resolved.match(/^(.*?)\[([^\]]*)\](.*)$/s);
  if (bracketed) {
    const [, before, linked, after] = bracketed;
    return `${before}<a href="${unsubscribeUrl}" style="${LINK_STYLE}">${linked}</a>${after}`;
  }

  return `<a href="${unsubscribeUrl}" style="${LINK_STYLE}">${resolved}</a>`;
}

/** True when `url` is this send's unsubscribe URL (so click tracking skips it). */
function isUnsubscribeUrl(url: string, unsubscribeUrl?: string): boolean {
  if (!unsubscribeUrl) return false;
  return url === unsubscribeUrl;
}

/**
 * Build the unsubscribe footer HTML snippet.
 */
function buildUnsubscribeFooter(unsubscribeUrl: string, template?: string | null): string {
  return pickRandom(UNSUBSCRIBE_WRAPPERS)(buildUnsubscribeAnchor(unsubscribeUrl, template));
}

/**
 * HTML companion for a "text-only" first-step send — used only to give the
 * unsubscribe phrase a real hyperlink in the multipart/alternative payload.
 * Mail clients that render the html part see a clickable link instead of a
 * bare URL; clients that only render text/plain still get the bare-URL
 * fallback from prepareEmailBody's plain-text output. Resolves its own
 * spintax pick, independent of the text part's — fine, since no client
 * renders both parts of a multipart/alternative message at once.
 */
export function buildTextOnlyUnsubscribeHtml(
  body: string,
  settings: TrackingSettings,
  unsubscribeUrl?: string
): string | undefined {
  if (!unsubscribeUrl || settings.unsubscribe_link_footer === false || body.includes(unsubscribeUrl)) {
    return undefined;
  }
  const escaped = stripHtmlToPlainText(body)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
  return `${escaped}<br><br>${buildUnsubscribeAnchor(unsubscribeUrl, settings.unsubscribe_footer_text)}`;
}

export function prepareEmailBody(
  body: string,
  sendLogId: string,
  recipientEmail: string,
  settings: TrackingSettings,
  isFirstStep: boolean = false,
  unsubscribeUrl?: string
): string {
  if (settings.first_email_text_only && isFirstStep) {
    let text = stripHtmlToPlainText(body);
    if (unsubscribeUrl && settings.unsubscribe_link_footer !== false && !body.includes(unsubscribeUrl)) {
      text += `\n\n${unsubscribeLabel(settings.unsubscribe_footer_text)}\n${unsubscribeUrl}`;
    }
    return text;
  }

  let processed = body;

  // Convert plain-text newlines to <br> tags for HTML emails.
  // Legacy step bodies (plain-text <textarea>) contain literal \n characters
  // that are invisible in HTML without this conversion. WYSIWYG-authored
  // bodies (email-editor sequence steps) are already block-tagged HTML with
  // no incidental newlines between tags, so first collapse any whitespace-only
  // newline sitting between two tags (a no-op on plain text, since it has no
  // tag boundaries) before converting the rest.
  processed = processed.replace(/>\s*\n\s*</g, '><').replace(/\n/g, '<br>');

  // Auto-inject unsubscribe footer if enabled and {{unsubscribe_link}} variable wasn't manually used
  if (unsubscribeUrl && settings.unsubscribe_link_footer !== false && !processed.includes(unsubscribeUrl)) {
    const footer = buildUnsubscribeFooter(unsubscribeUrl, settings.unsubscribe_footer_text);
    if (processed.includes('</body>')) {
      processed = processed.replace('</body>', `${footer}</body>`);
    } else {
      processed += footer;
    }
  }

  if (settings.click_tracking) {
    processed = rewriteClickUrls(processed, sendLogId, settings.custom_tracking_domain, unsubscribeUrl);
  }

  if (shouldInsertPixel(recipientEmail, settings)) {
    processed = insertTrackingPixel(processed, sendLogId, settings.custom_tracking_domain);
  }

  return processed;
}
