import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.81.1";
import { corsHeaders } from "../_shared/cors.ts";
import { decryptApiKey } from "../_shared/unipile-client.ts";
import {
  classifySignalBuyerPersona,
  normalizeQuickenrichSignalPerson,
  type QuickenrichSignalEmployee,
  type SignalBuyerPersona,
} from "../_shared/signal-engine/quickenrich-person.ts";
import { HOUSE_ORG_ID } from "../_shared/site-config.ts";

const PUBLIC_SIGNALS_ORG_ID = HOUSE_ORG_ID;
const API_BASE = "https://app.quickenrich.io/api";
const PERSONA_POLICY_VERSION = 2;
const PERSONAS: SignalBuyerPersona[] = [
  "executive",
  "sales_revenue",
  "marketing_growth",
];
const PERSONA_TITLES: Record<SignalBuyerPersona, string[]> = {
  executive: [
    "CEO",
    "Chief Executive Officer",
    "Founder",
    "Co-Founder",
    "Managing Director",
    "Managing Partner",
  ],
  sales_revenue: [
    "Chief Revenue Officer",
    "Chief Sales Officer",
    "Chief Commercial Officer",
    "VP Sales",
    "Vice President of Sales",
    "Head of Sales",
    "Sales Director",
    "Head of Business Development",
    "VP Business Development",
  ],
  marketing_growth: [
    "CMO",
    "Chief Marketing Officer",
    "Chief Growth Officer",
    "VP Marketing",
    "Vice President of Marketing",
    "Head of Marketing",
    "Marketing Director",
    "Head of Growth",
    "VP Growth",
    "Head of Demand Generation",
  ],
};

type ClaimedCompany = {
  company_key: string;
  company_name: string;
  domain: string;
  company_linkedin_url: string | null;
};

type Employee = QuickenrichSignalEmployee;

function normalizeDomain(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    return new URL(value.includes("://") ? value : `https://${value}`).hostname
      .toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function seniorityRank(title: string | null): number {
  return classifySignalBuyerPersona(title)?.priority ?? 0;
}

function rowsFrom(body: unknown): Employee[] {
  if (!body || typeof body !== "object") return [];
  const data = (body as { data?: unknown }).data;
  return Array.isArray(data)
    ? data as Employee[]
    : data && typeof data === "object"
    ? [data as Employee]
    : [];
}

function normalizeEmployee(row: Employee, requestedDomain: string) {
  return normalizeQuickenrichSignalPerson(
    row,
    requestedDomain,
    normalizeDomain,
    seniorityRank,
  );
}

async function reserve(
  supabase: SupabaseClient,
  provider: string,
  rpm: number,
) {
  const { data, error } = await supabase.rpc(
    "reserve_enrichment_provider_request",
    {
      p_organization_id: PUBLIC_SIGNALS_ORG_ID,
      p_provider: provider,
      p_requests_per_minute: rpm,
      p_daily_cap: null,
      p_max_wait_ms: 5_000,
    },
  );
  if (error) throw new Error(`reservation_failed:${error.message}`);
  const row = (Array.isArray(data) ? data[0] : data) as {
    reservation_status?: string;
    wait_ms?: number;
  } | null;
  return {
    granted: row?.reservation_status === "granted",
    waitMs: Math.max(0, Number(row?.wait_ms) || 0),
  };
}

async function searchCompanyByMissingPersonas(
  supabase: SupabaseClient,
  token: string,
  rpm: number,
  company: ClaimedCompany,
) {
  const { data: cachedRows, error: cachedError } = await supabase
    .from("public_signal_people")
    .select("title,linkedin_url")
    .eq("company_key", company.company_key)
    .eq("source", "quickenrich")
    .not("email", "is", null);
  if (cachedError) throw new Error(`cache_read_failed:${cachedError.message}`);

  const covered = new Set<SignalBuyerPersona>();
  const existingLinkedin = new Set<string>();
  let cachedTargetCount = 0;
  for (const row of cachedRows ?? []) {
    const classification = classifySignalBuyerPersona(row.title);
    if (classification) {
      covered.add(classification.persona);
      cachedTargetCount++;
    }
    if (row.linkedin_url) existingLinkedin.add(row.linkedin_url);
  }

  const raw: Employee[] = [];
  const people: NonNullable<ReturnType<typeof normalizeEmployee>>[] = [];
  let pages = 0;
  let creditsUsed = 0;
  personaLoop:
  for (const persona of PERSONAS) {
    if (covered.has(persona)) continue;
    for (const title of PERSONA_TITLES[persona]) {
      for (let page = 1; page <= 3; page++) {
        const slot = await reserve(supabase, "quickenrich_domain_search", rpm);
        if (!slot.granted) throw new Error("rate_wait");
        if (slot.waitMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, slot.waitMs));
        }
        const params = new URLSearchParams({
          company_url: company.domain,
          title,
          has_email: "1",
          page: String(page),
        });
        const response = await fetch(
          `${API_BASE}/employees/dataset-search?${params}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (response.status === 429) throw new Error("rate_wait");
        if (response.status === 401 || response.status === 403) {
          throw new Error("authentication_failed");
        }
        if (response.status >= 500) {
          throw new Error(`provider_${response.status}`);
        }
        const body = await response.json().catch(() => ({})) as {
          meta?: { last_page?: number; credits_used?: number };
        };
        if (!response.ok) {
          const detail = JSON.stringify(body).replace(
            /[^a-zA-Z0-9 _.,:{}\[\]"-]/g,
            "",
          ).slice(0, 400);
          throw new Error(
            `provider_${response.status}${detail ? `:${detail}` : ""}`,
          );
        }
        const pageRows = rowsFrom(body);
        raw.push(...pageRows);
        pages++;
        creditsUsed += Math.max(0, Number(body.meta?.credits_used) || 0);
        const candidate = pageRows
          .map((row) => normalizeEmployee(row, company.domain))
          .filter((
            row,
          ): row is NonNullable<ReturnType<typeof normalizeEmployee>> =>
            row !== null && row.outreach_persona === persona &&
            !existingLinkedin.has(row.linkedin_url)
          )
          .sort((a, b) =>
            b.seniority_rank - a.seniority_rank ||
            a.full_name.localeCompare(b.full_name)
          )[0];
        if (candidate) {
          people.push(candidate);
          covered.add(persona);
          existingLinkedin.add(candidate.linkedin_url);
          continue personaLoop;
        }
        const lastPage = Number(body.meta?.last_page ?? 0);
        if (pageRows.length === 0 || (lastPage > 0 && page >= lastPage)) break;
      }
    }
  }
  return { raw, people, pages, cached: cachedTargetCount, creditsUsed };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const encryptionKey = Deno.env.get("ENCRYPTION_KEY");
    if (!supabaseUrl || !serviceKey || !encryptionKey) {
      throw new Error("missing_server_configuration");
    }
    if (req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
      return new Response(
        JSON.stringify({ ok: false, error: "unauthorized" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const supabase = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({}));
    const batchSize = Math.min(
      2,
      Math.max(1, Number(body.batch_size ?? body.limit ?? 1)),
    );
    const { data: keyRow, error: keyError } = await supabase
      .from("api_keys")
      .select("key_encrypted, metadata")
      .eq("organization_id", PUBLIC_SIGNALS_ORG_ID)
      .eq("provider", "quickenrich")
      .eq("is_valid", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (keyError || !keyRow) throw new Error("quickenrich_key_not_configured");
    const token = await decryptApiKey(
      keyRow.key_encrypted as string,
      encryptionKey,
    );
    const plan = String(
      (keyRow.metadata as { plan?: string } | null)?.plan ?? "",
    ).toLowerCase();
    const rpm = plan === "gtm_unlimited" ? 6_000 : 300;

    const { data: claimed, error: claimError } = await supabase.rpc(
      "claim_public_signal_companies_for_quickenrich_personas",
      { p_batch_size: batchSize, p_lookback_days: 14 },
    );
    if (claimError) throw new Error(`claim_failed:${claimError.message}`);

    const results: Array<Record<string, unknown>> = [];
    let peopleWritten = 0;
    for (const company of (claimed ?? []) as ClaimedCompany[]) {
      try {
        const found = await searchCompanyByMissingPersonas(
          supabase,
          token,
          rpm,
          company,
        );
        for (const person of found.people) {
          const { error } = await supabase.from("public_signal_people").upsert({
            company_key: company.company_key,
            company_linkedin_url: company.company_linkedin_url,
            domain: company.domain,
            ...person,
            source: "quickenrich",
            persona_policy_version: PERSONA_POLICY_VERSION,
            enriched_at: new Date().toISOString(),
          }, { onConflict: "company_key,linkedin_url" });
          if (!error) peopleWritten++;
        }

        const firmographic = found.raw.find((row) =>
          row.employee_count != null || row.industry || row.revenue
        );
        if (firmographic) {
          const rawEmployeeCount = String(firmographic.employee_count ?? "")
            .trim();
          const parsed = /^\d+$/.test(rawEmployeeCount)
            ? Number.parseInt(rawEmployeeCount, 10)
            : NaN;
          const payload: Record<string, unknown> = {
            company_key: company.company_key,
            domain: company.domain,
            source: "quickenrich",
            enriched_at: new Date().toISOString(),
          };
          if (Number.isFinite(parsed) && parsed > 0) {
            payload.employee_count = parsed;
          } else if (rawEmployeeCount) {
            payload.employee_range = rawEmployeeCount;
          }
          if (firmographic.revenue) {
            payload.revenue_range = firmographic.revenue;
          }
          if (firmographic.industry) payload.industry = firmographic.industry;
          if (firmographic.country_code) {
            payload.country = firmographic.country_code;
          }
          if (firmographic.region_code) {
            payload.state = firmographic.region_code;
          }
          if (firmographic.city) payload.city = firmographic.city;
          await supabase.from("public_signal_companies").upsert(payload, {
            onConflict: "company_key",
          });
        }

        const totalPeople = found.cached + found.people.length;
        const outcome = totalPeople ? "complete" : "not_found";
        await supabase.from("public_signal_people_enrichment_state").update({
          status: outcome,
          provider: "quickenrich",
          people_found: totalPeople,
          pages_fetched: found.pages,
          persona_policy_version: PERSONA_POLICY_VERSION,
          completed_at: new Date().toISOString(),
          lease_expires_at: null,
          last_error: null,
          next_attempt_at: outcome === "not_found"
            ? new Date(Date.now() + 7 * 86_400_000).toISOString()
            : new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }).eq("company_key", company.company_key);
        results.push({
          company: company.company_name,
          outcome,
          people: found.people.length,
          cached: found.cached,
          discovery_pages: found.pages,
          credits_used: found.creditsUsed,
          policy_version: PERSONA_POLICY_VERSION,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const retryable = message === "rate_wait" ||
          message.startsWith("provider_") ||
          /timeout|timed out|abort/i.test(message);
        await supabase.from("public_signal_people_enrichment_state").update({
          status: retryable ? "failed" : "dead",
          lease_expires_at: null,
          last_error: message.slice(0, 500),
          next_attempt_at: retryable
            ? new Date(Date.now() + 15 * 60_000).toISOString()
            : new Date(Date.now() + 30 * 86_400_000).toISOString(),
        }).eq("company_key", company.company_key);
        results.push({
          company: company.company_name,
          outcome: retryable ? "retry" : "dead",
          error: message,
        });
        if (message === "authentication_failed") break;
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        claimed: claimed?.length ?? 0,
        people_written: peopleWritten,
        results,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (error) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
