/**
 * X threads as text: numbered posts ("1/", "2.", "3)") or blank-line blocks.
 * Mirrors supabase/functions/_shared/thread-tweets.ts, which stores them on
 * stage_data.thread_tweets.content as {"tweets":[{"text"}]}.
 */

export function splitThreadText(text: string): string[] {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const numbered = clean.split(/\n?(?=^\s*\d+\s*[/.)]\s)/gm).map((s) => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered;
  return clean.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

/** Posts from a stored thread_tweets.content (JSON), or from plain text. */
export function threadTweetsFromContent(content: unknown): string[] {
  if (typeof content !== "string" || !content.trim()) return [];
  try {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed?.tweets) ? parsed.tweets : Array.isArray(parsed) ? parsed : null;
    if (list) return list.map((t: any) => String(t?.text ?? "").trim()).filter(Boolean);
  } catch {
    /* not JSON: plain text */
  }
  return splitThreadText(content);
}

export function threadContentFromText(text: string): string {
  return JSON.stringify({ tweets: splitThreadText(text).map((t) => ({ text: t })) });
}
