// Run: deno test supabase/functions/_shared/platform-fit_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { mediaKindForOutput, mediaKindForPipeline, platformAccepts, platformNeeds, skipReason } from "./platform-fit.ts";

Deno.test("pipelines map to what their pieces carry", () => {
  assertEquals(mediaKindForPipeline("social_media_post"), "image");
  assertEquals(mediaKindForPipeline("social_media_post", { skipImage: true }), "text");
  assertEquals(mediaKindForPipeline("instagram_carousel"), "image");
  assertEquals(mediaKindForPipeline("storyboard_video_longform"), "video");
  assertEquals(mediaKindForPipeline("rich_article"), "article");
  assertEquals(mediaKindForPipeline(undefined), "text");
});

Deno.test("a finished social post is judged by what it holds", () => {
  assertEquals(mediaKindForOutput({ pipeline: "social_media_post", stage_data: { image: { url: "x" } } }), "image");
  assertEquals(mediaKindForOutput({ pipeline: "social_media_post", stage_data: { image: { media_type: "video", video_url: "v" } } }), "video");
  assertEquals(mediaKindForOutput({ pipeline: "social_media_post", stage_data: { caption: { content: "hi" } } }), "text");
  assertEquals(mediaKindForOutput({ pipeline: "ugc_video", stage_data: {} }), "video");
});

Deno.test("platforms that need media turn away the wrong kind", () => {
  assertEquals(platformAccepts("instagram", "text"), false);
  assertEquals(platformAccepts("Instagram", "image"), true);
  assertEquals(platformAccepts("tiktok", "image"), true);
  assertEquals(platformAccepts("tiktok", "text"), false);
  assertEquals(platformAccepts("tiktok", "video"), true);
  assertEquals(platformAccepts("linkedin", "text"), true);
  assertEquals(platformAccepts("google", "text"), true);
  assertEquals(platformAccepts(undefined, "text"), true);
  assertEquals(platformNeeds("tiktok"), "TikTok needs a picture or video");
  assertEquals(platformAccepts("youtube", "image"), true);
  assertEquals(platformNeeds("youtube"), null);
  assertEquals(platformNeeds("linkedin"), null);
});

Deno.test("articles go to WordPress, and WordPress only takes articles", () => {
  assertEquals(skipReason("wordpress", "article"), null);
  assertEquals(skipReason("wordpress", "image"), "WordPress sites only take articles");
  assertEquals(skipReason("linkedin", "article"), "Articles only publish to a WordPress site");
  assertEquals(skipReason("instagram", "text"), "Instagram needs a picture or video");
  assertEquals(skipReason("linkedin", "text"), null);
  assertEquals(mediaKindForOutput({ pipeline: "rich_article", stage_data: {} }), "article");
});
