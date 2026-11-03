import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Which lead lists this org has enrolled in the MoltSets daily-max
 * background worker (moltsets-daily-enrichment-tick, every 10 min).
 */
export function useMoltsetsWorkerLists() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["moltsets-worker-lists", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("moltsets_worker_lists")
        .select("id, lead_list_id, enabled, last_run_at")
        .eq("organization_id", currentOrganization.id)
        .eq("enabled", true);

      if (error) throw error;
      return data;
    },
    enabled: !!currentOrganization,
  });
}

export function useToggleMoltsetsWorkerList() {
  const queryClient = useQueryClient();
  const { currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ leadListId, enroll }: { leadListId: string; enroll: boolean }) => {
      if (!currentOrganization) throw new Error("No organization selected");

      if (enroll) {
        const { error } = await supabase
          .from("moltsets_worker_lists")
          .upsert(
            {
              organization_id: currentOrganization.id,
              lead_list_id: leadListId,
              enabled: true,
            },
            { onConflict: "organization_id,lead_list_id" }
          );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("moltsets_worker_lists")
          .update({ enabled: false })
          .eq("organization_id", currentOrganization.id)
          .eq("lead_list_id", leadListId);
        if (error) throw error;
      }
    },
    onSuccess: (_data, { enroll }) => {
      queryClient.invalidateQueries({ queryKey: ["moltsets-worker-lists"] });
      toast.success(
        enroll
          ? "List enrolled in MoltSets daily enrichment"
          : "List removed from MoltSets daily enrichment"
      );
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update MoltSets enrollment");
    },
  });
}
