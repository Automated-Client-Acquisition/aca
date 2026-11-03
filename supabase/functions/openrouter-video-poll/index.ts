// ============================================================================
// openrouter-video-poll
//
// Fallback for lost or late OpenRouter webhooks. pg_cron (job
// 'openrouter-video-poll', every 2 min on odd minutes) calls this only when a
// video_generations row is pending/in_progress more than 3 min after submit.
// Each run finalizes up to BATCH of the oldest such rows, skipping any polled
// in the last 90s, and gives up on jobs older than 2h (finalize marks them
// expired).
//
// Auth: verify_jwt = false (config.toml); the cron sends x-cron-secret from
// Vault (cron_secret), compared to the CRON_SECRET function env, like the other
// ticks. Manual run: POST with the same header, optional { "generation_id" }.
//
// Replies 202 at once and works in the background: pg_net gives up after 5s,
// and a download + upload can take longer.
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { finalizeVideoGeneration } from "../_shared/openrouter-video.ts";

const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";
const BATCH = 12;
const CONCURRENCY = 4;
const TIME_BUDGET_MS = 120_000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

async function run(supabase: any, onlyId: string | null) {
  const started = Date.now();
  let ids: string[];

  if (onlyId) {
    ids = [onlyId];
  } else {
    const staleSubmit = new Date(Date.now() - 3 * 60_000).toISOString();
    const recentPoll = new Date(Date.now() - 90_000).toISOString();
    const { data, error } = await supabase
      .from("video_generations")
      .select("id")
      .in("status", ["pending", "in_progress"])
      .lt("submitted_at", staleSubmit)
      .or(`last_polled_at.is.null,last_polled_at.lt.${recentPoll}`)
      .order("submitted_at", { ascending: true })
      .limit(BATCH);
    if (error) {
      console.error("[openrouter-video-poll] select failed:", error.message);
      return;
    }
    ids = (data ?? []).map((r: { id: string }) => r.id);
  }

  const outcomes: Record<string, number> = {};
  let next = 0;
  const worker = async () => {
    while (next < ids.length && Date.now() - started < TIME_BUDGET_MS) {
      const id = ids[next++];
      try {
        const outcome = await finalizeVideoGeneration(supabase, id);
        outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      } catch (err) {
        outcomes.error = (outcomes.error ?? 0) + 1;
        console.error(`[openrouter-video-poll] ${id}:`, err);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  console.log(`[openrouter-video-poll] ${ids.length} rows in ${Date.now() - started}ms`, JSON.stringify(outcomes));
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  if (!CRON_SECRET || req.headers.get("x-cron-secret") !== CRON_SECRET) {
    return json({ error: "unauthorized" }, 401);
  }

  const body = await req.json().catch(() => ({}));
  const onlyId = typeof body?.generation_id === "string" ? body.generation_id : null;

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const work = run(supabase, onlyId).catch((err) => console.error("[openrouter-video-poll] run failed:", err));

  // deno-lint-ignore no-explicit-any
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) {
    edgeRuntime.waitUntil(work);
    return json({ accepted: true }, 202);
  }
  await work;
  return json({ done: true });
});
