import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface LinkedInAudit {
  id: string;
  organization_id: string;
  linkedin_url: string | null;
  status: string;
  overall_score: number | null;
  headline_score: number | null;
  about_score: number | null;
  activity_score: number | null;
  banner_score: number | null;
  headline_rewrite: string | null;
  about_rewrite: string | null;
  summary: string | null;
  recommendations: unknown;
  created_at: string | null;
  updated_at: string | null;
}

export function useLinkedInAudit() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["linkedin-audit", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("linkedin_audits")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data as LinkedInAudit | null;
    },
    enabled: !!currentOrganization,
  });
}
