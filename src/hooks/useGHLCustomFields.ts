import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GHLCustomField {
  id: string;
  name: string;
  fieldKey: string;
  dataType: string;
}

export function useGHLCustomFields() {
  const { currentOrganization } = useAuth();

  return useQuery<GHLCustomField[]>({
    queryKey: ["ghl-custom-fields", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke(
        "ghl-list-custom-fields",
        { body: { organizationId: currentOrganization!.id } }
      );

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Failed to fetch GHL custom fields");

      return data.customFields as GHLCustomField[];
    },
    enabled: !!currentOrganization,
    staleTime: 5 * 60 * 1000,
  });
}
