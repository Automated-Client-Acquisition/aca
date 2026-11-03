/**
 * Edge Function: push-public-signal
 * ----------------------------------------------------------------------------
 * Authenticated write entrypoint for the database-driven public /signals feed.
 * Used by the `aca` CLI (`aca signals push`) and the scraper. The MCP server
 * writes through the same shared helper directly (it already runs service-role).
 *
 * Auth: a Supabase user JWT whose user is a member of the public-signals org
 * (PUBLIC_SIGNALS_ORG_ID, defaults to ACA_HOUSE_ORG_ID) — OR a shared secret header
 * `x-signals-push-secret` matching PUBLIC_SIGNALS_PUSH_SECRET (for the scraper).
 *
 * Body: a single signal object, or { signals: [...] } for a batch.
 * Each signal must include company_name, signal_type, source_url; optional
 * people[] ({ full_name, linkedin_url, title?, photo_url?, seniority_rank? })
 * and company{} firmographics ({ employee_count, revenue_range, industry, … }),
 * which feed the auto-add size/revenue gates.
 *
 * @see _shared/public-signals.ts
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import {
  PushValidationError,
  upsertPublicSignals,
  type PushSignalInput,
} from "../_shared/public-signals.ts";
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signals-push-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PUBLIC_SIGNALS_ORG_ID =
  Deno.env.get("PUBLIC_SIGNALS_ORG_ID") ?? HOUSE_ORG_ID;
const PUSH_SECRET = Deno.env.get("PUBLIC_SIGNALS_PUSH_SECRET") ?? "";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // --- Auth: shared secret (scraper) OR member of the public-signals org ------
  let createdBy: string | null = null;
  const secret = req.headers.get("x-signals-push-secret");
  const authorized = PUSH_SECRET && secret === PUSH_SECRET;

  if (!authorized) {
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "unauthorized" }, 401);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) return json({ ok: false, error: "unauthorized" }, 401);
    createdBy = userData.user.id;

    const { data: membership } = await admin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", createdBy)
      .eq("organization_id", PUBLIC_SIGNALS_ORG_ID)
      .maybeSingle();
    if (!membership) return json({ ok: false, error: "forbidden" }, 403);
  }

  // --- Parse body ------------------------------------------------------------
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const signals: PushSignalInput[] = Array.isArray(payload)
    ? payload as PushSignalInput[]
    : (payload && typeof payload === "object" && Array.isArray((payload as Record<string, unknown>).signals))
      ? (payload as { signals: PushSignalInput[] }).signals
      : [payload as PushSignalInput];

  if (!signals.length) return json({ ok: false, error: "no_signals" }, 400);

  try {
    const { ok, errors } = await upsertPublicSignals(admin, signals, { createdBy });
    return json({
      ok: errors.length === 0,
      pushed: ok.length,
      failed: errors.length,
      results: ok,
      errors,
    }, errors.length && !ok.length ? 400 : 200);
  } catch (e) {
    const status = e instanceof PushValidationError ? 400 : 500;
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) }, status);
  }
});
