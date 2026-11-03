// ============================================================================
// openrouter-video-webhook
//
// OpenRouter calls this when a video job reaches a terminal state, at the
// callback_url set by submitVideoGeneration:
//   .../openrouter-video-webhook?g=<video_generations.id>&t=<per-row token>
//
// Auth: deployed with verify_jwt = false (config.toml). OpenRouter's
// X-OpenRouter-Signature uses each org's own workspace secret, which we don't
// hold, so the token in the URL is the proof: its sha256 must match the row's
// callback_token_hash. The body is never trusted; finalize re-reads the job
// from OpenRouter with the org's key.
//
// Responds 200 at once and finalizes in the background (the download + upload
// can outlast OpenRouter's webhook timeout). Duplicate deliveries are harmless:
// finalize claims the row and skips terminal ones.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { finalizeVideoGeneration, sha256Hex, timingSafeEqualHex } from "../_shared/openrouter-video.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const url = new URL(req.url);
  const generationId = url.searchParams.get("g") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!UUID_RE.test(generationId) || !token) return json({ error: "missing callback token" }, 401);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: row } = await supabase
    .from("video_generations")
    .select("id, callback_token_hash")
    .eq("id", generationId)
    .maybeSingle();

  if (!row?.callback_token_hash || !timingSafeEqualHex(await sha256Hex(token), row.callback_token_hash)) {
    return json({ error: "invalid callback token" }, 401);
  }

  const idempotencyKey = req.headers.get("x-openrouter-idempotency-key");
  console.log(`[openrouter-video-webhook] generation=${generationId} delivery=${idempotencyKey ?? "-"}`);

  const work = finalizeVideoGeneration(supabase, generationId)
    .then((outcome) => console.log(`[openrouter-video-webhook] ${generationId} -> ${outcome}`))
    .catch((err) => console.error(`[openrouter-video-webhook] ${generationId} finalize error:`, err));

  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(work);
  } else {
    await work;
  }

  return json({ received: true });
});
