import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useKnowledgeBaseStatus() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["knowledge-base-status", currentOrganization?.id],
    queryFn: async () => {
      const { count } = await supabase
        .from("knowledge_base_documents")
        .select("id", { count: "exact" })
        .eq("organization_id", currentOrganization!.id)
        .eq("status", "completed");

      return { documentCount: count || 0 };
    },
    enabled: !!currentOrganization,
  });
}
