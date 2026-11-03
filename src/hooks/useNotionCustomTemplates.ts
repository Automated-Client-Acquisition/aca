import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";

export interface NotionCustomTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  icon: string;
  custom_prompt: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export function useNotionCustomTemplates() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: templates, isLoading } = useQuery({
    queryKey: ["notion-custom-templates", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      const { data, error } = await supabase
        .from("notion_custom_templates")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as NotionCustomTemplate[];
    },
  });

  const createTemplate = useMutation({
    mutationFn: async (input: { name: string; description?: string; icon?: string; custom_prompt: string }) => {
      if (!user) throw new Error("Not authenticated");
      if (!currentOrganization) throw new Error("No organization context");

      const { data, error } = await supabase
        .from("notion_custom_templates")
        .insert([{
          name: input.name,
          description: input.description || null,
          icon: input.icon || "✏️",
          custom_prompt: input.custom_prompt,
          organization_id: currentOrganization.id,
          created_by: user.id,
        } as any])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notion-custom-templates", currentOrganization?.id] });
      toast.success("Template saved");
    },
    onError: (error) => {
      toast.error(`Failed to save template: ${error.message}`);
    },
  });

  const deleteTemplate = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error("No organization context");

      const { error } = await supabase
        .from("notion_custom_templates")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notion-custom-templates", currentOrganization?.id] });
      toast.success("Template deleted");
    },
    onError: (error) => {
      toast.error(`Failed to delete template: ${error.message}`);
    },
  });

  return {
    templates: templates || [],
    isLoading,
    createTemplate,
    deleteTemplate,
  };
}
