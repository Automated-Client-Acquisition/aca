// Run: deno test supabase/functions/_shared/image-looks_test.ts
import { assert, assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { applyLook, getImageLooks, pickLooks, type ImageLook } from "./image-looks.ts";

const quote: ImageLook = { id: "q", label: "Quote card", kind: "preset", preset: "quote_card", direction: "Big type, lots of space." };
const photo: ImageLook = { id: "p", label: "Office photo", kind: "reference", images: ["https://x/1.png", "https://x/2.png", "https://x/3.png"], description: "Natural light." };
const dark: ImageLook = { id: "d", label: "Dark 3D", kind: "reference", images: ["https://x/4.png"] };
const mc = (extra: Record<string, unknown> = {}) => ({ image_looks: [quote, photo, dark], ...extra });

Deno.test("unusable looks are ignored", () => {
  const looks = getImageLooks({
    image_looks: [quote, { id: "e", label: "Empty", kind: "preset", direction: " " }, { id: "n", label: "No images", kind: "reference", images: [] }, null],
  });
  assertEquals(looks.map((l) => l.id), ["q"]);
  assertEquals(getImageLooks({}), []);
  assertEquals(pickLooks({}, 3), []);
});

Deno.test("rotation starts with never-used looks, in saved order", () => {
  assertEquals(pickLooks(mc(), 1, []).map((l) => l.id), ["q"]);
  assertEquals(pickLooks(mc(), 1, ["q"]).map((l) => l.id), ["p"]);
  assertEquals(pickLooks(mc(), 1, ["p", "q"]).map((l) => l.id), ["d"]);
});

Deno.test("rotation takes the look unused the longest", () => {
  // Most recent first: d, then q, then p long ago.
  assertEquals(pickLooks(mc(), 1, ["d", "q", "d", "q", "p"]).map((l) => l.id), ["p"]);
  // Looks that were deleted from the set don't count.
  assertEquals(pickLooks(mc(), 1, ["gone", "q", "p", "d"]).map((l) => l.id), ["d"]);
});

Deno.test("several pieces in one job get different looks", () => {
  assertEquals(pickLooks(mc(), 4, ["q"]).map((l) => l.id), ["p", "d", "q", "p"]);
});

Deno.test("fixed mode and a forced look", () => {
  assertEquals(pickLooks(mc({ look_mode: "fixed", look_fixed_id: "d" }), 2, []).map((l) => l.id), ["d", "d"]);
  assertEquals(pickLooks(mc({ look_mode: "fixed" }), 1, []).map((l) => l.id), ["q"]);
  assertEquals(pickLooks(mc(), 2, [], "p").map((l) => l.id), ["p", "p"]);
  // An unknown forced id falls back to rotation.
  assertEquals(pickLooks(mc(), 1, ["q"], "gone").map((l) => l.id), ["p"]);
});

Deno.test("a preset look sets the style direction and drops style references", () => {
  const out = applyLook(
    {
      image_style: "illustration",
      image_references: [
        { id: "1", role: "style", source: "upload", images: ["s"] },
        { id: "2", role: "product", source: "run" },
      ],
    },
    quote,
  ) as any;
  assertEquals(out.image_style, "quote_card");
  assertEquals(out.image_style_direction, "Big type, lots of space.");
  assertEquals(out.image_references.map((r: any) => r.role), ["product"]);
});

Deno.test("a reference look becomes the only style reference, capped at 2 images", () => {
  const out = applyLook(
    {
      image_style: "quote_card",
      image_style_direction: "Big type",
      image_references: [
        { id: "1", role: "style", source: "upload", images: ["s"] },
        { id: "2", role: "person", source: "run" },
      ],
    },
    photo,
  ) as any;
  assertEquals(out.image_style, "auto");
  assert(!("image_style_direction" in out));
  assertEquals(out.image_references.map((r: any) => r.role), ["person", "style"]);
  assertEquals(out.image_references[1].images, ["https://x/1.png", "https://x/2.png"]);
  assertEquals(out.image_references[1].label, "Office photo");
  assertEquals(out.look_style_description, "Natural light.");
});

Deno.test("a reference look turns on role mode when the blueprint had none", () => {
  const out = applyLook({}, dark) as any;
  assertEquals(out.image_references.length, 1);
  assert(!("look_style_description" in out));
});
