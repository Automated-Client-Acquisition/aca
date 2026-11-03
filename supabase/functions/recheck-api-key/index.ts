// Re-check a single stored API key against its provider without making the
// user re-paste it. Exists because dispatch-generation-job short-circuits on
// api_keys.is_valid === false (see openrouter-credits.ts) and nothing else
// clears that flag on demand: the only automatic re-check is the nightly
// validate-openrouter-keys cron, and the only user-facing path (Resolve Key)
// requires re-entering the same key just to trigger a re-validate. A user who
// tops up OpenRouter credits after a 402 block would otherwise stay blocked
// until the next cron run.
//
// Currently supports 'openrouter' only, since that's the sole provider that
// sets api_keys.metadata.health_status = 'blocked' today (see
// _shared/openrouter-credits.ts). The auth/key endpoint checks key validity,
// not balance, so a topped-up key re-validates immediately even though it
// doesn't confirm credits are non-zero — the next real generation call does that.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";
import { decryptApiKey } from "../_shared/apify-leads-utils.ts";

const OPENROUTER_AUTH_URL = "https://openrouter.ai/api/v1/auth/key";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("No authorization header");

    const supabaseClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseClient.auth.getUser(token);
    if (userError || !user) throw new Error("Unauthorized");

    const { id } = await req.json();
    if (!id || typeof id !== "string") {
      throw new Error("id is required");
    }

    const { data: userData, error: userDataError } = await supabaseClient
      .from("users")
      .select("organization_id, active_organization_id")
      .eq("id", user.id)
      .single();
    if (userDataError || !userData) throw new Error("Could not resolve organization");
    const orgId = userData.active_organization_id || userData.organization_id;

    // Scoped by both id and organization_id — RLS already enforces this, but
    // being explicit keeps the query self-documenting.
    const { data: row, error: rowError } = await supabaseClient
      .from("api_keys")
      .select("id, provider, key_encrypted, metadata")
      .eq("id", id)
      .eq("organization_id", orgId)
      .single();
    if (rowError || !row) throw new Error("API key not found");

    if (row.provider !== "openrouter") {
      return new Response(
        JSON.stringify({ valid: false, error: `Rechecking is not yet supported for ${row.provider}. Update the key instead.` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const encryptionKey = Deno.env.get("ENCRYPTION_KEY");
    if (!encryptionKey) throw new Error("ENCRYPTION_KEY not configured");
    const apiKey = await decryptApiKey(row.key_encrypted, encryptionKey);

    const response = await fetch(OPENROUTER_AUTH_URL, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    const existingMetadata = (row.metadata as Record<string, unknown>) || {};
    const now = new Date().toISOString();
    const isValid = response.ok;

    const metadata = isValid
      ? {
          ...existingMetadata,
          health_status: "healthy",
          health_reason: null,
          health_checked_at: now,
          last_error: null,
          last_error_at: null,
          last_error_code: null,
        }
      : { ...existingMetadata, health_checked_at: now };

    const { error: updateError } = await supabaseClient
      .from("api_keys")
      .update({ is_valid: isValid, last_validated: now, metadata })
      .eq("id", row.id);
    if (updateError) throw updateError;

    return new Response(
      JSON.stringify({
        valid: isValid,
        error: isValid ? null : "OpenRouter still rejects this key — it may have been revoked or rotated.",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[recheck-api-key] error:", error);
    return new Response(
      JSON.stringify({ valid: false, error: error instanceof Error ? error.message : "Recheck failed" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
