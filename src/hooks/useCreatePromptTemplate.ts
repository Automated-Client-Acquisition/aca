import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import type { Database } from "@/integrations/supabase/types";

type PromptTemplateInsert = Database["public"]["Tables"]["prompt_library"]["Insert"];

export function useCreatePromptTemplate() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async (data: Omit<PromptTemplateInsert, "organization_id">) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      const { data: prompt, error } = await supabase
        .from("prompt_library")
        .insert({
          ...data,
          organization_id: currentOrganization.id,
          is_public: false,
          is_preset: false,
        })
        .select()
        .single();

      if (error) throw error;
      return prompt;
    },
    onSuccess: () => {
      // Invalidate all prompt template queries to refresh the list
      queryClient.invalidateQueries({ queryKey: ["prompt-templates"] });
      // Also invalidate scenarios in case a new scenario was added
      queryClient.invalidateQueries({ queryKey: ["prompt-scenarios"] });
      queryClient.invalidateQueries({ queryKey: ["prompt-library"] });
      toast.success("Prompt template saved successfully");
    },
    onError: (error: Error) => {
      toast.error("Failed to save prompt template", {
        description: error.message,
      });
    },
  });
}
