// Mirrors the pipeline → required-providers logic in
// supabase/functions/dispatch-generation-job/index.ts (lines 386-441).
// Keep both in sync — if a pipeline gains a hard dependency on a provider,
// add it here too so the UI can warn upfront instead of letting dispatch fail.

export type Provider =
  | "openrouter"
  | "replicate"
  | "elevenlabs"
  | "heygen";

const VIDEO_PIPELINES = new Set([
  "ugc_video",
  "ugc_heygen",
  "ugc_heygen_template",
  "generative_video_oneshot",
  "storyboard_video_longform",
  "presenter_video",
  "video_remix",
  "video",
]);

const TEXT_PIPELINES = new Set([
  "social_media_post",
  "instagram_carousel",
  "instagram_carousel_ai",
  "video_script",
  "rich_article",
  "twitter_thread",
]);

const IMAGE_PIPELINES = new Set([
  "image_only",
  "social_media_post",
  "rich_article",
]);

const REPLICATE_PIPELINES = new Set([
  "ugc_video",
  "generative_video_oneshot",
]);

const HEYGEN_PIPELINES = new Set([
  "ugc_heygen",
  "ugc_heygen_template",
]);

const ELEVENLABS_PIPELINES = new Set([
  "ugc_video",
  "storyboard_video_longform",
  "presenter_video",
  "video_remix",
  "video",
]);

export function getRequiredProviders(pipeline: string | undefined | null): Provider[] {
  if (!pipeline) return [];

  const required = new Set<Provider>();

  if (VIDEO_PIPELINES.has(pipeline) || TEXT_PIPELINES.has(pipeline) || IMAGE_PIPELINES.has(pipeline)) {
    required.add("openrouter");
  }
  if (REPLICATE_PIPELINES.has(pipeline)) {
    required.add("replicate");
  }
  if (HEYGEN_PIPELINES.has(pipeline)) {
    required.add("heygen");
  }
  // ElevenLabs is a soft requirement on the server (warns but doesn't throw).
  // Surface it in the UI so users know they need it for voiceovers, but don't
  // treat it as a hard block.
  if (ELEVENLABS_PIPELINES.has(pipeline)) {
    required.add("elevenlabs");
  }

  return Array.from(required);
}

const HARD_REQUIREMENTS: Record<Provider, boolean> = {
  openrouter: true,
  replicate: true,
  heygen: true,
  elevenlabs: false,
};

export function isHardRequirement(provider: Provider): boolean {
  return HARD_REQUIREMENTS[provider] ?? true;
}

const PROVIDER_LABELS: Record<Provider, string> = {
  openrouter: "OpenRouter",
  replicate: "Replicate",
  elevenlabs: "ElevenLabs",
  heygen: "HeyGen",
};

export function providerLabel(provider: Provider): string {
  return PROVIDER_LABELS[provider] ?? provider;
}
