import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface CampaignPreviewLead {
  id: string;
  display_name: string | null;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  city: string | null;
  primary_email: string | null;
  linkedin_bio: string | null;
  home_page_text: string | null;
  notion_preview_url: string | null;
  custom_fields: Record<string, unknown> | null;
  enrichment_data: Record<string, unknown> | null;
  discovery_metadata: Record<string, unknown> | null;
}

const PREVIEW_LEAD_LIMIT = 50;

/**
 * A handful of real leads from the campaign's lists, so the message editor can
 * show what a step resolves to for an actual recipient instead of sample data.
 */
export function useCampaignPreviewLeads(listIds: string[] | undefined) {
  const { currentOrganization } = useAuth();
  const sortedListIds = [...(listIds || [])].filter(Boolean).sort();

  return useQuery({
    queryKey: ["campaign-preview-leads", currentOrganization?.id, sortedListIds],
    enabled: !!currentOrganization && sortedListIds.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<CampaignPreviewLead[]> => {
      const { data, error } = await supabase
        .from("lead_list_members")
        .select(
          "contact:crm_contacts(id, display_name, first_name, last_name, company, job_title, city, primary_email, linkedin_bio, home_page_text, notion_preview_url, custom_fields, enrichment_data, discovery_metadata)"
        )
        .in("list_id", sortedListIds)
        .limit(PREVIEW_LEAD_LIMIT);

      if (error) throw error;

      const seen = new Set<string>();
      const leads: CampaignPreviewLead[] = [];
      for (const row of (data || []) as unknown as { contact: CampaignPreviewLead | null }[]) {
        if (row.contact && !seen.has(row.contact.id)) {
          seen.add(row.contact.id);
          leads.push(row.contact);
        }
      }
      return leads;
    },
  });
}
