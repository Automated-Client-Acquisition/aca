import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { CrmPipeline, CrmPipelineStage } from "./useContacts";

// crm_deals / crm_deal_report aren't in the generated types yet.
const db = supabase as unknown as SupabaseClient;

// ============================================================================
// Types
// ============================================================================

export type DealStatus = "open" | "won" | "lost";

export interface CrmDeal {
  id: string;
  organization_id: string;
  pipeline_id: string;
  stage_id: string;
  name: string;
  value: number;
  currency: string;
  confidence: number | null;
  expected_close_date: string | null;
  status: DealStatus;
  lost_reason: string | null;
  closed_at: string | null;
  contact_id: string | null;
  company_id: string | null;
  owner_user_id: string | null;
  created_by: string | null;
  description: string | null;
  source: string | null;
  position: number;
  stage_entered_at: string;
  created_at: string;
  updated_at: string;
  contact?: {
    id: string;
    display_name: string;
    avatar_url: string | null;
    company: string | null;
    job_title: string | null;
    primary_email: string | null;
  } | null;
  company?: {
    id: string;
    name: string;
    domain: string | null;
    logo_url: string | null;
  } | null;
}

export interface DealPipeline extends CrmPipeline {
  stages: CrmPipelineStage[];
}

export interface DealFilters {
  pipelineId?: string | null;
  ownerUserId?: string | null;
  search?: string;
  status?: DealStatus | "all";
}

export interface DealInput {
  pipeline_id: string;
  stage_id: string;
  name: string;
  value?: number;
  currency?: string;
  confidence?: number | null;
  expected_close_date?: string | null;
  contact_id?: string | null;
  company_id?: string | null;
  owner_user_id?: string | null;
  description?: string | null;
  source?: string | null;
  lost_reason?: string | null;
}

export interface DealReport {
  summary: {
    open_count: number;
    open_value: number;
    weighted_value: number;
    won_count: number;
    won_value: number;
    lost_count: number;
    lost_value: number;
    win_rate: number | null;
    avg_won_value: number | null;
    avg_cycle_days: number | null;
    overdue_count: number;
  };
  by_stage: Array<{
    stage_id: string;
    name: string;
    color: string;
    stage_type: string;
    win_probability: number | null;
    count: number;
    value: number;
    weighted: number;
    avg_days_in_stage: number | null;
  }>;
  forecast: Array<{ month: string | null; count: number; value: number; weighted: number }>;
  won_by_month: Array<{ month: string; won_count: number; won_value: number; lost_count: number }>;
  by_owner: Array<{
    owner_user_id: string | null;
    name: string;
    open_count: number;
    open_value: number;
    weighted: number;
    won_count: number;
    won_value: number;
    lost_count: number;
    win_rate: number | null;
  }>;
  lost_reasons: Array<{ reason: string; count: number; value: number }>;
}

const DEAL_SELECT = `
  *,
  contact:crm_contacts(id, display_name, avatar_url, company, job_title, primary_email),
  company:crm_companies(id, name, domain, logo_url)
`;

// PostgREST caps a response at 1000 rows, so page through.
const PAGE_SIZE = 1000;
const MAX_DEALS = 10000;

/** Deal confidence: its own, else the stage default. */
export function dealProbability(deal: Pick<CrmDeal, "confidence">, stage?: Pick<CrmPipelineStage, "win_probability">) {
  return deal.confidence ?? stage?.win_probability ?? 0;
}

// en-US like the rest of the app's analytics ("$105K", not "105 k $US").
export function formatMoney(value: number, currency = "USD", compact = false) {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: compact || value >= 1000 ? 0 : 2,
      notation: compact ? "compact" : "standard",
    }).format(value || 0);
  } catch {
    return `${currency} ${Math.round(value || 0).toLocaleString()}`;
  }
}

// ============================================================================
// Pipelines
// ============================================================================

/**
 * Deal pipelines with stages. Seeds the default sales pipeline the first time an
 * org opens it. Keyed under 'crm-pipelines' so the existing stage/pipeline
 * mutations in usePipeline.ts invalidate it.
 */
export function useDealPipelines() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["crm-pipelines", "deals", currentOrganization?.id],
    queryFn: async (): Promise<DealPipeline[]> => {
      const orgId = currentOrganization!.id;

      const load = async () => {
        const { data, error } = await db
          .from("crm_pipelines")
          .select("*, stages:crm_pipeline_stages(*)")
          .eq("organization_id", orgId)
          .order("is_default", { ascending: false })
          .order("created_at", { ascending: true });
        if (error) throw error;
        return (data || []) as DealPipeline[];
      };

      let pipelines = await load();
      if (pipelines.length === 0) {
        const { error } = await db.rpc("create_default_pipeline_for_org", { p_org_id: orgId });
        if (error) throw error;
        pipelines = await load();
      }

      return pipelines.map((p) => ({
        ...p,
        stages: [...(p.stages || [])].sort((a, b) => a.stage_order - b.stage_order),
      }));
    },
    enabled: !!currentOrganization,
    staleTime: 60000,
  });
}

export type PipelineTemplate = "sales" | "blank" | "copy";

/** Create a pipeline with its stages in one call (crm_create_pipeline). Returns the new id. */
export function useCreateDealPipeline() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; template: PipelineTemplate; copyFrom?: string | null }) => {
      const { data, error } = await db.rpc("crm_create_pipeline", {
        p_org_id: currentOrganization!.id,
        p_name: input.name,
        p_template: input.template,
        p_copy_from: input.template === "copy" ? input.copyFrom ?? null : null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-pipelines"] });
      toast.success("Pipeline created");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create pipeline");
    },
  });
}

export function useSetDefaultDealPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pipelineId: string) => {
      const { error } = await db.rpc("crm_set_default_pipeline", { p_pipeline_id: pipelineId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["crm-default-pipeline"] });
      toast.success("Default pipeline updated");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update default pipeline");
    },
  });
}

/** Refused server-side while the pipeline has deals or is the org's last one. */
export function useDeleteDealPipeline() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (pipelineId: string) => {
      const { error } = await db.rpc("crm_delete_pipeline", { p_pipeline_id: pipelineId });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-pipelines"] });
      queryClient.invalidateQueries({ queryKey: ["crm-default-pipeline"] });
      queryClient.invalidateQueries({ queryKey: ["crm-deal-report"] });
      toast.success("Pipeline deleted");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete pipeline");
    },
  });
}

// ============================================================================
// Deals
// ============================================================================

export function useDeals(filters: DealFilters) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["crm-deals", currentOrganization?.id, filters],
    queryFn: async (): Promise<CrmDeal[]> => {
      const all: CrmDeal[] = [];
      for (let from = 0; from < MAX_DEALS; from += PAGE_SIZE) {
        let q = db
          .from("crm_deals")
          .select(DEAL_SELECT)
          .eq("organization_id", currentOrganization!.id)
          .order("position", { ascending: true })
          .order("created_at", { ascending: false })
          .range(from, from + PAGE_SIZE - 1);

        if (filters.pipelineId) q = q.eq("pipeline_id", filters.pipelineId);
        if (filters.ownerUserId) q = q.eq("owner_user_id", filters.ownerUserId);
        if (filters.status && filters.status !== "all") q = q.eq("status", filters.status);
        if (filters.search?.trim()) q = q.ilike("name", `%${filters.search.trim()}%`);

        const { data, error } = await q;
        if (error) throw error;
        all.push(...((data || []) as CrmDeal[]));
        if (!data || data.length < PAGE_SIZE) break;
      }
      return all;
    },
    enabled: !!currentOrganization && !!filters.pipelineId,
  });
}

/** Deals linked to a contact or company (for the detail pages). */
export function useLinkedDeals(link: { contactId?: string | null; companyId?: string | null }) {
  const { currentOrganization } = useAuth();
  const { contactId, companyId } = link;

  return useQuery({
    queryKey: ["crm-deals", currentOrganization?.id, "linked", contactId ?? null, companyId ?? null],
    queryFn: async (): Promise<CrmDeal[]> => {
      let q = db
        .from("crm_deals")
        .select(DEAL_SELECT)
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false })
        .limit(200);
      if (contactId) q = q.eq("contact_id", contactId);
      if (companyId) q = q.eq("company_id", companyId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as CrmDeal[];
    },
    enabled: !!currentOrganization && !!(contactId || companyId),
  });
}

export function useDealHistory(dealId: string | null) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["crm-deal-history", currentOrganization?.id, dealId],
    queryFn: async () => {
      const { data, error } = await db
        .from("crm_deal_stage_history")
        .select("id, from_stage_id, to_stage_id, value, changed_by, changed_at")
        .eq("deal_id", dealId)
        .order("changed_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as Array<{
        id: string;
        from_stage_id: string | null;
        to_stage_id: string | null;
        value: number | null;
        changed_by: string | null;
        changed_at: string;
      }>;
    },
    enabled: !!currentOrganization && !!dealId,
  });
}

function invalidateDeals(queryClient: ReturnType<typeof useQueryClient>) {
  queryClient.invalidateQueries({ queryKey: ["crm-deals"] });
  queryClient.invalidateQueries({ queryKey: ["crm-deal-report"] });
  queryClient.invalidateQueries({ queryKey: ["crm-deal-history"] });
}

export function useCreateDeal() {
  const { user, currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: DealInput) => {
      // New deals go to the top of their column.
      const { data: first } = await db
        .from("crm_deals")
        .select("position")
        .eq("organization_id", currentOrganization!.id)
        .eq("stage_id", input.stage_id)
        .order("position", { ascending: true })
        .limit(1);
      const position = first?.[0] ? first[0].position - 1 : 0;

      const { data, error } = await db
        .from("crm_deals")
        .insert({
          ...input,
          organization_id: currentOrganization!.id,
          owner_user_id: input.owner_user_id === undefined ? user?.id : input.owner_user_id,
          created_by: user?.id,
          position,
        })
        .select(DEAL_SELECT)
        .single();
      if (error) throw error;
      return data as CrmDeal;
    },
    onSuccess: () => {
      invalidateDeals(queryClient);
      toast.success("Deal created");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create deal");
    },
  });
}

export function useUpdateDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...input }: Partial<DealInput> & { id: string }) => {
      const { data, error } = await db
        .from("crm_deals")
        .update(input)
        .eq("id", id)
        .select(DEAL_SELECT)
        .single();
      if (error) throw error;
      return data as CrmDeal;
    },
    onSuccess: () => {
      invalidateDeals(queryClient);
      toast.success("Deal saved");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to save deal");
    },
  });
}

/**
 * Move a deal on the board (stage and/or position). Optimistic, so the card
 * stays where it was dropped while the write lands.
 */
export function useMoveDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    // status is optimistic-only: the DB trigger derives it from the stage.
    mutationFn: async (move: {
      id: string;
      stage_id: string;
      position: number;
      lost_reason?: string | null;
      status?: DealStatus;
    }) => {
      const { id, status, ...patch } = move;
      const { error } = await db.from("crm_deals").update(patch).eq("id", id);
      if (error) throw error;
    },
    onMutate: async (move) => {
      await queryClient.cancelQueries({ queryKey: ["crm-deals"] });
      const snapshots = queryClient.getQueriesData<CrmDeal[]>({ queryKey: ["crm-deals"] });
      for (const [key, deals] of snapshots) {
        if (!Array.isArray(deals)) continue;
        queryClient.setQueryData<CrmDeal[]>(
          key,
          deals.map((d) =>
            d.id === move.id
              ? { ...d, stage_id: move.stage_id, position: move.position, status: move.status ?? d.status }
              : d,
          ),
        );
      }
      return { snapshots };
    },
    onError: (error, _move, context) => {
      for (const [key, deals] of context?.snapshots ?? []) queryClient.setQueryData(key, deals);
      toast.error(error instanceof Error ? error.message : "Failed to move deal");
    },
    onSettled: () => invalidateDeals(queryClient),
  });
}

export function useDeleteDeal() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("crm_deals").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      invalidateDeals(queryClient);
      toast.success("Deal deleted");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete deal");
    },
  });
}

// ============================================================================
// Reporting
// ============================================================================

export function useDealReport(params: { pipelineId?: string | null; from: Date; to: Date; ownerUserId?: string | null }) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: [
      "crm-deal-report",
      currentOrganization?.id,
      params.pipelineId ?? null,
      params.from.toISOString(),
      params.to.toISOString(),
      params.ownerUserId ?? null,
    ],
    queryFn: async (): Promise<DealReport> => {
      const { data, error } = await db.rpc("crm_deal_report", {
        p_org_id: currentOrganization!.id,
        p_pipeline_id: params.pipelineId ?? null,
        p_from: params.from.toISOString(),
        p_to: params.to.toISOString(),
        p_owner_user_id: params.ownerUserId ?? null,
      });
      if (error) throw error;
      return data as DealReport;
    },
    enabled: !!currentOrganization,
  });
}
