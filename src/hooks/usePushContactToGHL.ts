import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

interface PushContactToGHLParams {
  contactId: string;
  conversationId?: string;
  tags?: string[];
  applyTagsLocally?: boolean;
}

export function usePushContactToGHL() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (params: PushContactToGHLParams) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase.functions.invoke(
        "push-contact-to-ghl",
        {
          body: {
            ...params,
            organizationId: currentOrganization.id,
          },
        }
      );

      if (error) throw error;
      if (data && !data.success) throw new Error(data.error || "Push failed");
      return data;
    },
    onSuccess: (_data, variables) => {
      toast.success("Contact pushed to LeadConnector");

      queryClient.invalidateQueries({
        queryKey: ["crm-contact", variables.contactId],
      });
      if (variables.applyTagsLocally && variables.tags?.length) {
        queryClient.invalidateQueries({
          queryKey: ["crm-contact-tags", variables.contactId],
        });
        queryClient.invalidateQueries({ queryKey: ["crm-tags"] });
        queryClient.invalidateQueries({ queryKey: ["crm-contacts"] });
      }
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to push contact to LeadConnector"
      );
    },
  });
}
