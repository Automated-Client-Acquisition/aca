// Run: deno test supabase/functions/_shared/ai-reply-drafter_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { fetchDrafterCompletion } from "./ai-reply-drafter.ts";
import { DEFAULT_FAST_TEXT_MODEL } from "./default-models.ts";

/** Stub fetch: answer each OpenRouter call from `reply(model)`, recording the models asked for. */
async function withStubbedFetch(
  reply: (model: string) => Response,
  run: () => Promise<void>,
): Promise<string[]> {
  const asked: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    const model = JSON.parse(String(init?.body)).model;
    asked.push(model);
    return Promise.resolve(reply(model));
  }) as typeof fetch;
  try {
    await run();
  } finally {
    globalThis.fetch = original;
  }
  return asked;
}

const ok = () => new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), { status: 200 });
const opts = { openRouterApiKey: "test-key" };

Deno.test("retired model (404 'No endpoints found for') falls back to the default", async () => {
  let served = "";
  let status = 0;
  const asked = await withStubbedFetch(
    (model) => model === "stealth/space-bunny-alpha"
      ? new Response('{"error":{"message":"No endpoints found for stealth/space-bunny-alpha.","code":404}}', { status: 404 })
      : ok(),
    async () => {
      const r = await fetchDrafterCompletion({ model: "stealth/space-bunny-alpha", messages: [] }, opts);
      served = r.model;
      status = r.response.status;
    },
  );
  assertEquals(asked, ["stealth/space-bunny-alpha", DEFAULT_FAST_TEXT_MODEL]);
  assertEquals(served, DEFAULT_FAST_TEXT_MODEL);
  assertEquals(status, 200);
});

Deno.test("a different 404 (no image-input endpoint) is not treated as retired", async () => {
  let r: { response: Response; model: string } | undefined;
  const asked = await withStubbedFetch(
    () => new Response('{"error":{"message":"No endpoints found that support image input"}}', { status: 404 }),
    async () => {
      r = await fetchDrafterCompletion({ model: "some/text-only-model", messages: [] }, opts);
    },
  );
  assertEquals(asked, ["some/text-only-model"]);
  assertEquals(r!.model, "some/text-only-model");
  // The caller still reads the original error body.
  assertEquals((await r!.response.text()).includes("image input"), true);
});

Deno.test("the default model failing is not retried on itself", async () => {
  const asked = await withStubbedFetch(
    () => new Response('{"error":{"message":"No endpoints found for x"}}', { status: 404 }),
    async () => {
      await fetchDrafterCompletion({ model: DEFAULT_FAST_TEXT_MODEL, messages: [] }, opts);
    },
  );
  assertEquals(asked, [DEFAULT_FAST_TEXT_MODEL]);
});
