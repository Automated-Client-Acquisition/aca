import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { SmartListFilterCriteria } from "@/hooks/useLeadLists";
import type { CrmContact } from "@/hooks/crm/useContacts";

export interface UseSmartListContactsOptions {
  page?: number;
  pageSize?: number;
  sortBy?: "display_name" | "created_at" | "last_activity_at" | "lead_score";
  sortDirection?: "asc" | "desc";
  search?: string;
  /** Applied in addition to, never in place of, the saved segment criteria. */
  viewCriteria?: SmartListFilterCriteria;
  refetchInterval?: number | false;
}

export interface SmartListContactsResult {
  data: CrmContact[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface SegmentPage {
  contacts: CrmContact[];
  ids: string[];
  total: number;
  page: number;
  page_size: number;
}

async function fetchSegmentPage(
  organizationId: string,
  listId: string | null,
  options: UseSmartListContactsOptions = {},
  criteria?: SmartListFilterCriteria,
  idsOnly = false,
): Promise<SegmentPage> {
  const args = {
    p_org_id: organizationId,
    p_list_id: listId,
    p_criteria: criteria ?? {},
    p_view_criteria: options.viewCriteria ?? {},
    p_search: options.search?.trim() || null,
    p_page: Math.max(1, options.page ?? 1),
    p_page_size: Math.min(1000, Math.max(1, options.pageSize ?? 50)),
    p_sort: options.sortBy ?? "created_at",
    p_direction: options.sortDirection ?? "desc",
    p_ids_only: idsOnly,
  };
  // @ts-expect-error Added by the canonical smart segment membership migration.
  const { data, error } = await supabase.rpc("smart_segment_contact_page", args);
  if (error) throw error;
  return data as unknown as SegmentPage;
}

function contactResult(result: SegmentPage): SmartListContactsResult {
  return {
    data: result.contacts ?? [],
    total: result.total,
    page: result.page,
    pageSize: result.page_size,
    totalPages: Math.ceil(result.total / result.page_size),
  };
}

/** Flat and nested segments use the same saved predicate, search and view filters. */
export function useSmartListContacts(listId: string | null, options?: UseSmartListContactsOptions) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["smart-list-contacts", listId, options, currentOrganization?.id],
    queryFn: async (): Promise<SmartListContactsResult> => {
      if (!listId || !currentOrganization) throw new Error("No smart segment selected");
      return contactResult(await fetchSegmentPage(currentOrganization.id, listId, options));
    },
    enabled: !!listId && !!currentOrganization,
    refetchInterval: options?.refetchInterval,
  });
}

export interface SmartListContactIdsInput extends Omit<UseSmartListContactsOptions, "page" | "pageSize" | "refetchInterval"> {
  listId: string;
  /** Omit to select all matches; first N respects the table's exact ordering. */
  limit?: number;
}

/**
 * Resolve bulk selections in bounded pages of the same SQL membership query.
 * JSON pages avoid PostgREST's set-returning max_rows truncation at 1,000 IDs.
 */
export function useFetchSmartListContactIds() {
  const { currentOrganization } = useAuth();
  return useMutation({
    mutationFn: async ({ listId, limit, ...options }: SmartListContactIdsInput): Promise<string[]> => {
      if (!currentOrganization) throw new Error("No organization selected");
      const maxIds = limit === undefined ? Infinity : Math.max(0, Math.floor(limit));
      if (maxIds === 0) return [];
      const pageSize = Math.min(1000, maxIds);
      const ids = new Set<string>();
      let page = 1;
      while (ids.size < maxIds) {
        const result = await fetchSegmentPage(currentOrganization.id, listId, {
          ...options, page, pageSize,
        }, undefined, true);
        for (const id of result.ids ?? []) {
          ids.add(id);
          if (ids.size >= maxIds) break;
        }
        if (!result.ids?.length || result.ids.length < pageSize || page * pageSize >= result.total) break;
        page++;
      }
      return [...ids];
    },
  });
}

/** Unsaved previews use the same predicate core and page/count contract. */
export function useFilteredContacts(criteria: SmartListFilterCriteria | null, options?: UseSmartListContactsOptions) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["filtered-contacts", criteria, options, currentOrganization?.id],
    queryFn: async (): Promise<SmartListContactsResult> => {
      if (!criteria || !currentOrganization) throw new Error("No segment criteria selected");
      return contactResult(await fetchSegmentPage(currentOrganization.id, null, options, criteria));
    },
    enabled: !!currentOrganization && !!criteria && Object.keys(criteria).length > 0,
    staleTime: 10000,
    refetchInterval: options?.refetchInterval,
  });
}
