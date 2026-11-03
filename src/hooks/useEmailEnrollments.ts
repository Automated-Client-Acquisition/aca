import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { chunkedMutate } from "@/hooks/crm/useContacts";
import type { EmailSequenceEnrollment, EnrollmentStatus } from "@/types/email";
import { describeEmailEnrollmentResult, normalizeEmailEnrollmentResult } from "@/lib/email-enrollment-result";

// ============================================================================
// Queries
// ============================================================================

export interface EmailEnrollmentsFilters {
  page?: number;
  pageSize?: number;
  search?: string;
  statusFilter?: EnrollmentStatus | "all";
}

export interface PaginatedEmailEnrollments {
  data: EmailSequenceEnrollment[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function useEmailEnrollments(sequenceId: string | undefined, filters?: EmailEnrollmentsFilters) {
  const { currentOrganization } = useAuth();
  const page = filters?.page ?? 1;
  const pageSize = filters?.pageSize ?? 50;
  const search = filters?.search;
  const statusFilter = filters?.statusFilter ?? "all";

  return useQuery({
    queryKey: ["email-enrollments", sequenceId, { page, pageSize, search, statusFilter }, currentOrganization?.id],
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<PaginatedEmailEnrollments> => {
      if (!sequenceId || !currentOrganization) return { data: [], total: 0, page: 1, pageSize, totalPages: 0 };

      // Single server-side RPC handles search + status filter + pagination + all JOINs
      // @ts-ignore - RPC exists but not in generated types
      const { data, error } = await supabase.rpc("search_sequence_enrollments", {
        p_sequence_id: sequenceId,
        p_search: search || null,
        p_status: statusFilter === "all" ? null : statusFilter || null,
        p_page: page,
        p_page_size: pageSize,
      });

      if (error) throw error;

      const row = (data as any)?.[0] || { enrollments: [], total_count: 0 };
      const enrollments = (row.enrollments || []) as EmailSequenceEnrollment[];
      const total = Number(row.total_count) || 0;

      return {
        data: enrollments,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      };
    },
    enabled: !!sequenceId && !!currentOrganization,
  });
}

/**
 * Fetch all enrollment IDs matching the current search (no pagination).
 * Used for "Select all N" / "select first N" across pages, mirroring the
 * lists selection pattern. Pages through the same RPC the table uses so the
 * search filter is applied identically.
 */
export function useFetchAllEnrollmentIds() {
  return useMutation({
    mutationFn: async ({
      sequenceId,
      search,
    }: {
      sequenceId: string;
      search?: string;
    }): Promise<string[]> => {
      const PAGE_SIZE = 1000;
      const allIds: string[] = [];
      let page = 1;

      while (true) {
        // @ts-expect-error - RPC exists but not in generated types
        const { data, error } = await supabase.rpc("search_sequence_enrollments", {
          p_sequence_id: sequenceId,
          p_search: search || null,
          p_status: null,
          p_page: page,
          p_page_size: PAGE_SIZE,
        });

        if (error) throw error;

        const row = (data as { enrollments?: { id: string }[] }[] | null)?.[0] || { enrollments: [] };
        const enrollments = (row.enrollments || []) as { id: string }[];
        allIds.push(...enrollments.map((e) => e.id));

        if (enrollments.length < PAGE_SIZE) break;
        page++;
      }

      return allIds;
    },
  });
}

export function useEnrollmentCounts(sequenceId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["email-enrollment-counts", sequenceId, currentOrganization?.id],
    queryFn: async () => {
      if (!sequenceId || !currentOrganization) {
        return { total: 0, active: 0, paused: 0, completed: 0, replied: 0, bounced: 0 };
      }

      // Use server-side count queries — no row data transferred, scales to any size
      const STATUSES = ["active", "paused", "completed", "replied", "bounced"] as const;
      const [totalResult, ...statusResults] = await Promise.all([
        supabase
          .from("email_sequence_enrollments")
          .select("id", { count: "exact", head: true })
          .eq("sequence_id", sequenceId),
        ...STATUSES.map((s) =>
          supabase
            .from("email_sequence_enrollments")
            .select("id", { count: "exact", head: true })
            .eq("sequence_id", sequenceId)
            .eq("status", s)
        ),
      ]);

      for (const result of [totalResult, ...statusResults]) {
        if (result.error) throw result.error;
      }

      return {
        total: totalResult.count ?? 0,
        active: statusResults[0].count ?? 0,
        paused: statusResults[1].count ?? 0,
        completed: statusResults[2].count ?? 0,
        replied: statusResults[3].count ?? 0,
        bounced: statusResults[4].count ?? 0,
      };
    },
    enabled: !!sequenceId && !!currentOrganization,
  });
}

// ============================================================================
// Mutations
// ============================================================================

export function useEnrollLead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      sequence_id,
      lead_id,
    }: {
      sequence_id: string;
      lead_id: string;
    }) => {
      const { data, error } = await supabase
        .from("email_sequence_enrollments")
        .insert({
          sequence_id,
          lead_id,
          current_step: 0,
          status: "active",
          next_send_at: new Date().toISOString(),
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data as unknown as EmailSequenceEnrollment;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", data.sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", data.sequence_id] });
      toast.success("Lead enrolled in sequence");
    },
    onError: (error: Error) => {
      toast.error(`Failed to enroll lead: ${error.message}`);
    },
  });
}

/** Contacts per enroll-leads call; matches the edge function's list page. */
const ENROLL_PAGE_SIZE = 2500;

export function useBulkEnrollLeads() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({
      sequence_id,
      lead_ids,
      list_id,
      list_ids,
      filters,
      delay_hours,
    }: {
      sequence_id: string;
      lead_ids?: string[];
      list_id?: string; // legacy single list; prefer list_ids
      list_ids?: string[]; // enroll the union of several lists
      filters?: Record<string, unknown>; // "select all matching": enroll the filtered subset (single list only)
      delay_hours?: number;
    }) => {
      if (!currentOrganization) throw new Error("No organization");

      // Normalize to a list of list IDs (back-compat with single list_id).
      const listIds = Array.from(new Set([
        ...(list_ids || []),
        ...(list_id ? [list_id] : []),
      ].filter(Boolean)));

      // Delegate all heavy lifting to the enroll-leads edge function, one
      // page per call: a 50k audience in a single request dies with 546
      // (worker limit). Each page is a durable idempotent upsert, so a loop
      // that fails midway leaves correctly enrolled leads behind.
      // `filters` (select-all-matching) only applies to a single list.
      const invokePage = async (audience: Record<string, unknown>) => {
        const { data, error } = await supabase.functions.invoke("enroll-leads", {
          body: {
            sequenceId: sequence_id,
            organizationId: currentOrganization.id,
            ...audience,
            ...(delay_hours ? { delayHours: delay_hours } : {}),
          },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
        return data;
      };

      const total = normalizeEmailEnrollmentResult({});
      const add = (data: unknown) => {
        const page = normalizeEmailEnrollmentResult(data);
        for (const key of Object.keys(total) as (keyof typeof total)[]) total[key] += page[key];
      };

      if (listIds.length) {
        let listOffset = 0;
        for (;;) {
          const data = await invokePage({
            listIds,
            ...(listIds.length === 1 && filters ? { filters } : {}),
            listOffset,
          });
          add(data);
          const cursor = data?.sourceCursor as { offset: number; done: boolean } | undefined;
          // An older deployment ignores listOffset and enrolls everything at once.
          if (!cursor || cursor.done) break;
          listOffset = cursor.offset;
        }
      } else {
        const ids = lead_ids || [];
        for (let i = 0; i < Math.max(ids.length, 1); i += ENROLL_PAGE_SIZE) {
          add(await invokePage({ contactIds: ids.slice(i, i + ENROLL_PAGE_SIZE) }));
        }
      }
      return { ...total, sequence_id };
    },
    onSuccess: (result) => {
      const { sequence_id } = result;
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-sequences"] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-preview"] });
      const outcome = describeEmailEnrollmentResult(result);
      const options = { description: outcome.description || undefined, duration: outcome.description ? 10000 : 4000 };
      if (outcome.tone === "success") toast.success(outcome.title, options);
      else if (outcome.tone === "warning") toast.warning(outcome.title, options);
      else toast.info(outcome.title, options);
    },
    onError: (error: Error) => {
      toast.error(`Failed to enroll leads: ${error.message}`);
    },
  });
}

export function useUpdateEnrollmentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      sequence_id,
      status,
    }: {
      id: string;
      sequence_id: string;
      status: EnrollmentStatus;
    }) => {
      const { data, error } = await supabase
        .from("email_sequence_enrollments")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;
      return { enrollment: data as unknown as EmailSequenceEnrollment, sequence_id };
    },
    onSuccess: ({ sequence_id }) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", sequence_id] });
      toast.success("Enrollment updated");
    },
    onError: (error: Error) => {
      toast.error(`Failed to update enrollment: ${error.message}`);
    },
  });
}

export function useRemoveEnrollment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      sequence_id,
    }: {
      id: string;
      sequence_id: string;
    }) => {
      const { error } = await supabase
        .from("email_sequence_enrollments")
        .delete()
        .eq("id", id);

      if (error) throw error;
      return { sequence_id };
    },
    onSuccess: ({ sequence_id }) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", sequence_id] });
      toast.success("Lead removed from sequence");
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove enrollment: ${error.message}`);
    },
  });
}

export function useBulkRemoveEnrollments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ids,
      sequence_id,
    }: {
      ids: string[];
      sequence_id: string;
    }) => {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from("email_sequence_enrollments")
          .delete()
          .in("id", chunk)
      );
      return { removed: ids.length, sequence_id };
    },
    onSuccess: ({ removed, sequence_id }) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", sequence_id] });
      toast.success(`${removed} enrollment${removed !== 1 ? "s" : ""} removed`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove enrollments: ${error.message}`);
    },
  });
}

export function useBulkUpdateEnrollmentStatus() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      ids,
      sequence_id,
      status,
    }: {
      ids: string[];
      sequence_id: string;
      status: EnrollmentStatus;
    }) => {
      await chunkedMutate(ids, (chunk) =>
        supabase
          .from("email_sequence_enrollments")
          .update({ status, updated_at: new Date().toISOString() })
          .in("id", chunk)
      );
      return { updated: ids.length, sequence_id };
    },
    onSuccess: ({ updated, sequence_id }) => {
      queryClient.invalidateQueries({ queryKey: ["email-enrollments", sequence_id] });
      queryClient.invalidateQueries({ queryKey: ["email-enrollment-counts", sequence_id] });
      toast.success(`${updated} enrollment${updated !== 1 ? "s" : ""} updated`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to update enrollments: ${error.message}`);
    },
  });
}
