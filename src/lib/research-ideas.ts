/**
 * Turning a researched post into an idea. The idea's title is what blueprints
 * write about ({{topic}}); the notes reach them as {{idea_text}} ("Notes on
 * this topic" in Studio-built prompts), so they carry the source post and why
 * it worked, with a reminder to write our own take rather than copy it.
 */

export interface ResearchPostForIdea {
  id: string;
  platform: string;
  title: string | null;
  description: string | null;
  url: string | null;
  author_name: string | null;
  author_handle: string | null;
  ai_analysis: unknown;
  analyzed_at: string | null;
}

/** The parts of an analyze-scraped-content teardown used here. */
interface Teardown {
  _meta: unknown;
  topic?: string;
  summary?: string;
  hook?: { why_it_works?: string };
}

const PLATFORM_NAME: Record<string, string> = {
  linkedin: "LinkedIn",
  twitter: "X",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
  instagram: "Instagram",
  facebook: "Facebook",
  reddit: "Reddit",
};

const MAX_TITLE = 140;
const MAX_POST_TEXT = 1200;

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:.-]+$/, "")}…`;
}

/** A teardown written by analyze-scraped-content (it carries _meta); older ai_analysis shapes are ignored. */
function teardownOf(post: ResearchPostForIdea): Teardown | null {
  const a = post.ai_analysis as Partial<Teardown> | null;
  return post.analyzed_at && a && typeof a === "object" && a._meta ? (a as Teardown) : null;
}

export function ideaTitleFromPost(post: ResearchPostForIdea): string {
  const topic = clean(teardownOf(post)?.topic);
  if (topic.length >= 8) return cut(topic.charAt(0).toUpperCase() + topic.slice(1), MAX_TITLE);

  const text = clean(post.title) || clean(post.description);
  if (!text) return `${PLATFORM_NAME[post.platform] ?? "Social"} post by ${post.author_name || post.author_handle || "unknown"}`;
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] || text;
  return cut(firstSentence, MAX_TITLE);
}

export function ideaNotesFromPost(post: ResearchPostForIdea): string {
  const t = teardownOf(post);
  const platform = PLATFORM_NAME[post.platform] ?? post.platform;
  const author = post.author_name || (post.author_handle ? `@${post.author_handle}` : null);
  // The title is usually the description's first line: don't say it twice.
  const title = clean(post.title);
  const description = clean(post.description);
  const text = description.startsWith(title) ? description : [title, description].filter(Boolean).join(" — ");
  const body = cut(text, MAX_POST_TEXT);

  return [
    `Inspired by a ${platform} post${author ? ` by ${author}` : ""}. Write our own take for our audience; don't copy it.`,
    body ? `The post: "${body}"` : null,
    t?.summary ? `What it is: ${clean(t.summary)}` : null,
    t?.hook?.why_it_works ? `Why the hook works: ${clean(t.hook.why_it_works)}` : null,
  ]
    .filter(Boolean)
    .join("\n\n");
}
