import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { FleetDemand } from "@/lib/fleet-demand";

interface FleetDemandOptions {
  /** Pool restriction being looked at. Empty = the whole fleet. */
  tags?: string[] | null;
  tagMatch?: "any" | "all" | null;
  /** Leave this sequence out of the competitors and return its own counts. */
  sequenceId?: string | null;
  enabled?: boolean;
}

/**
 * Shared mailbox fleet capacity vs what active auto sequences ask of it
 * (get_email_fleet_demand). Read-only; see src/lib/fleet-demand.ts for how
 * the numbers are combined.
 */
export function useEmailFleetDemand({
  tags,
  tagMatch,
  sequenceId,
  enabled = true,
}: FleetDemandOptions = {}) {
  const { currentOrganization } = useAuth();
  const tagKey = [...(tags ?? [])].filter(Boolean).sort();
  const match = tagMatch === "all" ? "all" : "any";

  return useQuery({
    queryKey: [
      "email-fleet-demand",
      currentOrganization?.id,
      sequenceId ?? null,
      tagKey.join(","),
      match,
    ],
    queryFn: async () => {
      const { data, error } = await supabase.rpc(
        "get_email_fleet_demand" as never,
        {
          p_org: currentOrganization!.id,
          p_tags: tagKey,
          p_tag_match: match,
          p_sequence_id: sequenceId ?? null,
        } as never,
      );
      if (error) throw error;
      return data as unknown as FleetDemand;
    },
    enabled: !!currentOrganization && enabled,
    staleTime: 60_000,
  });
}
