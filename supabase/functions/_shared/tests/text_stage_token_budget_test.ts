import { assert, assertEquals, assertRejects } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import "../stages/definitions/index.ts";
import { StageRegistry } from "../execution/StageRegistry.ts";
import { ExecutionEngine, assertAnswerWithinBudget, stageMaxTokens } from "../execution/ExecutionEngine.ts";
import { OpenRouterProvider, retryMaxTokensFor400 } from "../providers/OpenRouterProvider.ts";
import { OpenCodeProvider } from "../providers/OpenCodeProvider.ts";
import { ARTICLE_STAGE } from "../stages/definitions/blog_article.ts";
import { DEFAULT_FREE_TEXT_MODEL, DEFAULT_TEXT_STAGE_MAX_TOKENS } from "../default-models.ts";
import type { ExecutionContext, PipelineType } from "../execution/types.ts";

// Reasoning models (deepseek-v4.1-flash, qwen3, o-series) spend max_tokens on
// thinking before they answer. When the budget runs out first, the reply is ""
// with finish_reason "length" (carousel job e9b10d7b, 2026-10-02: outputTokens
// == 3500 twice).

type Reply = { status?: number; body: unknown };

/** Replace fetch with a queue of replies; record each request body. */
async function withFetch(replies: Reply[], run: (bodies: any[]) => Promise<void>) {
  const original = globalThis.fetch;
  const bodies: any[] = [];
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body ?? "{}")));
    const next = replies.shift();
    if (!next) throw new Error("no more stub replies");
    const text = typeof next.body === "string" ? next.body : JSON.stringify(next.body);
    return Promise.resolve(new Response(text, { status: next.status ?? 200 }));
  }) as typeof fetch;
  try {
    await run(bodies);
  } finally {
    globalThis.fetch = original;
  }
}

const completion = (content: string, finish_reason: string, completion_tokens = 50) => ({
  body: {
    id: "gen-1",
    model: "deepseek/deepseek-v4.1-flash",
    choices: [{ message: { role: "assistant", content }, finish_reason }],
    usage: { prompt_tokens: 100, completion_tokens, total_tokens: 100 + completion_tokens },
  },
});

// ---------- budgets ----------

Deno.test("every text stage a blueprint's model can land on leaves room for a reasoning model", () => {
  const exposed: string[] = [];
  for (const pipeline of StageRegistry.getPipelines()) {
    for (const stage of StageRegistry.getAll(pipeline as PipelineType)) {
      // A stage on the placeholder model runs on the blueprint's model (pickStageTextModel).
      if (stage.type !== "text" || stage.providerConfig.model !== DEFAULT_FREE_TEXT_MODEL) continue;
      exposed.push(`${pipeline}:${stage.id}`);
      assert(
        stageMaxTokens(stage) >= DEFAULT_TEXT_STAGE_MAX_TOKENS,
        `${pipeline}:${stage.id} caps max_tokens at ${stageMaxTokens(stage)}`,
      );
    }
  }
  assert(exposed.includes("video:post_caption"), exposed.join(", "));
  assert(exposed.includes("blog_article:outline"), exposed.join(", "));
});

Deno.test("a stage without its own cap still sends a bounded max_tokens", () => {
  assertEquals(stageMaxTokens({ providerConfig: {} } as any), DEFAULT_TEXT_STAGE_MAX_TOKENS);
  assertEquals(stageMaxTokens({ providerConfig: { maxTokens: 16000 } } as any), 16000);
});

// ---------- the empty-answer guard ----------

Deno.test("assertAnswerWithinBudget - empty + length names the budget, anything else passes", () => {
  let err: Error | null = null;
  try {
    assertAnswerWithinBudget({ content: "  ", finishReason: "length" }, "Stage outline", 8192);
  } catch (e) {
    err = e as Error;
  }
  assert(err, "should throw");
  assert(err!.message.startsWith("Stage outline: the model used its whole 8192-token budget before answering"), err!.message);

  // Truncated but non-empty: the transform decides. Empty for another reason: not a budget problem.
  assertAnswerWithinBudget({ content: '{"a":', finishReason: "length" }, "x", 8192);
  assertAnswerWithinBudget({ content: "", finishReason: "stop" }, "x", 8192);
  assertAnswerWithinBudget({ content: "Done.", finishReason: "stop" }, "x", 8192);
});

// ---------- providers surface finish_reason ----------

Deno.test("OpenRouterProvider returns finish_reason", async () => {
  await withFetch([completion("", "length", 8192)], async () => {
    const res = await new OpenRouterProvider("k", { referer: "t" }).execute({
      prompt: "p", model: "deepseek/deepseek-v4.1-flash", config: { maxTokens: 8192 },
    });
    assertEquals(res.content, "");
    assertEquals(res.finishReason, "length");
    assertEquals(res.usage?.outputTokens, 8192);
  });
});

Deno.test("OpenCodeProvider returns finish_reason", async () => {
  await withFetch([completion("Hi there.", "stop")], async () => {
    const res = await new OpenCodeProvider("k").execute({
      prompt: "p", model: "deepseek-v4.1-flash", config: { maxTokens: 8192 },
    });
    assertEquals(res.finishReason, "stop");
  });
});

// ---------- a cap above the model's output ceiling ----------

Deno.test("retryMaxTokensFor400 - reads the ceiling, or says drop the cap, or ignores other 400s", () => {
  assertEquals(retryMaxTokensFor400('{"error":{"message":"max_tokens is too large: 8192. This model supports at most 4096 completion tokens"}}'), 4096);
  assertEquals(retryMaxTokensFor400('{"error":{"message":"invalid max_tokens"}}'), undefined);
  assertEquals(retryMaxTokensFor400('{"error":{"message":"messages: field required"}}'), null);
});

Deno.test("OpenRouterProvider retries once at the ceiling the 400 reports", async () => {
  const rejected = { status: 400, body: { error: { message: "max_tokens is too large: 8192. This model supports at most 4096 completion tokens" } } };
  await withFetch([rejected, completion("Answer.", "stop")], async (bodies) => {
    const res = await new OpenRouterProvider("k", { referer: "t" }).execute({
      prompt: "p", model: "openai/gpt-4-turbo", config: { maxTokens: 8192 },
    });
    assertEquals(res.content, "Answer.");
    assertEquals(bodies.map((b) => b.max_tokens), [8192, 4096]);
  });
});

// ---------- engine ----------

function engineWithKey(): ExecutionEngine {
  const engine = new ExecutionEngine({}, "https://example.supabase.co");
  // Skip AES decryption of org keys; the stubbed fetch never checks the key.
  (engine as any).decryptApiKeys = () => Promise.resolve({ openrouter: "k" });
  return engine;
}

const REASONING_BLUEPRINT = { model_config: { text_llm: { model_id: "deepseek/deepseek-v4.1-flash" } } };

Deno.test("engine - an empty answer at the token limit fails with the budget, not an empty caption", async () => {
  const output = { id: "out-1", pipeline: "video", generation_params: {}, stage_data: {} };
  await withFetch([completion("", "length", 8192)], async (bodies) => {
    const err = await assertRejects(
      () => engineWithKey().executeStage(output, "post_caption", REASONING_BLUEPRINT, []),
      Error,
    );
    assert(err.message.startsWith("Stage post_caption: the model used its whole 8192-token budget"), err.message);
    // The blueprint's reasoning model got the raised budget (was 600).
    assertEquals(bodies[0].model, "deepseek/deepseek-v4.1-flash");
    assertEquals(bodies[0].max_tokens, 8192);
  });
});

Deno.test("engine - a cut-off JSON reply says it hit the budget when the transform fails", async () => {
  const output = { id: "out-1", pipeline: "video", generation_params: {}, stage_data: {} };
  await withFetch([completion('{"title": "Half an outl', "length", 8192)], async () => {
    const err = await assertRejects(
      () => engineWithKey().executeStage(output, "outline", REASONING_BLUEPRINT, []),
      Error,
    );
    assert(err.message.includes("hit its token budget and was cut off"), err.message);
  });
});

Deno.test("engine - executeTextStage passes finish_reason through for custom handlers", async () => {
  await withFetch([completion("A caption.", "stop")], async () => {
    const ctx = {
      pipeline: "video",
      apiKeys: { openrouter: "k" },
      modelConfig: { textLlm: { modelId: "deepseek/deepseek-v4.1-flash" } },
      previousStageOutputs: {},
    } as unknown as ExecutionContext;
    const stage = StageRegistry.get("video", "post_caption")!;
    const result = await engineWithKey().executeTextStage(ctx, stage, { system: "s", user: "u" });
    assertEquals(result.text, "A caption.");
    assertEquals(result.finishReason, "stop");
  });
});

Deno.test("engine - per-section article: sections get the full budget, and an empty one names the section", async () => {
  const sections = ["Introduction", "Why", "How", "Proof", "Pitfalls", "Conclusion"].map((heading) => ({ heading, key_points: ["x"] }));
  const ctx = {
    pipeline: "blog_article",
    ideaContext: "Topic",
    apiKeys: { openrouter: "k" },
    modelConfig: { textLlm: { modelId: "deepseek/deepseek-v4.1-flash" } },
    previousStageOutputs: { outline: { title: "T", sections } },
  } as unknown as ExecutionContext;
  await withFetch([completion("## Introduction\n\nText.", "stop"), completion("", "length", 8192)], async (bodies) => {
    const err = await assertRejects(() => engineWithKey().executeTextStage(ctx, ARTICLE_STAGE), Error);
    assert(err.message.startsWith('Article section "Why": the model used its whole 8192-token budget'), err.message);
    assertEquals(bodies.map((b) => b.max_tokens), [8192, 8192]);
  });
});
