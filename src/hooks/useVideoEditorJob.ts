import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the generation job linked to a video project (if one exists).
 */
export function useVideoEditorJob(projectId: string | undefined) {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["video-editor-job", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("content_generation_jobs")
        .select("id")
        .eq("video_project_id", projectId)
        .eq("organization_id", currentOrganization!.id)
        .eq("pipeline", "remotion_editor")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!projectId && !!currentOrganization,
    retry: false,
  });
}

/**
 * Creates a generation job of type remotion_editor linked to a video project.
 * Should only be called once per project (on the first autosave).
 */
export function useCreateVideoEditorJob() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      projectId,
      projectTitle,
    }: {
      projectId: string;
      projectTitle: string;
    }) => {
      if (!currentOrganization || !user) throw new Error("Not authenticated");

      const { data, error } = await supabase
        .from("content_generation_jobs")
        .insert({
          organization_id: currentOrganization.id,
          user_id: user.id,
          pipeline: "remotion_editor",
          status: "completed",
          name: projectTitle,
          video_project_id: projectId,
          items: [] as any,
          configuration: { blueprint_name: "Video Editor" } as any,
          progress: { total: 0, completed: 0, failed: 0 } as any,
          cost: { estimated: 0, current: 0 } as any,
        })
        .select("id")
        .single();

      if (error) throw error;
      return data.id as string;
    },
    onSuccess: (_, { projectId }) => {
      queryClient.invalidateQueries({ queryKey: ["video-editor-job", projectId] });
      queryClient.invalidateQueries({ queryKey: ["generation-jobs"] });
    },
  });
}

/**
 * Keeps the job name in sync with the project title.
 */
export function useUpdateVideoEditorJobTitle() {
  return useMutation({
    mutationFn: async ({ jobId, title }: { jobId: string; title: string }) => {
      const { error } = await supabase
        .from("content_generation_jobs")
        .update({ name: title })
        .eq("id", jobId);
      if (error) throw error;
    },
  });
}
