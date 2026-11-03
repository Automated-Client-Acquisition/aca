import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { resolveOutputConfig } from "../blueprint-output-config.ts";

const carouselBlueprint = {
  carousel_template: "noir",
  carousel_slide_count: 7,
  carousel_cta_text: "Comment GUIDE",
  carousel_handle: "@acme",
  output_config_defaults: { aspectRatio: "square" },
};

Deno.test("autopilot with no output_config inherits the blueprint's Look settings", () => {
  assertEquals(resolveOutputConfig("instagram_carousel", carouselBlueprint, undefined), {
    aspectRatio: "square",
    carouselTemplate: "noir",
    slideCount: 7,
    ctaButtonText: "Comment GUIDE",
    authorHandle: "@acme",
  });
});

Deno.test("blueprint with no shape set defaults to portrait 4:5", () => {
  const out = resolveOutputConfig("instagram_carousel", {}, undefined);
  assertEquals(out?.aspectRatio, "portrait");
  assertEquals(out?.carouselTemplate, "creator");
  assertEquals(out?.slideCount, 5);
});

Deno.test("caller overrides win, empty values do not", () => {
  const out = resolveOutputConfig("instagram_carousel", carouselBlueprint, {
    aspectRatio: "4:5",
    slideCount: 6,
    carouselTemplate: "",
    ctaButtonText: null,
  });
  assertEquals(out?.aspectRatio, "portrait");
  assertEquals(out?.slideCount, 6);
  assertEquals(out?.carouselTemplate, "noir");
  assertEquals(out?.ctaButtonText, "Comment GUIDE");
});

Deno.test("a non-carousel shape (old 'landscape' default) falls back to the blueprint shape", () => {
  assertEquals(resolveOutputConfig("instagram_carousel", carouselBlueprint, { aspectRatio: "landscape" })?.aspectRatio, "square");
  assertEquals(resolveOutputConfig("instagram_carousel", {}, { aspectRatio: "9:16" })?.aspectRatio, "portrait");
});

Deno.test("AI carousels default to portrait and pass explicit shapes through", () => {
  assertEquals(resolveOutputConfig("instagram_carousel_ai", {}, undefined)?.aspectRatio, "portrait");
  assertEquals(resolveOutputConfig("instagram_carousel_ai", {}, { aspectRatio: "landscape" })?.aspectRatio, "landscape");
});

Deno.test("other pipelines keep the caller's output_config untouched", () => {
  const explicit = { aspectRatio: "landscape" };
  assertEquals(resolveOutputConfig("social_media_post", carouselBlueprint, explicit), explicit);
  assertEquals(resolveOutputConfig("social_media_post", carouselBlueprint, undefined), undefined);
});
