import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface IdeaTag {
  id: string;
  name: string;
}

export interface ContentIdea {
  id: string;
  title: string;
  keywords: string[] | null;
  ai_analysis: any;
  content_framework: string | null;
  emotional_triggers: string[] | null;
  brand_voice_id: string | null;
  product_id: string | null;
  content_angle_id: string | null;
  free_text: string | null;
  source_urls: string | null;
  folder_id: string | null;
  brand_voice?: { id: string; name: string } | null;
  product?: { id: string; name: string } | null;
  content_angle?: { id: string; name: string } | null;
  folder?: { id: string; name: string; color: string } | null;
  tags?: IdeaTag[];
  scripts_count?: number;
  priority?: number;
  generation_in_progress?: boolean;
  /** A person approved the idea's guidelines (see src/lib/idea-guidelines.ts). */
  guidelines_approved_at?: string | null;
  guidelines_approved_by?: string | null;
  metadata?: Record<string, any> | null;
  created_at: string;
  updated_at: string;
  organization_id: string;
}

/**
 * Approve or un-approve an idea's guidelines. Approving saves any unsaved edits
 * in the same update and marks every point reviewed (talking_points_ai: []),
 * so the reset trigger doesn't undo it.
 */
export function useIdeaGuidelinesApproval() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  return useMutation({
    mutationFn: async ({ id, approve, pending = {} }: { id: string; approve: boolean; pending?: Record<string, any> }) => {
      if (!currentOrganization) throw new Error("No organization context");
      const updates: Record<string, any> = { ...pending };
      if (approve) {
        updates.guidelines_approved_at = new Date().toISOString();
        updates.guidelines_approved_by = user?.id ?? null;
      } else {
        updates.guidelines_approved_at = null;
        updates.guidelines_approved_by = null;
      }
      const { error } = await supabase
        .from("content_ideas")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);
      if (error) throw error;
    },
    onSuccess: (_, { approve }) => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
      toast.success(approve ? "Guidelines approved" : "Approval removed");
    },
    onError: (error: Error) => {
      toast.error("Couldn't update the approval", { description: error.message });
    },
  });
}

export function useIdeas() {
  const queryClient = useQueryClient();
  const { user, currentOrganization } = useAuth();

  const { data: ideas, isLoading, error, refetch } = useQuery({
    queryKey: ["content-ideas", currentOrganization?.id],
    enabled: !!currentOrganization,
    queryFn: async () => {
      if (!currentOrganization) return [];

      // Explicitly filter by organization_id to ensure correct data when impersonating
      const { data, error } = await supabase
        .from("content_ideas")
        .select(`
          *,
          brand_voice:library_brand_voices(id, name),
          product:library_products(id, name),
          folder:idea_folders(id, name, color),
          idea_tag_assignments(
            idea_tags(id, name)
          )
        `)
        .eq("organization_id", currentOrganization.id)
        .order("created_at", { ascending: false });

      if (error) throw error;

      // Transform the nested tag assignments into a flat tags array
      const transformedData = (data || []).map((idea: any) => ({
        ...idea,
        tags: idea.idea_tag_assignments
          ?.map((assignment: any) => assignment.idea_tags)
          .filter(Boolean) || [],
        idea_tag_assignments: undefined, // Remove the raw junction data
      }));

      return transformedData as ContentIdea[];
    },
  });

  const updateIdea = useMutation({
    mutationFn: async ({ id, updates }: { id: string; updates: Partial<ContentIdea> }) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { data, error } = await supabase
        .from("content_ideas")
        .update(updates)
        .eq("id", id)
        .eq("organization_id", currentOrganization.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
      toast.success("Idea updated successfully");
    },
    onError: (error) => {
      toast.error(`Failed to update idea: ${error.message}`);
    },
  });

  const deleteIdea = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { error } = await supabase
        .from("content_ideas")
        .delete()
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
      toast.success("Idea deleted successfully");
    },
    onError: (error) => {
      toast.error(`Failed to delete idea: ${error.message}`);
    },
  });

  const deleteBulkIdeas = useMutation({
    mutationFn: async (ids: string[]) => {
      if (!currentOrganization) throw new Error('No organization context');
      await chunkedMutate(ids, (chunk) =>
        supabase.from("content_ideas").delete().in("id", chunk).eq("organization_id", currentOrganization.id)
      );
    },
    onSuccess: (_, ids) => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
      toast.success(`Successfully deleted ${ids.length} idea${ids.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to delete ideas: ${error.message}`);
    },
  });

  const resetIdeaGeneration = useMutation({
    mutationFn: async (id: string) => {
      if (!currentOrganization) throw new Error('No organization context');
      const { error } = await supabase
        .from("content_ideas")
        .update({ generation_in_progress: false })
        .eq("id", id)
        .eq("organization_id", currentOrganization.id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
      toast.success("Generation reset successfully");
    },
    onError: (error) => {
      toast.error(`Failed to reset generation: ${error.message}`);
    },
  });

  const createIdea = useMutation({
    mutationFn: async (newIdea: { title: string; free_text?: string | null; source_urls?: string | null; brand_voice_id?: string | null; product_id?: string | null; content_angle_id?: string | null; folder_id?: string | null }) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const { data, error } = await supabase
        .from("content_ideas")
        .insert([{
          title: newIdea.title,
          free_text: newIdea.free_text || null,
          source_urls: newIdea.source_urls || null,
          brand_voice_id: newIdea.brand_voice_id,
          product_id: newIdea.product_id,
          content_angle_id: newIdea.content_angle_id,
          folder_id: newIdea.folder_id,
          organization_id: currentOrganization.id
        }])
        .select(`
          *,
          brand_voice:library_brand_voices(id, name),
          product:library_products(id, name),
          folder:idea_folders(id, name, color)
        `)
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
    },
    onError: (error) => {
      toast.error(`Failed to create idea: ${error.message}`);
    },
  });

  const createBulkIdeas = useMutation({
    mutationFn: async (ideas: Array<{ title: string; brand_voice_id?: string | null; product_id?: string | null; content_angle_id?: string | null; folder_id?: string | null }>) => {
      if (!user) throw new Error('Not authenticated');
      if (!currentOrganization) throw new Error('No organization context');

      // Use currentOrganization from AuthContext - it already respects impersonation
      const ideasToInsert = ideas.map(idea => ({
        title: idea.title,
        brand_voice_id: idea.brand_voice_id || null,
        product_id: idea.product_id || null,
        content_angle_id: idea.content_angle_id || null,
        folder_id: idea.folder_id || null,
        organization_id: currentOrganization.id
      }));

      const { data, error } = await supabase
        .from("content_ideas")
        .insert(ideasToInsert)
        .select(`
          *,
          brand_voice:library_brand_voices(id, name),
          product:library_products(id, name),
          folder:idea_folders(id, name, color)
        `);

      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["content-ideas", currentOrganization?.id] });
      toast.success(`Successfully created ${data.length} idea${data.length !== 1 ? "s" : ""}`);
    },
    onError: (error) => {
      toast.error(`Failed to create ideas: ${error.message}`);
    },
  });

  return {
    ideas: ideas || [],
    isLoading,
    error,
    refetch,
    updateIdea: (id: string, updates: Partial<ContentIdea>) =>
      updateIdea.mutate({ id, updates }),
    deleteIdea: (id: string) => deleteIdea.mutate(id),
    deleteBulkIdeas: (ids: string[]) => deleteBulkIdeas.mutate(ids),
    createIdea: (data: { title: string; free_text?: string | null; source_urls?: string | null; brand_voice_id?: string | null; product_id?: string | null; content_angle_id?: string | null; folder_id?: string | null }) => createIdea.mutateAsync(data),
    createBulkIdeas: (ideas: Array<{ title: string; brand_voice_id?: string | null; product_id?: string | null; content_angle_id?: string | null; folder_id?: string | null }>) => createBulkIdeas.mutateAsync(ideas),
    resetIdeaGeneration: (id: string) => resetIdeaGeneration.mutate(id),
    isUpdating: updateIdea.isPending,
    isDeleting: deleteIdea.isPending,
    isDeletingBulk: deleteBulkIdeas.isPending,
    isCreating: createIdea.isPending,
    isCreatingBulk: createBulkIdeas.isPending,
    isResetting: resetIdeaGeneration.isPending,
  };
}
