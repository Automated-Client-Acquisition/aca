/**
 * Edge Function: backfill-signal-countries
 * ----------------------------------------------------------------------------
 * Fills the `country` column on `public_signals` for the public /signals feed.
 *
 * Per-row geo is empty (domain/location are ~0% populated), so the only reliable
 * extraction input is the signal text. This function pulls published rows where
 * `country IS NULL`, batches them to a cheap OpenRouter model, and asks for the
 * company HQ country as an ISO-3166 alpha-2 code (or null when not inferable).
 *
 * The frontend maps the ISO code to a display name + flag, so we store ONLY the
 * 2-letter code here (the column's de-facto convention now that nothing else
 * writes it). Idempotent: only ever touches rows with a NULL country, so it is
 * safe to re-run and safe to put on a cron for ingest continuity.
 *
 * Auth mirrors push-public-signal: shared secret `x-signals-push-secret` OR a
 * Supabase user JWT that belongs to the public-signals org.
 *
 * Body (all optional):
 *   { limit?: number,        // max rows to process this call (default 200)
 *     batch_size?: number,   // rows per LLM call (default 20)
 *     dry_run?: boolean }    // extract + return, but do NOT write
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { HOUSE_ORG_ID, PUBLIC_SITE_URL } from "../_shared/site-config.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-signals-push-secret, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENROUTER_API_KEY = (Deno.env.get("OPENROUTER_API_KEY") ?? "").trim();
const PUBLIC_SIGNALS_ORG_ID =
  Deno.env.get("PUBLIC_SIGNALS_ORG_ID") ?? HOUSE_ORG_ID;
const PUSH_SECRET = Deno.env.get("PUBLIC_SIGNALS_PUSH_SECRET") ?? "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") ?? "";

// Cheap + reliable for short structured extraction; already used elsewhere in
// the codebase. Override with the COUNTRY_BACKFILL_MODEL secret if needed.
const MODEL = Deno.env.get("COUNTRY_BACKFILL_MODEL") ?? "google/gemini-2.5-flash-lite";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface SignalRow {
  id: string;
  company_name: string | null;
  title: string | null;
  summary: string | null;
  source_label: string | null;
  source_url: string | null;
}

/** A row reduced to the fields the model sees (keeps tokens — and cost — low). */
function promptRow(r: SignalRow) {
  return {
    id: r.id,
    company: r.company_name ?? "",
    headline: r.title ?? "",
    summary: (r.summary ?? "").slice(0, 280),
    source: r.source_label ?? "",
  };
}

const SYSTEM_PROMPT =
  "You identify the headquarters country of the company in each B2B business " +
  "signal (funding, hiring, acquisition, leadership change). Use only the text " +
  "given plus well-known facts about named companies. Return the country as an " +
  "ISO-3166-1 alpha-2 code (e.g. US, GB, DE, FR, IN, AU). If the country is not " +
  "stated and you are not confident, return null — never guess. Output STRICT " +
  'JSON only: {"results":[{"id":"<id>","country":"US"|null}]}. No prose, no markdown.';

const ISO2 = /^[A-Z]{2}$/;

async function extractBatch(rows: SignalRow[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!rows.length) return out;
  // The model echoes back the row id; guard against it garbling or hallucinating
  // one (a corrupted id would poison the UPDATE's .in() and fail the whole batch).
  const validIds = new Set(rows.map((r) => r.id));

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": PUBLIC_SITE_URL,
      "X-Title": "ACA Signal Country Backfill",
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: JSON.stringify({ signals: rows.map(promptRow) }) },
      ],
      temperature: 0,
      max_tokens: 40 * rows.length + 200,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const content: string = data?.choices?.[0]?.message?.content ?? "";
  let parsed: { results?: { id?: string; country?: string | null }[] };
  try {
    parsed = JSON.parse(content);
  } catch {
    // Some models wrap JSON in stray text despite json mode — salvage the object.
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("model returned non-JSON");
    parsed = JSON.parse(m[0]);
  }

  for (const r of parsed.results ?? []) {
    const code = (r.country ?? "").toString().trim().toUpperCase();
    if (r.id && validIds.has(r.id) && ISO2.test(code)) out.set(r.id, code);
  }
  return out;
}

async function authorize(req: Request, admin: SupabaseClient): Promise<Response | null> {
  const secret = req.headers.get("x-signals-push-secret");
  if (PUSH_SECRET && secret === PUSH_SECRET) return null;

  // Cron caller: the pg_cron job sends `x-cron-secret` from Vault (`cron_secret`),
  // the project's established cron→edge auth scheme. See the
  // *_signal_country_backfill_cron migration.
  const cronSecret = req.headers.get("x-cron-secret");
  if (CRON_SECRET && cronSecret === CRON_SECRET) return null;

  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);

  // Also accept the project service-role key as a Bearer (internal callers).
  if (SERVICE_ROLE_KEY && token === SERVICE_ROLE_KEY) return null;

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthorized" }, 401);

  const { data: membership } = await admin
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", userData.user.id)
    .eq("organization_id", PUBLIC_SIGNALS_ORG_ID)
    .maybeSingle();
  if (!membership) return json({ ok: false, error: "forbidden" }, 403);
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);
  if (!OPENROUTER_API_KEY) return json({ ok: false, error: "OPENROUTER_API_KEY not set" }, 500);

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const authErr = await authorize(req, admin);
  if (authErr) return authErr;

  let opts: { limit?: number; batch_size?: number; dry_run?: boolean } = {};
  try {
    const raw = await req.text();
    if (raw.trim()) opts = JSON.parse(raw);
  } catch {
    return json({ ok: false, error: "invalid_json" }, 400);
  }

  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const batchSize = Math.min(Math.max(opts.batch_size ?? 20, 1), 50);
  const dryRun = !!opts.dry_run;

  const { data: rows, error } = await admin
    .from("public_signals")
    .select("id, company_name, title, summary, source_label, source_url")
    .eq("published", true)
    .is("country", null)
    .order("signal_date", { ascending: false })
    .limit(limit);
  if (error) return json({ ok: false, error: error.message }, 500);

  const candidates = (rows ?? []) as SignalRow[];
  if (!candidates.length) {
    return json({ ok: true, scanned: 0, resolved: 0, updated: 0, remaining: 0, dry_run: dryRun });
  }

  const resolved = new Map<string, string>();
  const batchErrors: string[] = [];
  for (let i = 0; i < candidates.length; i += batchSize) {
    const batch = candidates.slice(i, i + batchSize);
    try {
      for (const [id, code] of await extractBatch(batch)) resolved.set(id, code);
    } catch (e) {
      batchErrors.push(e instanceof Error ? e.message : String(e));
    }
  }

  let updated = 0;
  if (!dryRun) {
    // Group ids by code so each country is one UPDATE rather than one per row.
    const byCode = new Map<string, string[]>();
    for (const [id, code] of resolved) {
      const list = byCode.get(code) ?? [];
      list.push(id);
      byCode.set(code, list);
    }
    for (const [code, ids] of byCode) {
      const { error: upErr } = await admin
        .from("public_signals")
        .update({ country: code })
        .in("id", ids);
      if (upErr) batchErrors.push(`update ${code}: ${upErr.message}`);
      else updated += ids.length;
    }
  }

  // Distribution of what we resolved — handy when eyeballing a dry run.
  const distribution: Record<string, number> = {};
  for (const code of resolved.values()) distribution[code] = (distribution[code] ?? 0) + 1;

  return json({
    ok: batchErrors.length === 0,
    scanned: candidates.length,
    resolved: resolved.size,
    updated,
    unresolved: candidates.length - resolved.size,
    distribution,
    dry_run: dryRun,
    errors: batchErrors,
  });
});
