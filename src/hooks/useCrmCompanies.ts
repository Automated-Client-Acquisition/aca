import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export type CrmAccountStage = "prospect" | "active" | "customer" | "lost";

export const ACCOUNT_STAGE_OPTIONS: Array<{ value: CrmAccountStage; label: string; color: string }> = [
  { value: "prospect", label: "Prospect", color: "bg-slate-500/15 text-slate-700 dark:text-slate-300 border-slate-500/30" },
  { value: "active", label: "Active", color: "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30" },
  { value: "customer", label: "Customer", color: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30" },
  { value: "lost", label: "Lost", color: "bg-muted text-muted-foreground border-muted-foreground/20" },
];

// Legacy export — keep both names live for one release so any caller that
// hasn't migrated still compiles. New code: use CrmAccountStage / ACCOUNT_STAGE_OPTIONS.
export type CrmCompanyLifecycle = CrmAccountStage;
export const LIFECYCLE_OPTIONS = ACCOUNT_STAGE_OPTIONS;

export interface CrmCompany {
  id: string;
  organization_id: string;
  name: string;
  domain: string | null;
  normalized_domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  industry: string | null;
  employee_count: number | null;
  country: string | null;
  city: string | null;
  description: string | null;
  logo_url: string | null;
  account_stage: CrmAccountStage;
  account_stage_locked_at: string | null;
  owner_user_id: string | null;
  notes: string | null;
  first_seen_at: string;
  last_signal_at: string | null;
  last_contact_at: string | null;
  enrichment_data: Record<string, unknown> | null;
  enrichment_updated_at: string | null;
  enrichment_source: string | null;
  tags: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface CrmCompanyRow extends CrmCompany {
  contact_count: number;
}

interface ListOptions {
  search?: string;
  /** New name. Old `lifecycle` param kept as alias for back-compat. */
  stage?: CrmAccountStage | "all";
  /** @deprecated use `stage` */
  lifecycle?: CrmAccountStage | "all";
  sortBy?: "last_signal_at" | "name" | "contact_count" | "first_seen_at";
  sortDir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/**
 * Paginated, searchable list of crm_companies for the current org. Includes
 * a contact_count rolled up from crm_contacts.company_id so the list can show
 * "X contacts" without a second query per row.
 */
export function useCrmCompanies(options: ListOptions = {}) {
  const { currentOrganization } = useAuth();
  const {
    search = "",
    stage,
    lifecycle,
    sortBy = "last_signal_at",
    sortDir = "desc",
    limit = 50,
    offset = 0,
  } = options;
  // Accept either name. `stage` wins if both are set.
  const activeStage = (stage ?? lifecycle ?? "all") as CrmAccountStage | "all";
  return useQuery({
    queryKey: ["crm_companies", currentOrganization?.id, search, activeStage, sortBy, sortDir, limit, offset],
    enabled: !!currentOrganization,
    queryFn: async () => {
      let q = supabase
        .from("crm_companies")
        .select("*", { count: "exact" })
        .eq("organization_id", currentOrganization!.id);

      if (search.trim()) {
        const term = `%${search.trim()}%`;
        q = q.or(`name.ilike.${term},domain.ilike.${term}`);
      }
      if (activeStage !== "all") {
        q = q.eq("account_stage", activeStage);
      }

      // Sort
      if (sortBy === "last_signal_at") {
        q = q.order("last_signal_at", { ascending: sortDir === "asc", nullsFirst: false });
      } else if (sortBy === "first_seen_at") {
        q = q.order("first_seen_at", { ascending: sortDir === "asc" });
      } else if (sortBy === "name") {
        q = q.order("name", { ascending: sortDir === "asc" });
      }
      // contact_count sort is computed client-side after the join.

      q = q.range(offset, offset + limit - 1);
      const { data, error, count } = await q;
      if (error) throw error;
      const companies = (data ?? []) as CrmCompany[];

      // Rollup contact counts in one query for the page.
      const ids = companies.map((c) => c.id);
      let counts = new Map<string, number>();
      if (ids.length > 0) {
        const { data: contactRows } = await supabase
          .from("crm_contacts")
          .select("company_id")
          .in("company_id", ids);
        for (const row of (contactRows ?? []) as Array<{ company_id: string }>) {
          counts.set(row.company_id, (counts.get(row.company_id) ?? 0) + 1);
        }
      }
      const rows: CrmCompanyRow[] = companies.map((c) => ({
        ...c,
        contact_count: counts.get(c.id) ?? 0,
      }));

      // Apply contact_count sort if requested (client-side because the join
      // would require an RPC or aggregated view — overkill for now).
      if (sortBy === "contact_count") {
        rows.sort((a, b) =>
          sortDir === "asc"
            ? a.contact_count - b.contact_count
            : b.contact_count - a.contact_count,
        );
      }
      return { rows, total: count ?? 0 };
    },
  });
}

/**
 * Pipeline counts per lifecycle stage. Used by the list page's pipeline
 * filter pills so users can see "12 contacted, 3 engaged, 1 meeting"
 * at a glance.
 *
 * Implementation: parallel HEAD count queries, one per stage + one for
 * the total. Selecting all rows and counting client-side hits PostgREST's
 * default 1000-row limit and silently undercounts for large orgs (e.g.
 * 99k companies → "All: 1000" because that's all that fit in one page).
 */
const ACCOUNT_STAGE_VALUES: CrmAccountStage[] = ["prospect", "active", "customer", "lost"];

export function useCrmCompaniesStats() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["crm_companies_stats", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const orgId = currentOrganization!.id;

      const totalQ = supabase
        .from("crm_companies")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);

      const stageQs = ACCOUNT_STAGE_VALUES.map((stage) =>
        supabase
          .from("crm_companies")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("account_stage", stage),
      );

      const [totalRes, ...stageRes] = await Promise.all([totalQ, ...stageQs]);
      if (totalRes.error) throw totalRes.error;

      const counts = ACCOUNT_STAGE_VALUES.reduce(
        (acc, stage, i) => {
          acc[stage] = stageRes[i].count ?? 0;
          return acc;
        },
        {} as Record<CrmAccountStage, number>,
      );

      return { counts, total: totalRes.count ?? 0 };
    },
  });
}

export function useCrmCompany(id: string | null | undefined) {
  return useQuery({
    queryKey: ["crm_company", id],
    enabled: !!id,
    queryFn: async (): Promise<CrmCompany | null> => {
      const { data, error } = await supabase
        .from("crm_companies")
        .select("*")
        .eq("id", id!)
        .maybeSingle();
      if (error) throw error;
      return (data as CrmCompany | null) ?? null;
    },
  });
}

/** Linked contacts for a company. */
export function useCompanyContacts(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ["crm_company_contacts", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("crm_contacts")
        .select("id, display_name, first_name, last_name, primary_email, primary_linkedin_url, job_title, status, last_activity_at, discovery_score")
        .eq("company_id", companyId!)
        .order("discovery_score", { ascending: false, nullsFirst: false })
        .order("last_activity_at", { ascending: false, nullsFirst: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** Signal occurrences linked to this company (via lb_discovered_companies). */
export function useCompanySignalHistory(companyId: string | null | undefined) {
  return useQuery({
    queryKey: ["crm_company_signal_history", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      // Look up the company's normalized_domain and find every signal_activity_log
      // row whose discovered_company shares that domain.
      const { data: company } = await supabase
        .from("crm_companies")
        .select("normalized_domain, name")
        .eq("id", companyId!)
        .maybeSingle();
      const norm = (company as { normalized_domain?: string } | null)?.normalized_domain;
      if (!norm) return [];

      // Find lb_discovered_companies with matching domain
      const { data: dcRows } = await supabase
        .from("lb_discovered_companies")
        .select("id")
        .ilike("domain", `%${norm}%`)
        .limit(50);
      const dcIds = ((dcRows ?? []) as Array<{ id: string }>).map((r) => r.id);
      if (dcIds.length === 0) return [];

      const { data: salRows, error } = await supabase
        .from("signal_activity_log")
        .select("id, signal_type, signal_detail, outcome, icp_score, created_at, subscription_id, exported_at")
        .in("discovered_company_id", dcIds)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return salRows ?? [];
    },
  });
}

interface UpdateInput {
  id: string;
  patch: Partial<Pick<CrmCompany,
    "name" | "domain" | "website_url" | "linkedin_url" | "industry" |
    "employee_count" | "country" | "city" | "description" |
    "account_stage" | "notes" | "tags" | "owner_user_id"
  >>;
}

export function useUpdateCrmCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: UpdateInput): Promise<CrmCompany> => {
      const { data, error } = await supabase
        .from("crm_companies")
        .update(patch)
        .eq("id", id)
        .select("*")
        .single();
      if (error) throw error;
      return data as CrmCompany;
    },
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["crm_companies"] });
      qc.invalidateQueries({ queryKey: ["crm_company", updated.id] });
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Update failed");
    },
  });
}

/**
 * On-demand SignalBase enrichment. Call this from a button click only —
 * NEVER auto-trigger to avoid runaway Apify costs. The user knows when
 * they're spending budget.
 *
 * Calls scrape-and-analyze-icp's sister edge function (TBD: enrich-company-
 * signalbase) which runs the SignalBase actor with signalType=companies for
 * one domain and stores the rich payload (funding, headcount, key people)
 * into crm_companies.enrichment_data.
 */
export function useEnrichCrmCompany() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (companyId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "enrich-company-signalbase",
        { body: { company_id: companyId } },
      );
      if (error) throw error;
      return data as {
        ok: boolean;
        message?: string;
        debug?: string;
        enrichment?: unknown;
      };
    },
    onSuccess: (data, companyId) => {
      qc.invalidateQueries({ queryKey: ["crm_company", companyId] });
      qc.invalidateQueries({ queryKey: ["crm_companies"] });
      // The edge function returns { ok: false, message } when SignalBase had
      // no record (still HTTP 200). Surface that to the user instead of
      // silently claiming success — they spent Apify credits and got nothing.
      if (data?.ok === false) {
        toast.warning(data.message ?? "No SignalBase record for this company.");
      } else {
        toast.success("Company enriched");
      }
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : "Enrichment failed");
    },
  });
}
