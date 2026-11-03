/**
 * X threads: the model writes numbered posts ("1/", "2.", "3)") as the Studio
 * brief asks; publishing needs them as a list. Stored on
 * stage_data.thread_tweets.content as JSON {"tweets":[{"text"}]}, the shape
 * approve-stage and process-publish-queue read. Mirrors src/lib/thread-text.ts.
 */

export interface ThreadTweet {
  text: string;
}

/** Split a written thread into posts: numbered markers first, blank lines otherwise. */
export function splitThreadTweets(text: string): string[] {
  const clean = String(text ?? '').replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  const numbered = clean.split(/\n?(?=^\s*\d+\s*[/.)]\s)/gm).map((s) => s.trim()).filter(Boolean);
  if (numbered.length > 1) return numbered;
  return clean.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
}

export function threadContent(text: string): string {
  return JSON.stringify({ tweets: splitThreadTweets(text).map((t): ThreadTweet => ({ text: t })) });
}
