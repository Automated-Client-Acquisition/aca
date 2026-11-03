// Run: deno test supabase/functions/_shared/invoke-error_test.ts
import { assertEquals } from "https://deno.land/std@0.168.0/testing/asserts.ts";
import { FunctionsHttpError } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { isRetryableStatus, readInvokeError } from "./invoke-error.ts";

const httpError = (status: number, body: string) =>
  new FunctionsHttpError(new Response(body, { status, headers: { "Content-Type": "application/json" } }));

Deno.test("surfaces the callee's error field instead of the generic non-2xx text", async () => {
  const err = httpError(500, JSON.stringify({ success: false, error: 'Tweet failed (402): credits depleted' }));
  assertEquals(err.message, "Edge Function returned a non-2xx status code");
  assertEquals(await readInvokeError(err), { message: "Tweet failed (402): credits depleted", status: 500 });
});

Deno.test("falls back through error_message, message, nested error.message, raw text", async () => {
  assertEquals((await readInvokeError(httpError(400, '{"error_message":"a"}'))).message, "a");
  assertEquals((await readInvokeError(httpError(400, '{"message":"b"}'))).message, "b");
  assertEquals((await readInvokeError(httpError(400, '{"error":{"message":"c"}}'))).message, "c");
  assertEquals((await readInvokeError(httpError(502, "Bad Gateway"))).message, "Bad Gateway");
});

Deno.test("keeps the generic message when there is no readable body", async () => {
  const empty = await readInvokeError(httpError(503, ""));
  assertEquals(empty, { message: "Edge Function returned a non-2xx status code", status: 503 });
  assertEquals(await readInvokeError(new Error("fetch failed")), { message: "fetch failed" });
  assertEquals(await readInvokeError(null), { message: "Unknown error" });
});

Deno.test("only 5xx, timeouts, rate limits and unknown statuses are retryable", () => {
  assertEquals([undefined, 500, 502, 408, 429].map(isRetryableStatus), [true, true, true, true, true]);
  assertEquals([400, 401, 402, 403, 404, 422].map(isRetryableStatus), [false, false, false, false, false, false]);
});
