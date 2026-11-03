import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * A gate the lead list's processing setup already applies, restated in the
 * enrollment filter's own vocabulary.
 */
export interface InheritedProcessingFilter {
  listId: string;
  listName: string;
  /** Short human-readable rules, e.g. "ICP score ≥ 70", "Valid email required". */
  rules: string[];
}

interface PolicyRow {
  lead_list_id: string;
  enabled: boolean | null;
  analyze_icp: boolean | null;
  min_icp_score: number | null;
  verify_email: boolean | null;
  require_valid_email: boolean | null;
  find_email: boolean | null;
  lead_lists: { name: string } | { name: string }[] | null;
}

/**
 * What the attached lists' processing pipelines already filter on.
 *
 * There were two filter languages answering one question — "which of these
 * leads deserve contact". The processing setup has ICP scoring and email
 * validity rules; the enrollment filter has its own criteria builder. Neither
 * screen mentioned the other, so people re-applied an ICP threshold that was
 * already enforced upstream, or assumed a gate existed that didn't.
 *
 * These are shown as read-only chips above the enrollment filter: inherited
 * context, not another control to set.
 */
export function useInheritedProcessingFilters(listIds: string[]) {
  const { currentOrganization } = useAuth();
  const key = [...listIds].sort().join(",");
  return useQuery({
    queryKey: ["inherited-processing-filters", currentOrganization?.id, key],
    enabled: !!currentOrganization && listIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<InheritedProcessingFilter[]> => {
      const { data, error } = await supabase
        .from("lead_list_processing_policies")
        .select(
          "lead_list_id, enabled, analyze_icp, min_icp_score, verify_email, require_valid_email, find_email, lead_lists(name)",
        )
        .eq("organization_id", currentOrganization!.id)
        .in("lead_list_id", key ? key.split(",") : []);
      if (error) throw error;

      return ((data ?? []) as unknown as PolicyRow[])
        .filter((row) => row.enabled)
        .map((row) => {
          const rules: string[] = [];
          if (row.analyze_icp && typeof row.min_icp_score === "number") {
            rules.push(`ICP score ≥ ${row.min_icp_score}`);
          } else if (row.analyze_icp) {
            rules.push("ICP scored");
          }
          if (row.require_valid_email) rules.push("Valid email required");
          else if (row.verify_email) rules.push("Email verified");
          else if (row.find_email) rules.push("Email found");

          const list = Array.isArray(row.lead_lists) ? row.lead_lists[0] : row.lead_lists;
          return { listId: row.lead_list_id, listName: list?.name ?? "List", rules };
        })
        .filter((entry) => entry.rules.length > 0);
    },
  });
}
