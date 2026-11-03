import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export type EnrollmentDestinationType = "email_sequence" | "linkedin_campaign";

/**
 * A lead list whose processing pipeline routes its approved leads into this
 * sequence / campaign — an inflow the "Lead source" panel would otherwise never
 * mention, because it lives on the list, not on the destination.
 */
export interface PipelineInflow {
  list_id: string;
  list_name: string;
  /** The processing setup is switched on. Off = the route exists but is dormant. */
  enabled: boolean;
  total: number;
  approved: number;
  rejected: number;
  awaiting: number;
}

/**
 * Every pipeline-driven inflow into one sequence or campaign.
 *
 * Two things independently decide who enters a sequence: the list's processing
 * setup (gated — qualify → enrich → verify) and the destination's own Lead
 * source attach (ungated — a cron pulls every member). This hook surfaces the
 * first one inside the builder so the two can be reconciled in the UI instead
 * of quietly fighting. The matching server-side rule is
 * filter_contact_ids_by_pipeline_gate.
 */
export function useEnrollmentInflows(
  destType: EnrollmentDestinationType,
  destId: string | undefined,
) {
  const { currentOrganization } = useAuth();
  return useQuery({
    queryKey: ["enrollment-pipeline-inflows", currentOrganization?.id, destType, destId],
    enabled: !!currentOrganization && !!destId,
    staleTime: 60_000,
    queryFn: async (): Promise<PipelineInflow[]> => {
      const { data, error } = await supabase.rpc(
        // @ts-expect-error Generated Supabase types update alongside the migration.
        "enrollment_pipeline_inflows",
        { p_org: currentOrganization!.id, p_dest_type: destType, p_dest_id: destId },
      );
      if (error) throw error;
      return (Array.isArray(data) ? data : []) as PipelineInflow[];
    },
  });
}

/**
 * Lists that own their leads for this destination — the pipeline is ON and
 * routes here. Attaching one of these directly would bypass its gate, so the
 * builders block it.
 */
export function activeInflowListIds(inflows: PipelineInflow[] | undefined): Set<string> {
  return new Set((inflows ?? []).filter((i) => i.enabled).map((i) => i.list_id));
}
