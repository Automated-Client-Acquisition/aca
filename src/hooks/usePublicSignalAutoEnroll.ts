import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";

/** Which side of the product a rule draws its leads from. */
export type AutoEnrollSource = "public" | "custom" | "all";

export const SOURCE_LABELS: Record<AutoEnrollSource, string> = {
  public: "Public signal library",
  custom: "My signals",
  all: "Both",
};

/**
 * The rule's filter step — a small fixed gate set the sweep evaluates before
 * anything is enrolled (SQL: signal_lead_passes_filter plus the two candidate
 * cores). An empty object means "no gates", which is exactly how rules behaved
 * before the filter step existed.
 */
export interface SignalFilterCriteria {
  /** Any one of these substrings must appear in the title (case-insensitive). */
  title_includes?: string[];
  /** None of these substrings may appear in the title. */
  title_excludes?: string[];
  /** Minimum derived seniority rank — see SENIORITY_OPTIONS. */
  min_seniority?: number;
  /** People per company. Unset = 5 on the public library, uncapped on own signals. */
  max_per_company?: number;
  /** ISO-3166 alpha-2. A lead with no country is dropped once this is set. */
  countries?: string[];
  /** Only signals/leads newer than this. Unset = each branch's default window. */
  recency_days?: number;
  /** Public branch only: skip companies already in the CRM. */
  skip_known_companies?: boolean;
  /** Company headcount bands — see EMPLOYEE_BAND_OPTIONS. Unknown size fails. */
  employee_bands?: string[];
  /** Company revenue bands, in the provider's vocabulary. Unknown revenue fails. */
  revenue_bands?: string[];
}

/**
 * Headcount bands. These are OURS, not the provider's: MoltSets' smallest band
 * is "1-10", which cannot separate a solopreneur from a small team — the cut
 * these rules most need. The server derives the band from an exact headcount
 * (public.signal_employee_band), so "1" stands alone.
 */
// Moved to icp-targeting-options.ts (single source of truth, also used by the
// ICP editor's Company Firmographics section) — re-exported here so existing
// imports from this hook keep working unchanged.
export { EMPLOYEE_BAND_OPTIONS, REVENUE_BAND_OPTIONS } from "@/lib/icp-targeting-options";

/** Thresholds match public.signal_seniority_rank(title) in the database. */
export const SENIORITY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Any seniority" },
  { value: 60, label: "Director / Head and up" },
  { value: 70, label: "VP and up" },
  { value: 90, label: "C-level & founders" },
];

export const RECENCY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Default window" },
  { value: 1, label: "Last 24 hours" },
  { value: 7, label: "Last 7 days" },
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last 90 days" },
];

/** Drops empty / no-op entries so an untouched form stores `{}` rather than noise. */
export function normalizeCriteria(criteria: SignalFilterCriteria): SignalFilterCriteria {
  const out: SignalFilterCriteria = {};
  const includes = criteria.title_includes?.map((v) => v.trim()).filter(Boolean) ?? [];
  const excludes = criteria.title_excludes?.map((v) => v.trim()).filter(Boolean) ?? [];
  if (includes.length) out.title_includes = includes;
  if (excludes.length) out.title_excludes = excludes;
  if (criteria.min_seniority) out.min_seniority = criteria.min_seniority;
  if (criteria.max_per_company) out.max_per_company = criteria.max_per_company;
  if (criteria.countries?.length) out.countries = criteria.countries;
  if (criteria.recency_days) out.recency_days = criteria.recency_days;
  if (criteria.skip_known_companies) out.skip_known_companies = true;
  // An empty array must never be stored: server-side that has to be read as
  // "no gate", and dropping it here keeps the two from ever disagreeing.
  if (criteria.employee_bands?.length) out.employee_bands = criteria.employee_bands;
  if (criteria.revenue_bands?.length) out.revenue_bands = criteria.revenue_bands;
  return out;
}

/** How many gates a rule actually sets — drives the filter step's summary. */
export function countActiveGates(criteria: SignalFilterCriteria | null | undefined): number {
  return Object.keys(normalizeCriteria(criteria ?? {})).length;
}

/** Comma-separated keyword input ⇄ the stored string[]. */
export function parseKeywords(value: string): string[] {
  return value.split(",").map((v) => v.trim()).filter(Boolean);
}

export interface AutoEnrollRule {
  id: string;
  organization_id: string;
  list_id: string;
  source: AutoEnrollSource;
  /** NULL or empty = all signal types. */
  signal_types: string[] | null;
  require_email: boolean;
  /** The filter step. `{}` = no gates. */
  filter_criteria: SignalFilterCriteria | null;
  status: "active" | "paused";
  lookback_days: number;
  last_run_at: string | null;
  total_enrolled: number;
  created_at: string;
}

const QUERY_KEY = "public-signal-auto-enroll-rules";

/**
 * A custom-signal lead carries either discovery_metadata.signal_type or, as a
 * fallback, its subscription's pack_key — and the two don't always match
 * (pack "just_funded_saas" writes signal_type "just_funded"). Storing both
 * spellings on the rule makes the sweep's comparison hit either way.
 */
const PACK_KEY_ALIASES: Record<string, string[]> = {
  just_funded_saas: ["just_funded_saas", "just_funded"],
  recent_acquisitions: ["recent_acquisitions", "recent_acquisition"],
};

export function packKeyFilterValues(packKey: string): string[] {
  return PACK_KEY_ALIASES[packKey] ?? [packKey];
}

/**
 * Signal-type options for rules that read the org's own signals, derived from
 * its subscriptions (a small table) rather than scanning discovered contacts.
 */
export function useCustomSignalTypeOptions() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["custom-signal-type-options", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pack_subscriptions")
        .select("pack_key, name")
        .eq("organization_id", currentOrganization!.id)
        .is("deleted_at", null)
        .neq("status", "cancelled");
      if (error) throw error;
      const seen = new Map<string, string>();
      for (const row of (data ?? []) as Array<{ pack_key: string; name: string | null }>) {
        if (row.pack_key === "public_linkedin_signals") continue;
        if (!seen.has(row.pack_key)) {
          seen.set(row.pack_key, row.pack_key.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase()));
        }
      }
      return Array.from(seen, ([value, label]) => ({ value, label }));
    },
  });
}

export function useAutoEnrollRules() {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: [QUERY_KEY, currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      const { data, error } = await supabase
        // @ts-expect-error Generated Supabase types update alongside the migration.
        .from("public_signal_auto_enroll_rules")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as AutoEnrollRule[];
    },
  });
}

export function useCreateAutoEnrollRule() {
  const qc = useQueryClient();
  const { currentOrganization, user } = useAuth();
  return useMutation({
    mutationFn: async (input: {
      list_id: string;
      source: AutoEnrollSource;
      signal_types: string[] | null;
      require_email: boolean;
      filter_criteria?: SignalFilterCriteria;
    }) => {
      if (!currentOrganization) throw new Error("No organization");
      const { data, error } = await supabase
        // @ts-expect-error Generated Supabase types update alongside the migration.
        .from("public_signal_auto_enroll_rules")
        .insert({
          organization_id: currentOrganization.id,
          list_id: input.list_id,
          source: input.source,
          signal_types: input.signal_types?.length ? input.signal_types : null,
          require_email: input.require_email,
          filter_criteria: normalizeCriteria(input.filter_criteria ?? {}),
          created_by: user?.id ?? null,
        })
        .select("*")
        .single();
      if (error) {
        if ((error as { code?: string }).code === "23505") {
          throw new Error("This list already has an auto-add rule. Edit or delete the existing one.");
        }
        throw error;
      }
      return data as unknown as AutoEnrollRule;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Auto-add enabled — new matching leads land in the list within 30 minutes");
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Could not create rule"),
  });
}

export function useUpdateAutoEnrollRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: { id: string } & Partial<
        Pick<AutoEnrollRule, "status" | "signal_types" | "require_email" | "source" | "filter_criteria">
      >,
    ) => {
      const { id, ...patch } = input;
      const { error } = await supabase
        // @ts-expect-error Generated Supabase types update alongside the migration.
        .from("public_signal_auto_enroll_rules")
        .update(
          patch.filter_criteria
            ? { ...patch, filter_criteria: normalizeCriteria(patch.filter_criteria) }
            : patch,
        )
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: [QUERY_KEY] }),
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Could not update rule"),
  });
}

/**
 * "How many leads would this rule add right now?" — the RPC runs the exact
 * candidate cores the sweep uses, so the number can't drift from reality.
 *
 * The failure mode this exists to prevent: a gate combination that silently
 * matches zero forever. Debounced because the filter step's text inputs change
 * on every keystroke.
 */
export function useAutoEnrollPreviewCount(input: {
  source: AutoEnrollSource;
  signal_types: string[] | null;
  require_email: boolean;
  filter_criteria: SignalFilterCriteria;
  /** Excludes leads already in this list, matching what the sweep would add. */
  list_id?: string | null;
  enabled?: boolean;
}) {
  const { currentOrganization } = useAuth();
  const criteria = normalizeCriteria(input.filter_criteria);
  // Debounce the serialized shape, not the object — a fresh object every render
  // would otherwise restart the timer forever.
  const debouncedKey = useDebouncedValue(
    JSON.stringify([input.source, input.signal_types, input.require_email, criteria, input.list_id ?? null]),
    400,
  );

  return useQuery({
    queryKey: ["public-signal-auto-enroll-preview", currentOrganization?.id, debouncedKey],
    enabled: !!currentOrganization && input.enabled !== false && !!debouncedKey,
    staleTime: 30_000,
    queryFn: async () => {
      const [source, signalTypes, requireEmail, crit, listId] = JSON.parse(debouncedKey) as [
        AutoEnrollSource,
        string[] | null,
        boolean,
        SignalFilterCriteria,
        string | null,
      ];
      const { data, error } = await supabase.rpc(
        // @ts-expect-error Generated Supabase types update alongside the migration.
        "public_signal_auto_enroll_preview",
        {
          p_org: currentOrganization!.id,
          p_source: source,
          p_signal_types: signalTypes?.length ? signalTypes : null,
          p_require_email: requireEmail,
          p_criteria: crit,
          p_list_id: listId,
        },
      );
      if (error) throw error;
      // Double cast for the same reason as the queries above: the generated
      // types don't know this RPC until they're regenerated.
      return (data as unknown as number | null) ?? 0;
    },
  });
}

export function useDeleteAutoEnrollRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        // @ts-expect-error Generated Supabase types update alongside the migration.
        .from("public_signal_auto_enroll_rules")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [QUERY_KEY] });
      toast.success("Auto-add rule removed");
    },
    onError: (err: unknown) => toast.error(err instanceof Error ? err.message : "Could not delete rule"),
  });
}
