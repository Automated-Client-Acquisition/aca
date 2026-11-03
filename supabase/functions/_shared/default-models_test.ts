import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { DEFAULT_FREE_TEXT_MODEL, pickStageTextModel } from "./default-models.ts";

Deno.test("the blueprint's model wins over the stage placeholder", () => {
  assertEquals(pickStageTextModel(DEFAULT_FREE_TEXT_MODEL, "anthropic/claude-sonnet-4.6"), "anthropic/claude-sonnet-4.6");
  assertEquals(pickStageTextModel(undefined, "deepseek/deepseek-v4.1-flash"), "deepseek/deepseek-v4.1-flash");
});

Deno.test("a stage pinned to a specific model keeps it", () => {
  assertEquals(pickStageTextModel("anthropic/claude-sonnet-4", "deepseek/deepseek-v4.1-flash"), "anthropic/claude-sonnet-4");
});

Deno.test("no blueprint model, or one the engine can't route (Ollama) → platform default", () => {
  assertEquals(pickStageTextModel(DEFAULT_FREE_TEXT_MODEL, null), DEFAULT_FREE_TEXT_MODEL);
  assertEquals(pickStageTextModel(DEFAULT_FREE_TEXT_MODEL, "ollama:llama3.3"), DEFAULT_FREE_TEXT_MODEL);
  assertEquals(pickStageTextModel(DEFAULT_FREE_TEXT_MODEL, "opencode:kimi-k2"), "opencode:kimi-k2");
});
