import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface EligibleLeadsPreview {
  eligibleCount: number;
  totalInList: number;
  excludedByList: number;
  excludedByOtherCampaign: number;
  excludedBySameSender: number;
}

/**
 * Plain-English reasons for the excluded leads, most significant first.
 * A bare "147 excluded" leaves the operator with no move except to disable
 * safeguards and try again, which is what caused the 28 Aug duplicate
 * invitation incident.
 */
export function describeExclusions(p: EligibleLeadsPreview): string[] {
  const reasons: string[] = [];
  if (p.excludedByOtherCampaign > 0) {
    reasons.push(`${p.excludedByOtherCampaign} already in another campaign`);
  }
  if (p.excludedBySameSender > 0) {
    reasons.push(`${p.excludedBySameSender} already contacted by these senders`);
  }
  if (p.excludedByList > 0) {
    reasons.push(`${p.excludedByList} on an exclusion list`);
  }
  return reasons;
}

export function useEligibleLeadsPreview(params: {
  leadListIds: string[];
  exclusionListIds: string[];
  excludeOtherCampaigns: boolean;
  excludeSameSender: boolean;
  senderAccountIds: string[];
  campaignId?: string;
}) {
  const { currentOrganization } = useAuth();
  const orgId = currentOrganization?.id;

  const {
    leadListIds,
    exclusionListIds,
    excludeOtherCampaigns,
    excludeSameSender,
    senderAccountIds,
    campaignId,
  } = params;

  // Stable key regardless of list order.
  const sortedListIds = [...(leadListIds || [])].filter(Boolean).sort();
  const sortedSenderIds = [...(senderAccountIds || [])].filter(Boolean).sort();

  return useQuery({
    queryKey: [
      "eligible-leads-preview",
      sortedListIds,
      exclusionListIds,
      excludeOtherCampaigns,
      excludeSameSender,
      sortedSenderIds,
      orgId,
      campaignId,
    ],
    queryFn: async (): Promise<EligibleLeadsPreview> => {
      if (sortedListIds.length === 0) {
        return {
          eligibleCount: 0,
          totalInList: 0,
          excludedByList: 0,
          excludedByOtherCampaign: 0,
          excludedBySameSender: 0,
        };
      }

      // Union across all attached lists (dedupes overlapping members).
      const { data, error } = await supabase.rpc(
        "preview_eligible_leads_count_multi",
        {
          p_lead_list_ids: sortedListIds,
          p_exclusion_list_ids: exclusionListIds,
          p_exclude_other_campaigns: excludeOtherCampaigns,
          p_organization_id: orgId || null,
          p_campaign_id: campaignId || null,
          p_exclude_same_sender: excludeSameSender,
          p_sender_account_ids: sortedSenderIds.length ? sortedSenderIds : null,
        }
      );

      if (error) throw error;

      const row = Array.isArray(data) ? data[0] : data;
      return {
        eligibleCount: row?.eligible_count ?? 0,
        totalInList: row?.total_in_list ?? 0,
        excludedByList: row?.excluded_by_list ?? 0,
        excludedByOtherCampaign: row?.excluded_by_other_campaign ?? 0,
        excludedBySameSender: row?.excluded_by_same_sender ?? 0,
      };
    },
    enabled: sortedListIds.length > 0,
    staleTime: 500,
    gcTime: 30_000,
  });
}
