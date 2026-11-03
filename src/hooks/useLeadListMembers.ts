import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { EnrichmentFilters } from "@/types/enrichment-filters";
import type { QueryClient } from "@tanstack/react-query";

// Partial identity for avatar fallback
interface ContactIdentityPartial {
  id: string;
  channel: string;
  platform_user_id: string;
  platform_avatar_url: string | null;
}

export type OutreachStatus = 'unreached' | 'reached' | 'replied';
export type AiAnalysisStatus = 'not_analyzed' | 'analyzing' | 'analyzed' | 'failed';

export interface LeadListMember {
  id: string;
  list_id: string;
  contact_id: string;
  added_at: string;
  source_data: Record<string, unknown>;
  // Joined contact data
  contact?: {
    id: string;
    display_name: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    job_title: string | null;
    primary_email: string | null;
    primary_linkedin_url: string | null;
    avatar_url: string | null;
    lead_score: number;
    // Additional fields for inline editing
    company_website: string | null;
    primary_phone: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    tags: string[];
    source: string | null;
    status: 'active' | 'archived' | 'bounced' | 'unsubscribed' | 'do_not_contact';
    // Outreach and AI analysis status
    outreach_status: OutreachStatus;
    ai_analysis_status: AiAnalysisStatus;
    // Enrichment data from AI analysis
    enrichment_data: Record<string, unknown> | null;
    custom_fields: Record<string, unknown> | null;
    // SEG firewall provider (e.g. "Barracuda", "Mimecast")
    seg_provider: string | null;
    // When SEG check was last performed
    seg_checked_at: string | null;
    // Native email verification result. Populated by paths that don't write the
    // email_address_verifications cache (processing pipeline, imports, MCP/CLI),
    // so the "Email Verified" column falls back to this when the cache is empty.
    email_verification_status: string | null;
    email_verification_source: string | null;
    email_verified_at: string | null;
    // Identities for avatar fallback
    identities?: ContactIdentityPartial[];
  };
}

export interface AddMemberInput {
  list_id: string;
  contact_id: string;
  source_data?: Record<string, unknown>;
}

export interface BulkAddMembersInput {
  list_id: string;
  contact_ids: string[];
  onProgress?: (processed: number, total: number) => void;
  /**
   * "Select all matching" path: instead of chunking contact_ids from the
   * client, add every member of source_list_id that matches these filters,
   * resolved server-side by bulk-add-to-list.
   */
  source_list_id?: string;
  filters?: Record<string, unknown>;
}

export interface LeadListMembersFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  // Optional polling interval (ms) — used to refresh rows during active analysis
  refetchInterval?: number | false;
  // Enrichment / ICP filters (same as AdvancedFilters panel)
  enrichmentFilters?: EnrichmentFilters;
}

export interface PaginatedLeadListMembers {
  data: LeadListMember[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

// Drift guard: every EnrichmentFilters key must be acknowledged by this engine.
// If a field is added to src/types/enrichment-filters.ts without being wired
// into buildRpcFilters + hasActiveEnrichmentFilters below AND the
// filter_lead_list_members SQL RPC, add it here ONLY after wiring — this
// constant failing the build is the signal that the new filter would
// otherwise be silently dead on static lead lists.
const _LEAD_LIST_ENGINE_HANDLES = {
  industries: true, companySizes: true, minEmployeeCount: true, maxEmployeeCount: true, seniorities: true, departments: true,
  technologies: true, emailVerified: true, emailQuality: true,
  minEmailConfidence: true, emailType: true, countries: true, cities: true,
  hasEnrichmentData: true, icpProductId: true, minIcpScore: true,
  maxIcpScore: true, minDmScore: true, maxDmScore: true, isB2b: true,
  revenueModels: true, hasOutboundMotion: true, hiringSalesRoles: true,
  runsAds: true, detectedTechnologies: true, detectedTechMatchAll: true,
  excludedTechnologies: true, customQuestions: true, customFieldConditions: true,
  hasNotionUrl: true, hasEmail: true, segFirewall: true, aiAnalysisStatus: true,
} as const satisfies Record<keyof EnrichmentFilters, true>;
void _LEAD_LIST_ENGINE_HANDLES;

/**
 * Build the filters JSONB payload for the server-side RPC from EnrichmentFilters + search.
 */
export function buildRpcFilters(search: string | undefined, ef: EnrichmentFilters | undefined): Record<string, unknown> {
  const filters: Record<string, unknown> = {};
  if (search) filters.search = search;
  if (!ef) return filters;

  if (ef.industries?.length) filters.industries = ef.industries;
  if (ef.companySizes?.length) filters.companySizes = ef.companySizes;
  if (ef.minEmployeeCount !== undefined) filters.minEmployeeCount = ef.minEmployeeCount;
  if (ef.maxEmployeeCount !== undefined) filters.maxEmployeeCount = ef.maxEmployeeCount;
  if (ef.seniorities?.length) filters.seniorities = ef.seniorities;
  if (ef.departments?.length) filters.departments = ef.departments;
  if (ef.technologies?.length) filters.technologies = ef.technologies;
  if (ef.emailVerified !== undefined) filters.emailVerified = ef.emailVerified;
  if (ef.emailQuality?.length) filters.emailQuality = ef.emailQuality;
  if (ef.minEmailConfidence !== undefined) filters.minEmailConfidence = ef.minEmailConfidence;
  if (ef.emailType) filters.emailType = ef.emailType;
  if (ef.hasEmail !== undefined) filters.hasEmail = ef.hasEmail;
  if (ef.countries?.length) filters.countries = ef.countries;
  if (ef.cities?.length) filters.cities = ef.cities;
  if (ef.hasEnrichmentData !== undefined) filters.hasEnrichmentData = ef.hasEnrichmentData;
  if (ef.icpProductId) filters.icpProductId = ef.icpProductId;
  if (ef.minIcpScore !== undefined) filters.minIcpScore = ef.minIcpScore;
  if (ef.maxIcpScore !== undefined) filters.maxIcpScore = ef.maxIcpScore;
  if (ef.minDmScore !== undefined) filters.minDmScore = ef.minDmScore;
  if (ef.maxDmScore !== undefined) filters.maxDmScore = ef.maxDmScore;
  if (ef.isB2b !== undefined) filters.isB2b = ef.isB2b;
  if (ef.revenueModels?.length) filters.revenueModels = ef.revenueModels;
  if (ef.hasOutboundMotion !== undefined) filters.hasOutboundMotion = ef.hasOutboundMotion;
  if (ef.hiringSalesRoles !== undefined) filters.hiringSalesRoles = ef.hiringSalesRoles;
  if (ef.runsAds !== undefined) filters.runsAds = ef.runsAds;
  if (ef.detectedTechnologies?.length) {
    filters.detectedTechnologies = ef.detectedTechnologies;
    if (ef.detectedTechMatchAll) filters.detectedTechMatchAll = true;
  }
  if (ef.excludedTechnologies?.length) filters.excludedTechnologies = ef.excludedTechnologies;
  if (ef.customQuestions?.length) {
    const conds = ef.customQuestions
      .filter((c) => c.question)
      .map((c) => (c.minScore ? { question: c.question, minScore: c.minScore } : { question: c.question }));
    if (conds.length) filters.customQuestions = conds;
  }
  if (ef.customFieldConditions?.length) {
    const conds = ef.customFieldConditions.filter(
      (c) => c.fieldKey && !((c.operator === 'equals' || c.operator === 'contains') && !c.value),
    );
    if (conds.length) filters.customFieldConditions = conds;
  }
  if (ef.hasNotionUrl !== undefined) filters.hasNotionUrl = ef.hasNotionUrl;
  if (ef.segFirewall) filters.segFirewall = ef.segFirewall;
  if (ef.aiAnalysisStatus) filters.aiAnalysisStatus = ef.aiAnalysisStatus;

  return filters;
}

/**
 * True when any Advanced Filters field is active. Shared by useLeadListMembers
 * and useFetchAllListMemberIds so the "switch to the server-side RPC" decision
 * can't drift between the table and the select-all path.
 */
function hasActiveEnrichmentFilters(ef: EnrichmentFilters | undefined): boolean {
  if (!ef) return false;
  return !!(
    ef.industries?.length ||
    ef.companySizes?.length ||
    ef.minEmployeeCount !== undefined ||
    ef.maxEmployeeCount !== undefined ||
    ef.seniorities?.length ||
    ef.departments?.length ||
    ef.technologies?.length ||
    ef.emailVerified !== undefined ||
    ef.emailQuality?.length ||
    ef.minEmailConfidence !== undefined ||
    ef.emailType ||
    ef.hasEmail !== undefined ||
    ef.countries?.length ||
    ef.cities?.length ||
    ef.hasEnrichmentData !== undefined ||
    ef.icpProductId !== undefined ||
    ef.isB2b !== undefined ||
    ef.revenueModels?.length ||
    ef.hasOutboundMotion !== undefined ||
    ef.hiringSalesRoles !== undefined ||
    ef.runsAds !== undefined ||
    ef.detectedTechnologies?.length ||
    ef.excludedTechnologies?.length ||
    ef.customQuestions?.length ||
    ef.customFieldConditions?.length ||
    ef.hasNotionUrl !== undefined ||
    ef.segFirewall !== undefined ||
    ef.aiAnalysisStatus !== undefined
  );
}

export function useLeadListMembers(listId: string | undefined | null, filters?: LeadListMembersFilters) {
  const { currentOrganization } = useAuth();
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  // Debounce search so the RPC fires once per pause, not once per keystroke
  const search = useDebouncedValue(filters?.search, 300) || undefined;
  const ef = filters?.enrichmentFilters;

  // Check if any enrichment filters are active
  const hasEnrichmentFilters = hasActiveEnrichmentFilters(ef);

  const needsServerFilter = !!(search || hasEnrichmentFilters);

  // Stable serialized key for enrichment filters (avoids object reference changes triggering refetches)
  const enrichmentKey = hasEnrichmentFilters ? JSON.stringify(ef) : undefined;

  // ── Page query — returns the visible rows FAST ──────────────────────────
  // On the filtered path the RPC now pushes LIMIT/OFFSET into SQL (early-exit
  // via the added_at index) and returns total_count = NULL; the exact total is
  // resolved by the separate countQuery below so a 157k-member list paints in
  // ~60ms instead of running a ~38s full scan on every page turn.
  const pageQuery = useQuery({
    queryKey: ["lead-list-members", listId, { page, pageSize, search, enrichment: enrichmentKey }, currentOrganization?.id],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<{ data: LeadListMember[]; total: number | null }> => {
      if (!listId || !currentOrganization) return { data: [], total: 0 };

      // ================================================================
      // Server-side filtering via RPC (handles search + enrichment + ICP)
      // This avoids the broken client-side .in() approach that fails for
      // large lists (>1000 members) due to URL size limits.
      // ================================================================
      if (needsServerFilter) {
        const rpcFilters = buildRpcFilters(search, ef);

        const { data: rpcResult, error: rpcError } = await supabase
          .rpc('filter_lead_list_members', {
            p_list_id: listId,
            p_filters: rpcFilters,
            p_page: page,
            p_page_size: pageSize,
          });

        if (rpcError) throw rpcError;

        // RPC returns a single row with { members: JSONB[], total_count }.
        // total_count is NULL on the filtered path — countQuery owns the total.
        const row = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult;
        const membersJson = row?.members || [];
        const total = row?.total_count == null ? null : Number(row.total_count);

        // Transform RPC result to match LeadListMember shape
        const data: LeadListMember[] = membersJson.map((m: Record<string, unknown>) => ({
          id: m.member_id,
          list_id: m.list_id,
          contact_id: m.contact_id,
          added_at: m.added_at,
          source_data: m.source_data || {},
          contact: m.contact || undefined,
        }));

        return { data, total };
      }

      // ================================================================
      // Simple path — no filters, use standard PostgREST queries
      // (exact count is cheap here via an indexed count on list_id)
      // ================================================================
      const countQuery = supabase
        .from("lead_list_members")
        .select("id", { count: "exact" })
        .eq("list_id", listId)
        .limit(0);

      let query = supabase
        .from("lead_list_members")
        .select(`
          *,
          contact:crm_contacts(
            id,
            display_name,
            first_name,
            last_name,
            company,
            job_title,
            primary_email,
            primary_linkedin_url,
            instagram_url,
            avatar_url,
            lead_score,
            company_website,
            primary_phone,
            city,
            state,
            country,
            tags,
            source,
            status,
            outreach_status,
            ai_analysis_status,
            enrichment_data,
            custom_fields,
            seg_provider,
            seg_checked_at,
            email_verification_status,
            email_verification_source,
            email_verified_at,
            notion_preview_url,
            notion_page_id,
            identities:crm_contact_identities(
              id,
              channel,
              platform_user_id,
              platform_avatar_url
            )
          )
        `)
        .eq("list_id", listId)
        .order("added_at", { ascending: false })
        .order("id", { ascending: false });

      // Apply pagination
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;
      query = query.range(from, to);

      const [{ count, error: countError }, { data, error }] = await Promise.all([
        countQuery,
        query,
      ]);

      if (countError) throw countError;
      if (error) throw error;

      return { data: data as LeadListMember[], total: count ?? 0 };
    },
    enabled: !!listId && !!currentOrganization,
    refetchInterval: filters?.refetchInterval,
  });

  // ── Count query — exact total, resolved on its own ──────────────────────
  // Only for the filtered path (the simple path already returns an exact count
  // cheaply). Keyed on (list, filters) WITHOUT the page, so the expensive count
  // runs once per filter change and is reused across page turns.
  const countKeyQuery = useQuery({
    queryKey: ["lead-list-members-count", listId, { search, enrichment: enrichmentKey }, currentOrganization?.id],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<number> => {
      if (!listId || !currentOrganization) return 0;
      const rpcFilters = buildRpcFilters(search, ef);
      // @ts-expect-error — RPC defined in 20260716210000_fast_lead_list_pagination.sql
      const { data, error } = await supabase.rpc('count_filtered_lead_list_members', {
        p_list_id: listId,
        p_filters: rpcFilters,
      });
      if (error) throw error;
      return Number(data ?? 0);
    },
    enabled: !!listId && !!currentOrganization && needsServerFilter,
  });

  // ── Merge page rows + resolved total into the shape callers expect ──────
  const pageData = pageQuery.data;
  const total = needsServerFilter
    ? (countKeyQuery.data ?? 0)      // 0 while the exact count is still resolving
    : (pageData?.total ?? 0);
  const mergedData: PaginatedLeadListMembers | undefined = pageData
    ? {
        data: pageData.data,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      }
    : undefined;

  return {
    data: mergedData,
    isLoading: pageQuery.isLoading,
    isFetching: pageQuery.isFetching || countKeyQuery.isFetching,
    isError: pageQuery.isError || countKeyQuery.isError,
    error: pageQuery.error ?? countKeyQuery.error,
    refetch: pageQuery.refetch,
  };
}

export interface FetchAllListMemberIdsInput {
  listId: string;
  search?: string;
  enrichmentFilters?: EnrichmentFilters;
  /**
   * Cap the number of ids resolved. Used by "Select first N" so it fetches
   * only the first N (ordered by added_at DESC, matching the table) instead of
   * pulling the entire filtered set (~38s on a 157k list) and slicing.
   */
  limit?: number;
}

/**
 * Fetch all contact IDs in a static list (no pagination).
 * Used for "Select all X contacts" across pages.
 * When search or enrichment filters are active, uses the server-side RPC
 * to return only the matching IDs.
 */
export function useFetchAllListMemberIds() {
  return useMutation({
    mutationFn: async (input: FetchAllListMemberIdsInput): Promise<string[]> => {
      const { listId, search, enrichmentFilters, limit } = input;

      const hasEnrichment = hasActiveEnrichmentFilters(enrichmentFilters);

      // "Select first N" must also use the bounded server-side path when no
      // filters are active. Fetching every ID and slicing client-side times
      // out on large lists before verification can ever start.
      const needsServerFilter = !!(search || hasEnrichment || limit !== undefined);

      // When filters are active, resolve every matching contact_id in ONE call
      // via get_filtered_lead_list_member_ids (returns a JSONB array of ids).
      //
      // The old approach paged filter_lead_list_members with PAGE_SIZE=1000,
      // but that RPC recomputes the FULL filtered set on every page — so a
      // 157k-member list issued ~158 calls, each a ~38s full scan, and select-all
      // never finished. The single-shot RPC does the scan once and mirrors the
      // same WHERE predicate (see 20260716200000), so the ids match the table.
      if (needsServerFilter) {
        const rpcFilters = buildRpcFilters(search, enrichmentFilters);

        // @ts-expect-error — RPC defined in 20260620050000 / hardened 20260716200000 / p_limit added 20260716230000
        const { data: ids, error } = await supabase.rpc('get_filtered_lead_list_member_ids', {
          p_list_id: listId,
          p_filters: rpcFilters,
          // "Select first N" passes limit so we resolve only the first N ordered
          // ids server-side (early-exits) instead of the whole filtered set.
          p_limit: limit ?? null,
        });

        if (error) throw error;
        return Array.isArray(ids) ? (ids as string[]) : [];
      }

      // No filters — pull every member ID in one round-trip via the
      // get_lead_list_member_ids RPC. Returns a JSONB array, which bypasses
      // PostgREST's per-request row cap (db_max_rows = 1000) that would
      // otherwise silently truncate a 79k-row list to 1000.
      // @ts-expect-error — RPC defined in 20260606020000_get_lead_list_member_ids.sql
      const { data: ids, error } = await supabase.rpc('get_lead_list_member_ids', {
        p_list_id: listId,
      });
      if (error) throw error;
      return Array.isArray(ids) ? (ids as string[]) : [];
    },
  });
}

export function useAddLeadListMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: AddMemberInput) => {
      const { data, error } = await supabase
        .from("lead_list_members")
        .insert([{
          list_id: input.list_id,
          contact_id: input.contact_id,
          source_data: (input.source_data || {}) as Record<string, never>,
        }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-members", variables.list_id] });
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
    },
    onError: (error) => {
      // Ignore duplicate key errors (contact already in list)
      if (error.message.includes("duplicate key")) {
        return;
      }
      toast.error(`Failed to add contact to list: ${error.message}`);
    },
  });
}

/** Contacts per edge function call — each call batches internally at 50 */
const BULK_ADD_CHUNK_SIZE = 200;

export function useBulkAddLeadListMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: BulkAddMembersInput) => {
      const { list_id, contact_ids, onProgress, source_list_id, filters } = input;

      // Filter-based "select all matching": one server-side call, no id payload.
      if (source_list_id && filters && contact_ids.length === 0) {
        const { data, error } = await supabase.functions.invoke('bulk-add-to-list', {
          body: { listId: list_id, sourceListId: source_list_id, filters },
        });
        if (error) throw error;
        if (data?.success === false) throw new Error(data.error || 'Failed to add contacts');
        return { inserted: data?.inserted ?? 0 };
      }

      let totalInserted = 0;

      for (let i = 0; i < contact_ids.length; i += BULK_ADD_CHUNK_SIZE) {
        const chunk = contact_ids.slice(i, i + BULK_ADD_CHUNK_SIZE);

        const { data, error } = await supabase.functions.invoke('bulk-add-to-list', {
          body: { listId: list_id, contactIds: chunk },
        });

        if (error) throw error;
        if (data?.success === false) throw new Error(data.error || 'Failed to add contacts');

        totalInserted += data?.inserted ?? chunk.length;
        onProgress?.(Math.min(i + chunk.length, contact_ids.length), contact_ids.length);
      }

      return { inserted: totalInserted };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["lead-list-members", variables.list_id] });
      queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
    },
    onError: (error) => {
      toast.error(`Failed to add contacts to list: ${error.message}`);
    },
  });
}

function invalidateLeadListMembershipQueries(queryClient: QueryClient, listId: string) {
  queryClient.invalidateQueries({ queryKey: ["lead-list-members", listId] });
  queryClient.invalidateQueries({ queryKey: ["lead-list-members-count", listId] });
  queryClient.invalidateQueries({ queryKey: ["lead-lists"] });
  queryClient.invalidateQueries({ queryKey: ["lead-list-channel-stats", listId] });
  queryClient.invalidateQueries({ queryKey: ["lead-lists-channel-stats"] });
  queryClient.invalidateQueries({ queryKey: ["contact-list-memberships"] });
}

export function useRemoveLeadListMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, contactId }: { listId: string; contactId: string }) => {
      // Use the same org-validated RPC as bulk removal and verify it changed a row.
      // @ts-expect-error - RPC exists after migration 20260310100000
      const { data, error } = await supabase.rpc('bulk_remove_list_members', {
        p_list_id: listId,
        p_contact_ids: [contactId],
      });
      if (error) throw error;
      if (typeof data !== "number" || data === 0) {
        throw new Error("No contact was removed. Refresh the list and try again.");
      }
      return data;
    },
    onSuccess: (_, variables) => {
      invalidateLeadListMembershipQueries(queryClient, variables.listId);
      toast.success("Contact removed from list");
    },
    onError: (error) => {
      toast.error(`Failed to remove contact: ${error.message}`);
    },
  });
}

export function useBulkRemoveLeadListMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, contactIds }: { listId: string; contactIds: string[] }) => {
      // Single RPC call — SECURITY DEFINER bypasses RLS overhead.
      // The statement-level trigger handles count update in one batch.
      // @ts-expect-error - RPC exists after migration 20260310100000
      const { data, error } = await supabase.rpc('bulk_remove_list_members', {
        p_list_id: listId,
        p_contact_ids: contactIds,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (removed, variables) => {
      invalidateLeadListMembershipQueries(queryClient, variables.listId);
      if (removed === 0) {
        toast.warning("No contacts were removed. Refresh the list and try again.");
      } else {
        toast.success(`Removed ${removed} contacts from list`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to remove contacts: ${error.message}`);
    },
  });
}

/**
 * Filter-based sibling of useBulkRemoveLeadListMembers. Used by the
 * "select all matching" path so we don't ship thousands of UUIDs to the
 * server — the same Advanced Filters JSON that drives the table is resolved
 * server-side by bulk_remove_filtered_list_members (migration 20260714120000).
 */
export function useBulkRemoveFilteredLeadListMembers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ listId, filters }: { listId: string; filters: Record<string, unknown> }) => {
      // @ts-expect-error - RPC exists after migration 20260714120000 (not yet in generated types)
      const { data, error } = await supabase.rpc('bulk_remove_filtered_list_members', {
        p_list_id: listId,
        p_filters: filters,
      });
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
    onSuccess: (removed, variables) => {
      invalidateLeadListMembershipQueries(queryClient, variables.listId);
      if (removed === 0) {
        toast.warning("No contacts were removed. Refresh the list and try again.");
      } else {
        toast.success(`Removed ${removed} contacts from list`);
      }
    },
    onError: (error) => {
      toast.error(`Failed to remove contacts: ${error.message}`);
    },
  });
}
