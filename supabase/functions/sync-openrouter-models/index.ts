import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";

const TEXT_LLM_CAPABILITIES = {
  roles: {
    main_prompt: { type: "array", required: true, transform: null, provider_key: "messages" },
    temperature: { type: "number", required: false, transform: null, provider_key: "temperature" },
    top_p: { type: "number", required: false, transform: null, provider_key: "top_p" },
    max_tokens: { type: "integer", required: false, transform: null, provider_key: "max_tokens" },
  },
  input_types: ["text"],
  output_types: ["text"],
  schema_version: "1.0",
  supports_pipelines: ["text-to-text"],
  parameter_constraints: {
    main_prompt: {},
    temperature: {},
    top_p: {},
    max_tokens: {},
  },
  estimated_cost_per_run: 0.05,
};

const IMAGE_MODEL_CAPABILITIES = {
  roles: {
    main_prompt: { type: "array", required: true, transform: null, provider_key: "messages" },
  },
  input_types: ["text"],
  output_types: ["image"],
  schema_version: "1.0",
  supports_pipelines: ["text-to-image"],
  parameter_constraints: { main_prompt: {} },
  estimated_cost_per_run: 0.05,
};

interface OpenRouterModel {
  id: string;
  name?: string;
  description?: string;
  pricing?: { prompt?: string; completion?: string };
  architecture?: { modality?: string; input_modalities?: string[]; output_modalities?: string[] };
  context_length?: number;
}

function classifyOutput(model: OpenRouterModel): "text" | "image" | "audio" | "unknown" {
  const out = model.architecture?.output_modalities ?? [];
  if (out.includes("image")) return "image";
  if (out.includes("audio")) return "audio";
  if (out.includes("text")) return "text";
  // Fallback: look at the id for image/audio markers
  const id = model.id.toLowerCase();
  if (id.includes("image") || id.includes("imagen") || id.includes("dall-e") || id.includes("flux")) return "image";
  if (id.includes("audio") || id.includes("tts") || id.includes("whisper")) return "audio";
  return "text";
}

function buildCapabilitiesFor(model: OpenRouterModel): Record<string, unknown> | null {
  const kind = classifyOutput(model);
  const now = new Date().toISOString();
  if (kind === "text") {
    return { ...TEXT_LLM_CAPABILITIES, normalized_at: now };
  }
  if (kind === "image") {
    return { ...IMAGE_MODEL_CAPABILITIES, normalized_at: now };
  }
  // Audio/unknown: leave null so the schema check picks defaults (text path tolerates this)
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  // Cron worker: its pg_cron job sends the service-role key; nothing else may
  // trigger it (the anon key is public).
  if (!isServiceRoleRequest(req)) return unauthorized(new AuthError("Forbidden", 403), corsHeaders);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  // Begin sync log row
  const { data: logRow, error: logErr } = await supabase
    .from("ai_model_sync_logs")
    .insert({ provider: "openrouter", status: "running" })
    .select("id")
    .single();
  if (logErr) {
    console.error("[sync-openrouter-models] Failed to create sync log:", logErr.message);
  }
  const logId = logRow?.id;

  let modelsFetched = 0;
  let modelsAdded = 0;
  let modelsUpdated = 0;
  let modelsDeactivated = 0;
  let status: "completed" | "failed" = "completed";
  let errorMessage: string | null = null;

  try {
    const res = await fetch(OPENROUTER_MODELS_URL, { method: "GET" });
    if (!res.ok) {
      throw new Error(`OpenRouter /models returned ${res.status}: ${await res.text()}`);
    }
    const body = await res.json();
    const list = (body?.data ?? []) as OpenRouterModel[];
    modelsFetched = list.length;
    if (modelsFetched === 0) {
      throw new Error("OpenRouter returned an empty model list — refusing to deactivate everything.");
    }

    const liveIds = new Set(list.map((m) => m.id));

    // Upsert each live model
    for (const m of list) {
      const caps = buildCapabilitiesFor(m);
      const displayName = m.name || m.id;
      const description = m.description ?? null;
      const ctxLen = typeof m.context_length === "number" ? m.context_length : null;

      const row = {
        provider: "openrouter",
        model_id: m.id,
        name: m.id,
        display_name: displayName,
        description,
        is_active: true,
        last_seen_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        normalized_capabilities: caps,
        capabilities: ctxLen ? { context_length: ctxLen } : {},
      };

      // Check if exists to know add-vs-update
      const { data: existing } = await supabase
        .from("ai_models")
        .select("id")
        .eq("provider", "openrouter")
        .eq("model_id", m.id)
        .maybeSingle();

      if (existing) {
        const { error: updErr } = await supabase
          .from("ai_models")
          .update(row)
          .eq("id", existing.id);
        if (updErr) {
          console.error(`[sync-openrouter-models] Update failed for ${m.id}:`, updErr.message);
        } else {
          modelsUpdated++;
        }
      } else {
        const { error: insErr } = await supabase
          .from("ai_models")
          .insert({ ...row, first_seen_at: new Date().toISOString() });
        if (insErr) {
          console.error(`[sync-openrouter-models] Insert failed for ${m.id}:`, insErr.message);
        } else {
          modelsAdded++;
        }
      }
    }

    // Deactivate slugs that disappeared from OpenRouter's catalog
    const { data: stale, error: staleErr } = await supabase
      .from("ai_models")
      .select("id, model_id")
      .eq("provider", "openrouter")
      .eq("is_active", true);
    if (staleErr) {
      console.error("[sync-openrouter-models] Stale lookup failed:", staleErr.message);
    } else if (stale) {
      const gone = stale.filter((r) => !liveIds.has(r.model_id));
      if (gone.length > 0) {
        const { error: deactErr } = await supabase
          .from("ai_models")
          .update({ is_active: false, last_seen_at: new Date().toISOString() })
          .in("id", gone.map((r) => r.id));
        if (deactErr) {
          console.error("[sync-openrouter-models] Deactivate failed:", deactErr.message);
        } else {
          modelsDeactivated = gone.length;
          console.log(`[sync-openrouter-models] Deactivated ${gone.length} slugs no longer in OpenRouter catalog`);
        }
      }
    }
  } catch (err) {
    status = "failed";
    errorMessage = err instanceof Error ? err.message : String(err);
    console.error("[sync-openrouter-models] FAILED:", errorMessage);
  }

  // Finalize sync log
  if (logId) {
    await supabase
      .from("ai_model_sync_logs")
      .update({
        sync_completed_at: new Date().toISOString(),
        models_fetched: modelsFetched,
        models_added: modelsAdded,
        models_updated: modelsUpdated,
        models_deactivated: modelsDeactivated,
        status,
        error_message: errorMessage,
      })
      .eq("id", logId);
  }

  const payload = {
    status,
    models_fetched: modelsFetched,
    models_added: modelsAdded,
    models_updated: modelsUpdated,
    models_deactivated: modelsDeactivated,
    error: errorMessage,
  };

  return new Response(JSON.stringify(payload), {
    status: status === "completed" ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
