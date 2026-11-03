// Run: deno test supabase/functions/_shared/image-references_test.ts
import { assert, assertEquals, assertRejects, assertThrows } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import {
  cleanStyleDescription,
  buildLabeledReferenceContent,
  buildReferenceParts,
  hasRoleReferences,
  referencesAsText,
  referencesBriefForPromptWriter,
  referenceReminder,
  resolveRoleReferences,
  resolveRequiredReferenceImages,
  rotateReferences,
  rotatesReferences,
  tablesNeededByReferences,
  withReferenceRequirements,
} from "./image-references.ts";

const px = (n: number) => `data:image/png;base64,${btoa(String(n))}`;
const lib = {
  product: { name: "Autopilot box", images: [px(1), px(2), px(3)] },
  character: [{ name: "Cedric", reference_images: [px(4), px(5)] }],
};

Deno.test("role mode is on only when image_references is an array", () => {
  assert(!hasRoleReferences({}));
  assert(!hasRoleReferences(null));
  assert(hasRoleReferences({ image_references: [] }));
});

Deno.test("'run' references resolve from the run's product/person, capped at 2 each, ordered product > person > style", () => {
  const refs = resolveRoleReferences({
    image_references: [
      { role: "style", source: "upload", images: [px(9)] },
      { role: "person", source: "run" },
      { role: "product", source: "run" },
    ],
  }, lib);
  assertEquals(refs.map((r) => r.role), ["product", "person", "style"]);
  assertEquals(refs[0].label, "Autopilot box");
  assertEquals(refs[0].urls, [px(1), px(2)]);
  assertEquals(refs[1].label, "Cedric");
  assertEquals(refs[2].label, "style reference");
});

Deno.test("explicit images win over the run's element; duplicates and empty groups are dropped", () => {
  const refs = resolveRoleReferences({
    image_references: [
      { role: "product", source: "library", images: [px(7)], label: "Blue mug" },
      { role: "product", source: "run" },
      { role: "person", source: "run" },
    ],
  }, { product: { images: [px(7)] } });
  assertEquals(refs.length, 1);
  assertEquals(refs[0].label, "Blue mug");
});

Deno.test("total cap is 6", () => {
  const refs = resolveRoleReferences({
    image_references: [
      { role: "product", source: "upload", images: [px(1), px(2), px(3)] },
      { role: "product", source: "upload", images: [px(11), px(12)] },
      { role: "person", source: "upload", images: [px(4), px(5), px(6)] },
      { role: "style", source: "upload", images: [px(7), px(8), px(9)] },
    ],
  }, {});
  assertEquals(refs.flatMap((r) => r.urls).length, 6);
});

Deno.test("text and labelled content number images in order", async () => {
  const refs = resolveRoleReferences({ image_references: [{ role: "product", source: "run" }, { role: "style", source: "upload", images: [px(9)] }] }, lib);
  const text = referencesAsText(refs);
  assert(text.includes("Reference images 1-2 (PRODUCT: Autopilot box)"));
  assert(text.includes("Reference image 3 (STYLE: style reference)"));
  const { content, imageCount } = await buildLabeledReferenceContent(refs, "A desk scene");
  assertEquals(imageCount, 3);
  const parts = content as Array<{ type: string; text?: string }>;
  assertEquals(parts.map((p) => p.type), ["text", "image_url", "image_url", "text", "image_url", "text"]);
  assert(parts[5].text!.includes("A desk scene"));
  // A style reference closes the request with a reminder that its look wins.
  assert(parts[5].text!.trimEnd().endsWith("the reference wins."));
  assert(referencesBriefForPromptWriter(refs).includes('"Autopilot box" must appear'));
});

Deno.test("style reference: described look reaches the writer and the image request", async () => {
  const refs = resolveRoleReferences({ image_references: [{ role: "style", source: "upload", images: [px(7)] }] }, lib);
  const look = "Bright photo thumbnail, person cut out on the left, huge bold white headline with a blue highlight box.";
  const brief = referencesBriefForPromptWriter(refs, look);
  assert(brief.includes(look));
  assert(brief.includes("Do not invent a different style"));
  // Without a description the writer is told to leave style out entirely.
  assert(referencesBriefForPromptWriter(refs).includes("do not name a style"));
  const { content } = await buildLabeledReferenceContent(refs, "A founder at a desk", look);
  const last = (content as Array<{ text?: string }>).at(-1)!.text!;
  assert(last.includes("A founder at a desk"));
  assert(last.includes(`The reference's look: ${look}`));
  assert(referencesAsText(refs, look).includes("the reference wins"));
});

Deno.test("writer with the pictures attached: told to put the reference's look into words", async () => {
  const refs = resolveRoleReferences({ image_references: [{ role: "product", source: "run" }, { role: "style", source: "upload", images: [px(7)] }] }, lib);
  const brief = referencesBriefForPromptWriter(refs, "", { imagesAttached: true });
  assert(brief.startsWith("The reference images attached above"));
  assert(brief.includes("The STYLE reference is attached"));
  assert(brief.includes("put that look into words"));
  assert(brief.includes('"Autopilot box" (its photos are attached)'));
  // Same labelled parts the image model gets, without the image model's closing line.
  const { parts, imageCount } = await buildReferenceParts(refs);
  assertEquals(imageCount, 3);
  assertEquals(parts.map((p) => p.type), ["text", "image_url", "image_url", "text", "image_url"]);
});

Deno.test("recreate + person = face swap: base image first, person told to replace the base's person", async () => {
  const refs = resolveRoleReferences({
    image_references: [
      { role: "person", source: "upload", images: [px(5)], label: "Cedric" },
      { role: "remake", source: "upload", images: [px(6), px(8)], label: "thumbnail" },
    ],
  }, lib);
  // Base image first (the canvas), capped at one picture.
  assertEquals(refs.map((r) => r.role), ["remake", "person"]);
  assertEquals(refs[0].urls.length, 1);
  const text = referencesAsText(refs);
  assert(text.includes("Reference image 1 (BASE IMAGE: thumbnail): Recreate this image"));
  assert(text.includes("Reference image 2 (PERSON: Cedric): Put this person in place of the person in the BASE image"));
  assert(text.includes("RESULT: the BASE image with only the listed changes"));
  assert(text.includes("not the person from the base image"));
  const brief = referencesBriefForPromptWriter(refs, "", { imagesAttached: true });
  assert(brief.includes("replaces the person in the base image"));
});

Deno.test("no style reference → no reminder", async () => {
  const refs = resolveRoleReferences({ image_references: [{ role: "product", source: "run" }] }, lib);
  const { content } = await buildLabeledReferenceContent(refs, "A desk scene");
  assert((content as Array<{ text?: string }>).at(-1)!.text!.endsWith("A desk scene"));
  assert(!referencesAsText(refs).includes("STYLE:"));
});

Deno.test("no resolvable images → plain prompt", async () => {
  const { content, imageCount } = await buildLabeledReferenceContent([], "P");
  assertEquals(content, "P");
  assertEquals(imageCount, 0);
});

Deno.test("person is mandatory after infographic instructions in both image request formats", async () => {
  const refs = resolveRoleReferences({ image_references: [{ role: "person", source: "upload", images: [px(1)], label: "Cedric" }] }, {});
  const template = "Make the numbered process the hero. No extra panels. Only text and diagrams.";
  const plan = withReferenceRequirements(template, refs);
  const imageApiPrompt = withReferenceRequirements(`${referencesAsText(refs)}\n\n${plan}`, refs);
  assert(imageApiPrompt.indexOf("REQUIRED PERSON", imageApiPrompt.indexOf(template)) > imageApiPrompt.indexOf(template));
  assert(imageApiPrompt.endsWith(referenceReminder(refs)));
  assertEquals(withReferenceRequirements(plan, refs), plan);
  const { content, imageCount } = await buildLabeledReferenceContent(refs, template);
  assertEquals(imageCount, 1);
  const parts = content as Array<{ text?: string }>;
  assert(parts[0].text!.includes("MUST appear visibly"));
  assert(parts.at(-1)!.text!.endsWith(referenceReminder(refs)));
  assert(referencesBriefForPromptWriter(refs).includes("even for an infographic"));
});

Deno.test("person presence and style precedence are both required", () => {
  const refs = resolveRoleReferences({ image_references: [
    { role: "person", source: "upload", images: [px(1)] },
    { role: "style", source: "upload", images: [px(2)] },
  ] }, {});
  const prompt = withReferenceRequirements("A terminal infographic", refs);
  assert(prompt.includes("REQUIRED PERSON"));
  assert(prompt.endsWith("the reference wins."));
  assertEquals(withReferenceRequirements("Plain prompt", []), "Plain prompt");
});

Deno.test("final generation rejects a selected person without images; optional planning still resolves other groups", () => {
  const config = { image_references: [
    { role: "style", source: "upload", images: [px(1)] },
    { role: "person", source: "run", label: "Cedric" },
  ] };
  assertEquals(resolveRoleReferences(config, {}).length, 1);
  assertThrows(() => resolveRoleReferences(config, {}, { required: true }), Error, 'PERSON reference "Cedric" has no images');
});

Deno.test("strict resolution cannot drop a selected person through cross-role deduplication or caps", () => {
  const duplicate = { image_references: [
    { role: "remake", source: "upload", images: [px(1)] },
    { role: "person", source: "upload", images: [px(1)], label: "Cedric" },
  ] };
  assertThrows(() => resolveRoleReferences(duplicate, {}, { required: true }), Error, 'PERSON reference "Cedric" could not be included');
  const capped = { image_references: [
    { role: "person", source: "upload", images: [px(1), px(2)], label: "First person" },
    { role: "person", source: "upload", images: [px(3)], label: "Second person" },
  ] };
  assertThrows(() => resolveRoleReferences(capped, {}, { required: true }), Error, 'PERSON reference "Second person" could not be included');
});

Deno.test("missing person download cannot silently fall back to a surviving style reference", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("unavailable", { status: 503 }));
  try {
    const refs = [
      { role: "style" as const, label: "Terminal", urls: [px(1)] },
      { role: "person" as const, label: "Cedric", urls: ["https://example.test/missing.jpg"] },
    ];
    // Image API uses the strict resolver; multimodal image generation uses the same guard.
    await assertRejects(() => resolveRequiredReferenceImages(refs), Error, 'PERSON reference "Cedric" could not be loaded');
    await assertRejects(() => buildLabeledReferenceContent(refs, "A process infographic"), Error, 'PERSON reference "Cedric" could not be loaded');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("one available photo per selected group is sufficient and numbering matches the sent images", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = () => Promise.resolve(new Response("unavailable", { status: 404 }));
  try {
    const refs = [
      { role: "person" as const, label: "Cedric", urls: ["https://example.test/missing.jpg", px(1)] },
      { role: "style" as const, label: "Terminal", urls: [px(2)] },
    ];
    const resolved = await resolveRequiredReferenceImages(refs);
    assertEquals(resolved[0].urls, [px(1)]);
    const { content, imageCount } = await buildLabeledReferenceContent(refs, "An infographic");
    assertEquals(imageCount, 2);
    const parts = content as Array<{ text?: string }>;
    assert(parts[0].text!.includes("Reference image 1 (PERSON: Cedric)"));
    assert(parts[2].text!.includes("Reference image 2 (STYLE: Terminal)"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

Deno.test("tables needed only for 'run' refs without explicit images", () => {
  assertEquals(tablesNeededByReferences({ image_references: [{ role: "person", source: "run" }, { role: "product", source: "library", images: [px(1)] }, { role: "style", source: "run" }] }), ["library_characters"]);
  assertEquals(tablesNeededByReferences({}), []);
});

Deno.test("style descriptions come back as one plain paragraph", () => {
  assertEquals(
    cleanStyleDescription("# Visual Style Description\n\nThis is a **collage**.\nBold  red type."),
    "This is a collage. Bold red type.",
  );
  assertEquals(cleanStyleDescription("A flat illustration."), "A flat illustration.");
});

// Emma's blueprint (job 60171e75): two Person references, one photo each.
const emma = (modes?: Record<string, string>) => ({
  ...(modes ? { reference_modes: modes } : {}),
  image_references: [
    { id: "a", role: "person", source: "library", images: ["https://x/profile.png"], label: "Emma Collins" },
    { id: "b", role: "person", source: "library", images: ["https://x/lifestyle2.png"], label: "Emma Collins" },
    { id: "p", role: "product", source: "upload", images: ["https://x/box1.png", "https://x/box2.png"], label: "Box" },
  ],
});
const personUrls = (mc: any) => resolveRoleReferences(mc, {}).filter((r) => r.role === "person").flatMap((r) => r.urls);

Deno.test("combine (the default) leaves every photo in", () => {
  const mc = emma();
  assertEquals(rotatesReferences(mc), false);
  const out = rotateReferences(mc, {}, []);
  assertEquals(out.picks, {});
  assert(out.modelConfig === mc);
  assertEquals(personUrls(out.modelConfig), ["https://x/profile.png", "https://x/lifestyle2.png"]);
});

Deno.test("rotate gives each piece one photo, least recently used first", () => {
  const mc = emma({ person: "rotate" });
  assertEquals(rotatesReferences(mc), true);
  const first = rotateReferences(mc, {}, []);
  assertEquals(first.picks, { person: "https://x/profile.png" });
  assertEquals(personUrls(first.modelConfig), ["https://x/profile.png"]);
  // Other roles are untouched, and so is the blueprint's own config.
  assertEquals(resolveRoleReferences(first.modelConfig, {}).find((r) => r.role === "product")?.urls, ["https://x/box1.png", "https://x/box2.png"]);
  assertEquals(personUrls(mc), ["https://x/profile.png", "https://x/lifestyle2.png"]);

  assertEquals(rotateReferences(mc, {}, [first.picks]).picks, { person: "https://x/lifestyle2.png" });
  // Pieces with no picks (older, or another role) don't break the order.
  assertEquals(rotateReferences(mc, {}, [{}, { person: "https://x/lifestyle2.png" }, {}, { person: "https://x/profile.png" }]).picks, { person: "https://x/profile.png" });
  // A photo removed from the blueprint no longer counts.
  assertEquals(rotateReferences(mc, {}, [{ person: "https://x/gone.png" }, { person: "https://x/profile.png" }]).picks, { person: "https://x/lifestyle2.png" });
});

Deno.test("rotate works within one reference and across roles independently", () => {
  const mc = emma({ person: "rotate", product: "rotate" });
  const out = rotateReferences(mc, {}, [{ person: "https://x/profile.png", product: "https://x/box1.png" }]);
  assertEquals(out.picks, { product: "https://x/box2.png", person: "https://x/lifestyle2.png" });
  assertEquals(resolveRoleReferences(out.modelConfig, {}).map((r) => [r.role, r.urls.length]), [["product", 1], ["person", 1]]);
});

Deno.test("rotate resolves the run's person, and leaves a single photo alone", () => {
  const run = { reference_modes: { person: "rotate" }, image_references: [{ id: "r", role: "person", source: "run" }] };
  const out = rotateReferences(run, lib, [{ person: px(4) }]);
  assertEquals(out.picks, { person: px(5) });
  assertEquals(resolveRoleReferences(out.modelConfig, lib, { required: true }), [{ role: "person", label: "Cedric", urls: [px(5)] }]);
  const single = { reference_modes: { person: "rotate" }, image_references: [{ id: "a", role: "person", source: "upload", images: ["https://x/a.png"] }] };
  assertEquals(rotateReferences(single, {}, []).picks, {});
});

Deno.test("base images always take turns; style never does", () => {
  const mc = {
    image_references: [
      { id: "r1", role: "remake", source: "upload", images: ["https://x/base1.png"] },
      { id: "r2", role: "remake", source: "upload", images: ["https://x/base2.png"] },
      { id: "s", role: "style", source: "upload", images: ["https://x/s1.png", "https://x/s2.png"] },
    ],
  };
  assertEquals(rotatesReferences(mc), true);
  const out = rotateReferences(mc, {}, [{ remake: "https://x/base1.png" }]);
  assertEquals(out.picks, { remake: "https://x/base2.png" });
  assertEquals(resolveRoleReferences(out.modelConfig, {}).map((r) => [r.role, r.urls]), [["remake", ["https://x/base2.png"]], ["style", ["https://x/s1.png", "https://x/s2.png"]]]);
});
