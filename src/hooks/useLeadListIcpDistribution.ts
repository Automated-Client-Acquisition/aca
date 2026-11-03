import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface IcpDistribution {
  total: number;
  scored: number;
  perfectFit: number; // 80-100
  goodFit: number;    // 60-79
  moderateFit: number; // 40-59
  poorFit: number;    // 0-39
}

/**
 * Fetches ICP score distribution for one or more lead lists by product.
 * Unions lead_list_members across the given lists (deduping overlapping
 * contacts), then joins crm_contacts → contact_product_scores for a product.
 */
export function useLeadListIcpDistribution(
  listIds: string[] | undefined,
  productId: string | undefined
) {
  const sortedListIds = [...(listIds || [])].filter(Boolean).sort();

  return useQuery({
    queryKey: ["lead-list-icp-distribution", sortedListIds, productId],
    enabled: sortedListIds.length > 0 && !!productId,
    queryFn: async (): Promise<IcpDistribution> => {
      // Get all contact IDs across the lists (deduped)
      const { data: members, error: membersError } = await supabase
        .from("lead_list_members")
        .select("contact_id")
        .in("list_id", sortedListIds);

      if (membersError) throw membersError;

      const contactIds = Array.from(new Set((members || []).map((m) => m.contact_id)));
      const total = contactIds.length;

      if (total === 0) {
        return { total: 0, scored: 0, perfectFit: 0, goodFit: 0, moderateFit: 0, poorFit: 0 };
      }

      // Fetch product scores for these contacts
      // Process in batches of 500 to avoid query limits
      const allScores: number[] = [];
      for (let i = 0; i < contactIds.length; i += 500) {
        const batch = contactIds.slice(i, i + 500);
        const { data: scores, error: scoresError } = await supabase
          .from("contact_product_scores")
          .select("icp_score")
          .eq("product_id", productId!)
          .in("contact_id", batch);

        if (scoresError) throw scoresError;
        if (scores) {
          allScores.push(...scores.map((s) => s.icp_score ?? 0));
        }
      }

      return {
        total,
        scored: allScores.length,
        perfectFit: allScores.filter((s) => s >= 80).length,
        goodFit: allScores.filter((s) => s >= 60 && s < 80).length,
        moderateFit: allScores.filter((s) => s >= 40 && s < 60).length,
        poorFit: allScores.filter((s) => s < 40).length,
      };
    },
    staleTime: 60_000, // Cache for 1 minute
  });
}
