
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { OUTPUT_TRANSFORMS } from "../execution/OutputTransformers.ts";

Deno.test("parseCarouselContent - handles legacy array output", () => {
    const legacyOutput = JSON.stringify([
        { slide_number: 1, prompt: "test" }
    ]);

    const result = OUTPUT_TRANSFORMS.parseCarouselContent(legacyOutput);

    assertEquals(result.slides.length, 1);
    assertEquals(result.slides[0].prompt, "test");
    assertEquals(result.visual_story_summary, "");
});

Deno.test("parseCarouselContent - handles new visual summary object", () => {
    const newOutput = JSON.stringify({
        visual_story_summary: "A consistent blue theme.",
        slides: [
            { slide_number: 1, prompt: "test" }
        ]
    });

    const result = OUTPUT_TRANSFORMS.parseCarouselContent(newOutput);

    assertEquals(result.slides.length, 1);
    assertEquals(result.slides[0].prompt, "test");
    assertEquals(result.visual_story_summary, "A consistent blue theme.");
});

Deno.test("parseScriptContent - handles legacy array output", () => {
    const legacyOutput = JSON.stringify([
        { scene: 1, narration: "test" }
    ]);

    const result = OUTPUT_TRANSFORMS.parseScriptContent(legacyOutput);

    assertEquals(result.scenes.length, 1);
    assertEquals(result.scenes[0].narration, "test");
    assertEquals(result.visual_story_summary, "");
});

Deno.test("parseScriptContent - handles new visual summary object", () => {
    const newOutput = JSON.stringify({
        visual_story_summary: "Dark moody atmosphere.",
        scenes: [
            { scene: 1, narration: "test" }
        ]
    });

    const result = OUTPUT_TRANSFORMS.parseScriptContent(newOutput);

    assertEquals(result.scenes.length, 1);
    assertEquals(result.scenes[0].narration, "test");
    assertEquals(result.visual_story_summary, "Dark moody atmosphere.");
});
