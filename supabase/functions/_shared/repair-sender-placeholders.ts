/**
 * The AI email writer is told to reproduce {{sender_first_name}} /
 * {{sender_last_name}} character-for-character (see the SENDER NAME rule in
 * generate-email-sequence). Some models drop the trailing "name" and emit
 * {{sender_first_}} instead - a well-formed-looking tag that the send-time
 * resolver's exact regex doesn't match, so it goes out to the prospect
 * verbatim. Repair any near-miss variant back to the real token.
 *
 * Incident 2026-09-09: ~4,700 pending sends and 1,133 already-sent emails on
 * one sequence carried the literal text "{{sender_first_}}" before this
 * existed.
 */
export function repairSenderPlaceholders(text: string): string {
  if (!text) return text;
  return text
    .replace(/\{\{\s*sender_first[a-z_]*\s*\}\}/gi, '{{sender_first_name}}')
    .replace(/\{\{\s*sender_last[a-z_]*\s*\}\}/gi, '{{sender_last_name}}');
}
