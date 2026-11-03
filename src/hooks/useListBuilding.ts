import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export type ListBuildingJobStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

export type FitLabel = "Strong" | "Good" | "Weak" | "Disqualify";

export interface ListBuildingJob {
  id: string;
  organization_id: string;
  name: string;
  status: ListBuildingJobStatus;
  icp_id: string | null;
  query: {
    niche?: string;
    geo?: string;
    employee_range?: string;
    sources?: string[];
  };
  target_list_id: string | null;
  worker_config: {
    discovery?: number;
    dm?: number;
    pattern?: number;
    smtp?: number;
    icp?: number;
  };
  progress: number;
  total_companies: number;
  found_dms: number;
  verified_emails: number;
  strong_leads: number;
  error_message: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  metadata: Record<string, unknown>;
}

export interface EnrichedLead {
  id: string;
  job_id: string;
  verified_email: string;
  email_status: string;
  icp_score: number;
  fit_label: FitLabel;
  score_breakdown: Record<string, unknown>;
  claude_reasoning: string | null;
  exported_lead_id: string | null;
  exported_at: string | null;
  created_at: string;
  // joined
  company?: {
    id: string;
    company_name: string;
    domain: string | null;
    website_url: string | null;
  } | null;
  dm?: {
    id: string;
    first_name: string;
    last_name: string | null;
    title: string | null;
    linkedin_url: string | null;
  } | null;
}

export interface CreateListBuildingJobInput {
  name: string;
  icp_id: string | null;
  query: {
    niche: string;
    geo: string;
    employee_range?: string;
    sources: string[];
  };
  target_list_id: string | null;
  worker_config: {
    discovery: number;
    dm: number;
    pattern: number;
    smtp: number;
    icp: number;
  };
}

export interface ListBuildingLeadFilters {
  fit_label?: FitLabel | null;
  page?: number;
  pageSize?: number;
}

export interface ProxyPoolEntry {
  id: string;
  organization_id: string | null;
  provider: "brightdata" | "smartproxy" | "oxylabs" | "custom";
  proxy_type: "datacenter" | "residential" | "dedicated_smtp";
  host: string;
  port: number;
  active: boolean;
  success_count: number;
  fail_count: number;
  last_used_at: string | null;
  last_failed_at: string | null;
  retired_at: string | null;
  created_at: string;
}

export interface UpsertProxyInput {
  id?: string;
  provider: ProxyPoolEntry["provider"];
  proxy_type: ProxyPoolEntry["proxy_type"];
  host: string;
  port: number;
  username?: string;
  password?: string;
  active?: boolean;
  retired?: boolean;
}

// -----------------------------------------------------------------------------
// Jobs
// -----------------------------------------------------------------------------
export function useListBuildingJobs() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["list-building-jobs", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("list_building_jobs" as never)
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return (data || []) as unknown as ListBuildingJob[];
    },
    enabled: !!currentOrganization,
    refetchInterval: 10000,
  });
}

export function useListBuildingJob(jobId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["list-building-job", jobId, currentOrganization?.id],
    queryFn: async () => {
      if (!jobId || !currentOrganization) return null;
      const { data, error } = await supabase
        .from("list_building_jobs" as never)
        .select("*")
        .eq("id", jobId)
        .eq("organization_id", currentOrganization.id)
        .maybeSingle();

      if (error) throw error;
      return data as unknown as ListBuildingJob | null;
    },
    enabled: !!jobId && !!currentOrganization,
    refetchInterval: (query) => {
      const job = query.state.data as ListBuildingJob | null | undefined;
      return job?.status === "running" || job?.status === "pending" ? 5000 : false;
    },
  });
}

export function useCreateListBuildingJob() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: CreateListBuildingJobInput) => {
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase.functions.invoke(
        "list-building-create-job",
        {
          body: {
            organization_id: currentOrganization.id,
            ...input,
          },
        }
      );

      if (error) throw error;
      return data as { job_id: string };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["list-building-jobs", currentOrganization?.id],
      });
      toast.success("List building job created");
    },
    onError: (error: Error) => {
      toast.error(`Failed to create job: ${error.message}`);
    },
  });
}

export function useStopListBuildingJob() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (jobId: string) => {
      const { data, error } = await supabase.functions.invoke(
        "list-building-stop-job",
        { body: { job_id: jobId } }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: (_, jobId) => {
      queryClient.invalidateQueries({
        queryKey: ["list-building-jobs", currentOrganization?.id],
      });
      queryClient.invalidateQueries({
        queryKey: ["list-building-job", jobId, currentOrganization?.id],
      });
      toast.success("Job stopped");
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop job: ${error.message}`);
    },
  });
}

// -----------------------------------------------------------------------------
// Enriched leads
// -----------------------------------------------------------------------------
export function useListBuildingLeads(
  jobId: string | undefined,
  filters: ListBuildingLeadFilters = {}
) {
  const { currentOrganization } = useAuth();
  const { fit_label, page = 0, pageSize = 50 } = filters;

  return useQuery({
    queryKey: [
      "list-building-leads",
      jobId,
      currentOrganization?.id,
      fit_label ?? null,
      page,
      pageSize,
    ],
    queryFn: async () => {
      if (!jobId || !currentOrganization) return { rows: [], count: 0 };

      let query = supabase
        .from("lb_enriched_leads" as never)
        .select(
          `
          *,
          company:lb_discovered_companies(id, company_name, domain, website_url),
          dm:lb_decision_makers(id, first_name, last_name, title, linkedin_url)
        `,
          { count: "exact" }
        )
        .eq("job_id", jobId)
        .eq("organization_id", currentOrganization.id)
        .order("icp_score", { ascending: false });

      if (fit_label) {
        query = query.eq("fit_label", fit_label);
      }

      const from = page * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;
      return {
        rows: (data || []) as unknown as EnrichedLead[],
        count: count ?? 0,
      };
    },
    enabled: !!jobId && !!currentOrganization,
    refetchInterval: 10000,
  });
}

// -----------------------------------------------------------------------------
// Discovered companies
// -----------------------------------------------------------------------------
export interface DiscoveredCompany {
  id: string;
  company_name: string;
  domain: string | null;
  website_url: string | null;
  linkedin_url: string | null;
  phone: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  employee_signal: string | null;
  source: string;
  scraped_at: string;
}

export function useDiscoveredCompanies(jobId: string | undefined) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["list-building-companies", jobId, currentOrganization?.id],
    queryFn: async () => {
      if (!jobId || !currentOrganization) return [];
      const { data, error } = await supabase
        .from("lb_discovered_companies" as never)
        .select("id, company_name, domain, website_url, linkedin_url, phone, city, state, country, employee_signal, source, scraped_at")
        .eq("job_id", jobId)
        .eq("organization_id", currentOrganization.id)
        .order("scraped_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []) as unknown as DiscoveredCompany[];
    },
    enabled: !!jobId && !!currentOrganization,
    refetchInterval: 10000,
  });
}

export function useExportListBuildingLeads() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: {
      job_id: string;
      fit_labels: FitLabel[];
      target_list_id: string;
    }) => {
      const { data, error } = await supabase.functions.invoke(
        "list-building-export",
        { body: input }
      );
      if (error) throw error;
      return data as { exported_count: number };
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: ["list-building-leads"],
      });
      queryClient.invalidateQueries({
        queryKey: ["lead-lists", currentOrganization?.id],
      });
      toast.success(
        `Exported ${data?.exported_count ?? 0} leads to lead list`
      );
    },
    onError: (error: Error) => {
      toast.error(`Failed to export: ${error.message}`);
    },
  });
}

// -----------------------------------------------------------------------------
// Cache
// -----------------------------------------------------------------------------
export interface CacheStats {
  total_domains: number;
  hit_rate: number;
  avg_confidence: number;
  by_tier: Array<{ tier: number; count: number }>;
}

export function useCacheStats() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["list-building-cache-stats", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization)
        return {
          total_domains: 0,
          hit_rate: 0,
          avg_confidence: 0,
          by_tier: [],
        } as CacheStats;

      const { data, error } = await supabase
        .from("domain_pattern_cache" as never)
        .select("tier, confidence, negative_result")
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;

      const rows = (data || []) as Array<{
        tier: number | null;
        confidence: number;
        negative_result: boolean;
      }>;
      const total = rows.length;
      const positives = rows.filter((r) => !r.negative_result);
      const avgConfidence =
        positives.length > 0
          ? Math.round(
              positives.reduce((s, r) => s + (r.confidence || 0), 0) /
                positives.length
            )
          : 0;
      const hitRate =
        total > 0 ? Math.round((positives.length / total) * 100) : 0;
      const tierMap = new Map<number, number>();
      positives.forEach((r) => {
        if (r.tier != null) tierMap.set(r.tier, (tierMap.get(r.tier) || 0) + 1);
      });
      const by_tier = Array.from(tierMap.entries())
        .map(([tier, count]) => ({ tier, count }))
        .sort((a, b) => a.tier - b.tier);

      return {
        total_domains: total,
        hit_rate: hitRate,
        avg_confidence: avgConfidence,
        by_tier,
      } as CacheStats;
    },
    enabled: !!currentOrganization,
  });
}

export function useInvalidateCachedDomain() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (domain: string) => {
      if (!currentOrganization) throw new Error("No organization context");
      const { error } = await supabase
        .from("domain_pattern_cache" as never)
        .delete()
        .eq("organization_id", currentOrganization.id)
        .eq("domain", domain);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["list-building-cache-stats", currentOrganization?.id],
      });
      toast.success("Domain cache invalidated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to invalidate domain: ${error.message}`);
    },
  });
}

// -----------------------------------------------------------------------------
// Proxy pool
// -----------------------------------------------------------------------------
export function useProxyPool() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["list-building-proxies", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];
      const { data, error } = await supabase
        .from("lb_proxy_pool" as never)
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data || []) as unknown as ProxyPoolEntry[];
    },
    enabled: !!currentOrganization,
  });
}

export function useUpsertProxy() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (input: UpsertProxyInput) => {
      if (!currentOrganization) throw new Error("No organization context");
      const { data, error } = await supabase.functions.invoke(
        "list-building-upsert-proxy",
        {
          body: {
            organization_id: currentOrganization.id,
            ...input,
          },
        }
      );
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["list-building-proxies", currentOrganization?.id],
      });
      toast.success("Proxy saved");
    },
    onError: (error: Error) => {
      toast.error(`Failed to save proxy: ${error.message}`);
    },
  });
}

// ============================================================================
// Domain index search (Phase 2 homepage enrichment)
// ============================================================================

export interface DomainSearchFilters {
  keywords?: string[];
  country?: string | null;
  state?: string | null;
  tech_stack?: string[];
  limit?: number;
  offset?: number;
}

export interface DomainIndexEntry {
  id: string;
  organization_id: string;
  domain: string;
  website_url: string | null;
  title: string | null;
  meta_description: string | null;
  country: string | null;
  state: string | null;
  city: string | null;
  address_raw: string | null;
  phone: string | null;
  email: string | null;
  tech_stack: string[];
  industry_keywords: string[];
  schema_org_type: string | null;
  employee_signal: string | null;
  enriched_at: string;
}

export function useDomainSearch(filters: DomainSearchFilters, enabled = true) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: [
      "domain-search",
      currentOrganization?.id,
      filters.keywords,
      filters.country,
      filters.state,
      filters.tech_stack,
      filters.limit,
      filters.offset,
    ],
    queryFn: async () => {
      if (!currentOrganization) return { domains: [], total: 0 };

      const { data, error } = await supabase.functions.invoke(
        "list-building-domain-search",
        {
          body: {
            keywords: filters.keywords ?? [],
            country: filters.country ?? null,
            state: filters.state ?? null,
            tech_stack: filters.tech_stack ?? [],
            limit: filters.limit ?? 100,
            offset: filters.offset ?? 0,
          },
        },
      );
      if (error) throw error;
      return data as { domains: DomainIndexEntry[]; total: number };
    },
    enabled: !!currentOrganization && enabled,
  });
}

// ============================================================================
// Throughput telemetry (ScrapeBox mode)
// ============================================================================

export interface ListBuildingStageThroughput {
  pending: number;
  in_flight: number;
  completed: number;
  failed: number;
  dead: number;
  per_sec: number;
}

export interface ListBuildingWorkerInfo {
  worker_id: string;
  kind: string;
  last_seen_at: string;
  current_job_id: string | null;
  in_flight_items: number;
  throughput_per_sec: number;
}

export interface ListBuildingMxHotspot {
  mx_host: string;
  attempts: number;
  successes: number;
  rate_limit_hits: number;
}

export interface ListBuildingThroughput {
  job_id: string;
  per_stage: Record<string, ListBuildingStageThroughput>;
  workers: ListBuildingWorkerInfo[];
  mx_hotspots: ListBuildingMxHotspot[];
  generated_at: string;
}

export function useListBuildingThroughput(jobId: string | null, enabled = true) {
  return useQuery({
    queryKey: ["list-building-throughput", jobId],
    queryFn: async () => {
      if (!jobId) throw new Error("jobId required");
      const { data, error } = await supabase.functions.invoke(
        `list-building-throughput?job_id=${jobId}`,
        { method: "GET" },
      );
      if (error) throw error;
      return data as ListBuildingThroughput;
    },
    enabled: !!jobId && enabled,
    refetchInterval: 2_000,
    staleTime: 0,
  });
}
