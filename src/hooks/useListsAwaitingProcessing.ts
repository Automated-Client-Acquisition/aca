import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * How many members of these lists their lead-processing pipeline hasn't
 * finished with — neither approved nor rejected yet.
 *
 * The Ongoing / One-time choice was previously made purely from the list's
 * source_type, which says nothing about whether the leads are *ready*. A
 * one-time send freezes a list that is still being qualified, enriched and
 * verified, so those leads go out raw. This number lets the builder say so.
 *
 * Returns 0 when no attached list has processing switched on.
 */
export function useListsAwaitingProcessing(listIds: string[]) {
  const { currentOrganization } = useAuth();
  const key = [...listIds].sort().join(",");
  return useQuery({
    queryKey: ["lists-awaiting-processing", currentOrganization?.id, key],
    enabled: !!currentOrganization && listIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<number> => {
      const { data, error } = await supabase.rpc(
        // @ts-expect-error Generated Supabase types update alongside the migration.
        "lead_lists_awaiting_processing",
        { p_org: currentOrganization!.id, p_list_ids: key ? key.split(",") : [] },
      );
      if (error) throw error;
      return typeof data === "number" ? data : 0;
    },
  });
}
