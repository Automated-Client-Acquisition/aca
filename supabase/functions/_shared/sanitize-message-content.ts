/**
 * Sanitize Message Content
 *
 * Detects and cleans garbled/binary text that Unipile sometimes returns
 * for LinkedIn messages (corrupted encoding, encrypted payloads, etc.).
 *
 * Used by: unipile-webhook-handler, channels/unipile.ts
 */

/**
 * Clean garbled text from message content.
 * Returns the cleaned string, or null if the content is entirely garbled.
 *
 * Does NOT trim or truncate legitimate content — only strips replacement
 * characters and control chars, then checks if the result is readable.
 */
export function sanitizeMessageContent(text: string | null | undefined): string | null {
  if (!text) return null;

  // Strip Unicode replacement characters (U+FFFD)
  let cleaned = text.replace(/\uFFFD/g, '');
  // Strip control chars except newline, carriage return, tab
  cleaned = cleaned.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

  if (!cleaned.trim()) return null;

  // Heuristic: if >40% of chars are non-readable (not word chars, whitespace,
  // or common punctuation), the content is garbled binary data.
  const readable = cleaned.replace(
    /[^\w\s.,!?'"@#$%&()\-:;/\\=+<>[\]{}|~`^*€£¥©®™°…–—''""•·\n\r\t]/g,
    ''
  );
  if (cleaned.trim().length >= 4 && readable.length / cleaned.trim().length < 0.6) {
    return null;
  }

  return cleaned;
}
