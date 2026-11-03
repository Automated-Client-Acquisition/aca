import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/**
 * Channel stats for a lead list
 */
export interface LeadListChannelStats {
  id: string;
  list_id: string;
  total_leads: number;
  // Raw counts
  has_linkedin: number;
  has_email: number;
  has_phone: number;
  has_whatsapp: number;
  has_instagram: number;
  has_twitter: number;
  // Percentages (0-100)
  linkedin_pct: number;
  email_pct: number;
  phone_pct: number;
  whatsapp_pct: number;
  instagram_pct: number;
  twitter_pct: number;
  // Metadata
  computed_at: string;
}

/**
 * Hook to fetch channel stats for a specific lead list
 */
export function useLeadListChannelStats(listId: string | undefined) {
  return useQuery({
    queryKey: ["lead-list-channel-stats", listId],
    queryFn: async () => {
      if (!listId) throw new Error("List ID is required");

      const { data, error } = await supabase
        .from("lead_list_channel_stats")
        .select("*")
        .eq("list_id", listId)
        .maybeSingle();

      if (error) throw error;

      return data as LeadListChannelStats | null;
    },
    enabled: !!listId,
    // Stats change infrequently, cache for 5 minutes
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Hook to refresh/compute channel stats for a lead list
 */
export function useRefreshChannelStats() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (listId: string) => {
      const previousStats = queryClient.getQueryData<LeadListChannelStats | null>([
        "lead-list-channel-stats",
        listId,
      ]);

      // Queue the expensive calculation; pg_cron processes it out of band.
      const { error } = await supabase
        .rpc("request_lead_list_channel_stats_refresh", { p_list_id: listId });

      if (error) throw error;

      const previousComputedAt = previousStats?.computed_at;
      const deadline = Date.now() + 150_000;

      while (Date.now() < deadline) {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));

        const { data, error: fetchError } = await supabase
          .from("lead_list_channel_stats")
          .select("*")
          .eq("list_id", listId)
          .maybeSingle();

        if (fetchError) throw fetchError;

        const stats = data as LeadListChannelStats | null;
        if (stats && (!previousComputedAt || stats.computed_at !== previousComputedAt)) {
          return stats;
        }
      }

      return null;
    },
    onSuccess: (data) => {
      if (data) {
        queryClient.setQueryData(
          ["lead-list-channel-stats", data.list_id],
          data
        );
      }
      queryClient.invalidateQueries({ queryKey: ["lead-list-channel-stats"] });
    },
    onError: (error) => {
      console.error("Failed to refresh channel stats:", error);
      toast.error("Failed to refresh channel statistics");
    },
  });
}

/**
 * Hook to fetch channel stats for multiple lead lists at once
 */
export function useLeadListsChannelStats(listIds: string[]) {
  return useQuery({
    queryKey: ["lead-lists-channel-stats", listIds],
    queryFn: async () => {
      if (!listIds.length) return [];

      const { data, error } = await supabase
        .from("lead_list_channel_stats")
        .select("*")
        .in("list_id", listIds);

      if (error) throw error;

      return data as LeadListChannelStats[];
    },
    enabled: listIds.length > 0,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Aggregate channel stats across several lists into one synthetic stats object.
 * Sums the raw per-channel counts and recomputes percentages against the summed
 * total. Note: contacts in multiple lists are counted once per list (the
 * underlying stats are per-list), so totals are an upper bound when lists
 * overlap — good enough for the reachability read-out.
 */
export function useAggregatedChannelStats(listIds: string[]) {
  const sortedListIds = [...(listIds || [])].filter(Boolean).sort();
  const query = useLeadListsChannelStats(sortedListIds);

  const aggregated: LeadListChannelStats | null = (() => {
    const rows = query.data;
    if (!rows || rows.length === 0) return null;

    const sum = (key: keyof LeadListChannelStats) =>
      rows.reduce((acc, r) => acc + (Number(r[key]) || 0), 0);

    const total_leads = sum("total_leads");
    const pct = (raw: number) => (total_leads > 0 ? (raw / total_leads) * 100 : 0);

    const has_linkedin = sum("has_linkedin");
    const has_email = sum("has_email");
    const has_phone = sum("has_phone");
    const has_whatsapp = sum("has_whatsapp");
    const has_instagram = sum("has_instagram");
    const has_twitter = sum("has_twitter");

    return {
      id: sortedListIds.join(","),
      list_id: sortedListIds.join(","),
      total_leads,
      has_linkedin,
      has_email,
      has_phone,
      has_whatsapp,
      has_instagram,
      has_twitter,
      linkedin_pct: pct(has_linkedin),
      email_pct: pct(has_email),
      phone_pct: pct(has_phone),
      whatsapp_pct: pct(has_whatsapp),
      instagram_pct: pct(has_instagram),
      twitter_pct: pct(has_twitter),
      computed_at: rows.reduce(
        (latest, r) => (r.computed_at > latest ? r.computed_at : latest),
        rows[0].computed_at,
      ),
    };
  })();

  return {
    data: aggregated,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
    missingCount: 0,
  };
}

/**
 * Utility: Get color class based on coverage percentage
 */
export function getChannelCoverageColor(percentage: number): string {
  if (percentage >= 70) return "text-green-600 dark:text-green-400";
  if (percentage >= 30) return "text-yellow-600 dark:text-yellow-400";
  return "text-red-600 dark:text-red-400";
}

/**
 * Utility: Get badge variant based on coverage percentage
 */
export function getChannelCoverageBadgeVariant(percentage: number): "default" | "secondary" | "outline" | "destructive" {
  if (percentage >= 70) return "default";
  if (percentage >= 30) return "secondary";
  return "outline";
}

/**
 * Channel type for display
 */
export type DisplayChannel = "linkedin" | "email" | "phone" | "whatsapp" | "instagram" | "twitter";

/**
 * Channel display configuration
 */
export const CHANNEL_DISPLAY_CONFIG: Record<
  DisplayChannel,
  { label: string; statKey: keyof LeadListChannelStats; pctKey: keyof LeadListChannelStats }
> = {
  linkedin: { label: "LinkedIn", statKey: "has_linkedin", pctKey: "linkedin_pct" },
  email: { label: "Email", statKey: "has_email", pctKey: "email_pct" },
  phone: { label: "Phone", statKey: "has_phone", pctKey: "phone_pct" },
  whatsapp: { label: "WhatsApp", statKey: "has_whatsapp", pctKey: "whatsapp_pct" },
  instagram: { label: "Instagram", statKey: "has_instagram", pctKey: "instagram_pct" },
  twitter: { label: "Twitter/X", statKey: "has_twitter", pctKey: "twitter_pct" },
};
