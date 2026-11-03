import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { IdeaTag } from "./useIdeaTagsCRUD";
import { chunkedMutate } from "@/hooks/crm/useContacts";

export interface IdeaTagAssignment {
  id: string;
  idea_id: string;
  tag_id: string;
  created_at: string;
  idea_tags?: IdeaTag;
}

/**
 * Hook to get tags assigned to a specific idea
 */
export function useIdeaTagsForIdea(ideaId: string | undefined) {
  return useQuery({
    queryKey: ["idea-tag-assignments", ideaId],
    queryFn: async () => {
      if (!ideaId) return [];

      const { data, error } = await supabase
        .from("idea_tag_assignments")
        .select(`
          id,
          idea_id,
          tag_id,
          created_at,
          idea_tags!inner(id, name, organization_id, created_at, updated_at)
        `)
        .eq("idea_id", ideaId);

      if (error) throw error;

      return (data || []).map((assignment: any) => ({
        ...assignment,
        tag: assignment.idea_tags,
      }));
    },
    enabled: !!ideaId,
  });
}

/**
 * Hook to assign a tag to an idea
 */
export function useAssignTagToIdea() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ideaId, tagId }: { ideaId: string; tagId: string }) => {
      const { data, error } = await supabase
        .from("idea_tag_assignments")
        .insert([{ idea_id: ideaId, tag_id: tagId }])
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["idea-tag-assignments", variables.ideaId] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
    },
    onError: (error: Error) => {
      if (!error.message.includes("duplicate")) {
        toast.error(`Failed to assign tag: ${error.message}`);
      }
    },
  });
}

/**
 * Hook to remove a tag from an idea
 */
export function useRemoveTagFromIdea() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ideaId, tagId }: { ideaId: string; tagId: string }) => {
      const { error } = await supabase
        .from("idea_tag_assignments")
        .delete()
        .eq("idea_id", ideaId)
        .eq("tag_id", tagId);

      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["idea-tag-assignments", variables.ideaId] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove tag: ${error.message}`);
    },
  });
}

/**
 * Hook to set all tags for an idea (replaces existing tags)
 */
export function useSetIdeaTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ideaId, tagIds }: { ideaId: string; tagIds: string[] }) => {
      // Fetch current assignments to diff
      const { data: existing, error: fetchError } = await supabase
        .from("idea_tag_assignments")
        .select("id, tag_id")
        .eq("idea_id", ideaId);

      if (fetchError) throw fetchError;

      const existingTagIds = new Set((existing || []).map((a) => a.tag_id));
      const newTagIds = new Set(tagIds);

      // Delete only tags that were removed
      const toRemove = (existing || []).filter((a) => !newTagIds.has(a.tag_id));
      if (toRemove.length > 0) {
        const { error: deleteError } = await supabase
          .from("idea_tag_assignments")
          .delete()
          .in("id", toRemove.map((a) => a.id));

        if (deleteError) throw deleteError;
      }

      // Upsert only tags that are new
      const toAdd = tagIds.filter((tagId) => !existingTagIds.has(tagId));
      if (toAdd.length > 0) {
        const assignments = toAdd.map((tagId) => ({
          idea_id: ideaId,
          tag_id: tagId,
        }));

        const { error: insertError } = await supabase
          .from("idea_tag_assignments")
          .upsert(assignments, { onConflict: "idea_id,tag_id", ignoreDuplicates: true });

        if (insertError) throw insertError;
      }

      // Return current state
      const { data, error } = await supabase
        .from("idea_tag_assignments")
        .select("*")
        .eq("idea_id", ideaId);

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["idea-tag-assignments", variables.ideaId] });
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
    },
    onError: (error: Error) => {
      toast.error(`Failed to update tags: ${error.message}`);
    },
  });
}

/**
 * Hook to bulk assign tags to multiple ideas
 */
export function useBulkAssignTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ideaIds, tagIds }: { ideaIds: string[]; tagIds: string[] }) => {
      const assignments: { idea_id: string; tag_id: string }[] = [];

      for (const ideaId of ideaIds) {
        for (const tagId of tagIds) {
          assignments.push({ idea_id: ideaId, tag_id: tagId });
        }
      }

      const { data, error } = await supabase
        .from("idea_tag_assignments")
        .upsert(assignments, { onConflict: "idea_id,tag_id", ignoreDuplicates: true })
        .select();

      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      // Invalidate all affected ideas
      for (const ideaId of variables.ideaIds) {
        queryClient.invalidateQueries({ queryKey: ["idea-tag-assignments", ideaId] });
      }
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      toast.success(`Tags assigned to ${variables.ideaIds.length} ideas`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to assign tags: ${error.message}`);
    },
  });
}

/**
 * Hook to bulk remove tags from multiple ideas
 */
export function useBulkRemoveTags() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ ideaIds, tagIds }: { ideaIds: string[]; tagIds: string[] }) => {
      // Delete all matching assignments
      await chunkedMutate(ideaIds, (chunk) =>
        supabase
          .from("idea_tag_assignments")
          .delete()
          .in("idea_id", chunk)
          .in("tag_id", tagIds)
      );
    },
    onSuccess: (_, variables) => {
      // Invalidate all affected ideas
      for (const ideaId of variables.ideaIds) {
        queryClient.invalidateQueries({ queryKey: ["idea-tag-assignments", ideaId] });
      }
      queryClient.invalidateQueries({ queryKey: ["ideas-count-by-tag"] });
      queryClient.invalidateQueries({ queryKey: ["content-ideas"] });
      toast.success(`Tags removed from ${variables.ideaIds.length} ideas`);
    },
    onError: (error: Error) => {
      toast.error(`Failed to remove tags: ${error.message}`);
    },
  });
}
