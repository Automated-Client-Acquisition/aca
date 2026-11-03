// Validate all stored OpenRouter API keys against OpenRouter's auth endpoint.
// Flips api_keys.is_valid to match reality so the UI can show a clear
// "your key is invalid, rotate it" state instead of jobs hanging silently.
//
// Scheduled nightly via pg_cron. Safe to run manually.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";
import { decryptApiKey } from "../_shared/apify-leads-utils.ts";
import { isServiceRoleRequest } from "../_shared/org-access.ts";
import { AuthError, unauthorized } from "../_shared/cli-auth.ts";

const OPENROUTER_AUTH_URL = "https://openrouter.ai/api/v1/auth/key";
const PER_CALL_TIMEOUT_MS = 10_000;

interface KeyRow {
  id: string;
  organization_id: string;
  key_encrypted: string;
  is_valid: boolean;
  metadata: Record<string, unknown> | null;
}

async function validateOne(apiKey: string): Promise<{ ok: boolean; status: number; bodyPreview: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort("timeout"), PER_CALL_TIMEOUT_MS);
  try {
    const res = await fetch(OPENROUTER_AUTH_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, bodyPreview: text.slice(0, 200) };
  } finally {
    clearTimeout(timeoutId);
  }
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

  const encryptionKey = Deno.env.get("ENCRYPTION_KEY");
  if (!encryptionKey) {
    return new Response(
      JSON.stringify({ ok: false, error: "ENCRYPTION_KEY not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: keys, error: keysErr } = await supabase
    .from("api_keys")
    .select("id, organization_id, key_encrypted, is_valid, metadata")
    .eq("provider", "openrouter");

  if (keysErr || !keys) {
    return new Response(
      JSON.stringify({ ok: false, error: keysErr?.message ?? "key fetch failed" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let checked = 0;
  let flippedToInvalid = 0;
  let flippedToValid = 0;
  let unchanged = 0;
  let decryptErrors = 0;
  let networkErrors = 0;
  const flipped: Array<{ organization_id: string; from: boolean; to: boolean; status?: number }> = [];

  for (const row of keys as KeyRow[]) {
    checked++;
    let apiKey: string;
    try {
      apiKey = await decryptApiKey(row.key_encrypted, encryptionKey);
    } catch (err) {
      console.error(`[validate-openrouter-keys] decrypt failed for org ${row.organization_id}:`, err);
      decryptErrors++;
      continue;
    }

    let result;
    try {
      result = await validateOne(apiKey);
    } catch (err) {
      console.error(`[validate-openrouter-keys] network error for org ${row.organization_id}:`, err);
      networkErrors++;
      // Don't flip on a transient network error — leave is_valid as-is.
      continue;
    }

    const newIsValid = result.ok;
    if (newIsValid === row.is_valid) {
      unchanged++;
      continue;
    }

    const { error: updErr } = await supabase
      .from("api_keys")
      .update({
        is_valid: newIsValid,
        last_validated: new Date().toISOString(),
        metadata: newIsValid
          ? {
              ...(row.metadata || {}),
              health_status: 'healthy',
              health_reason: null,
              health_checked_at: new Date().toISOString(),
              last_error: null,
              last_error_at: null,
              last_error_code: null,
            }
          : row.metadata,
      })
      .eq("id", row.id);

    if (updErr) {
      console.error(`[validate-openrouter-keys] update failed for org ${row.organization_id}:`, updErr.message);
      continue;
    }

    if (newIsValid) flippedToValid++;
    else flippedToInvalid++;
    flipped.push({
      organization_id: row.organization_id,
      from: row.is_valid,
      to: newIsValid,
      status: result.status,
    });
    console.log(`[validate-openrouter-keys] org=${row.organization_id} is_valid ${row.is_valid} -> ${newIsValid} (HTTP ${result.status})`);
  }

  return new Response(
    JSON.stringify(
      {
        ok: true,
        checked,
        flipped_to_invalid: flippedToInvalid,
        flipped_to_valid: flippedToValid,
        unchanged,
        decrypt_errors: decryptErrors,
        network_errors: networkErrors,
        flipped,
      },
      null,
      2,
    ),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
