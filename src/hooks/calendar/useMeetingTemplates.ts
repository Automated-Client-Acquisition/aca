import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface MeetingTemplate {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  title_template: string;
  body_template: string | null;
  duration_minutes: number;
  conference_provider: "google_meet" | "zoom" | "teams" | "none" | null;
  location: string | null;
  is_default: boolean;
  created_at: string;
  updated_at: string;
}

export function useMeetingTemplates() {
  const { user, currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["meeting-templates", currentOrganization?.id],
    queryFn: async () => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { data, error } = await supabase
        .from("meeting_templates")
        .select("*")
        .eq("organization_id", currentOrganization.id)
        .order("is_default", { ascending: false })
        .order("name", { ascending: true });

      if (error) throw error;
      return data as MeetingTemplate[];
    },
    enabled: !!user && !!currentOrganization?.id,
  });
}

export function useCreateMeetingTemplate() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (template: Omit<MeetingTemplate, "id" | "organization_id" | "created_at" | "updated_at">) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      // If this is set as default, unset other defaults first
      if (template.is_default) {
        await supabase
          .from("meeting_templates")
          .update({ is_default: false })
          .eq("organization_id", currentOrganization.id);
      }

      const { data, error } = await supabase
        .from("meeting_templates")
        .insert({
          ...template,
          organization_id: currentOrganization.id,
        })
        .select()
        .single();

      if (error) throw error;
      return data as MeetingTemplate;
    },
    onSuccess: () => {
      toast.success("Meeting template created");
      queryClient.invalidateQueries({ queryKey: ["meeting-templates"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to create template");
    },
  });
}

export function useUpdateMeetingTemplate() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      ...updates
    }: Partial<MeetingTemplate> & { id: string }) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      // If setting as default, unset other defaults first
      if (updates.is_default) {
        await supabase
          .from("meeting_templates")
          .update({ is_default: false })
          .eq("organization_id", currentOrganization.id)
          .neq("id", id);
      }

      const { data, error } = await supabase
        .from("meeting_templates")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data as MeetingTemplate;
    },
    onSuccess: () => {
      toast.success("Meeting template updated");
      queryClient.invalidateQueries({ queryKey: ["meeting-templates"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update template");
    },
  });
}

export function useDeleteMeetingTemplate() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization?.id) throw new Error("No organization selected");

      const { error } = await supabase
        .from("meeting_templates")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Meeting template deleted");
      queryClient.invalidateQueries({ queryKey: ["meeting-templates"] });
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to delete template");
    },
  });
}

// Helper function to apply template variables
export function applyTemplateVariables(
  template: string,
  variables: Record<string, string | undefined>
): string {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    const regex = new RegExp(`\\{${key}\\}`, "g");
    result = result.replace(regex, value || "");
  }
  return result;
}
