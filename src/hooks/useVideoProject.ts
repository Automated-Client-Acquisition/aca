import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { VideoProject } from "@/types/videoEditor";

export function useVideoProject(projectId: string | undefined) {
  const { currentOrganization } = useAuth();

  const query = useQuery({
    queryKey: ["video-project", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      const { data, error } = await supabase
        .from("video_projects")
        .select("*")
        .eq("id", projectId)
        .single();
      if (error) throw error;
      return data as unknown as VideoProject;
    },
    enabled: !!projectId && !!currentOrganization,
    retry: false,
    // Poll every 5s while rendering to catch status changes if Realtime misses them
    refetchInterval: (query) => {
      const status = (query.state.data as VideoProject | null)?.status;
      return status === "rendering" ? 5000 : false;
    },
  });

  return query;
}

export function useVideoProjects() {
  const { currentOrganization } = useAuth();

  return useQuery({
    queryKey: ["video-projects", currentOrganization?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("video_projects")
        .select("*")
        .eq("organization_id", currentOrganization!.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as unknown as VideoProject[];
    },
    enabled: !!currentOrganization,
    retry: false,
  });
}

export function useCreateVideoProject() {
  const { currentOrganization, user } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (
      input: Partial<VideoProject> & { title?: string }
    ) => {
      const { data, error } = await supabase
        .from("video_projects")
        .insert({
          organization_id: currentOrganization!.id,
          user_id: user!.id,
          title: input.title || "Untitled Video",
          scenes: (input.scenes || []) as unknown as Record<string, unknown>[],
          settings: (input.settings || {
            aspect_ratio: "portrait",
            caption_style: "hormozi",
          }) as unknown as Record<string, unknown>,
          voiceover: (input.voiceover || null) as unknown as Record<string, unknown> | null,
          music: (input.music || null) as unknown as Record<string, unknown> | null,
          status: "draft",
        })
        .select()
        .single();
      if (error) throw error;
      return data as unknown as VideoProject;
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["video-projects", currentOrganization?.id],
      });
    },
  });
}

export function useDeleteVideoProject() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectId: string) => {
      const { error } = await supabase
        .from("video_projects")
        .delete()
        .eq("id", projectId);
      if (error) throw error;
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["video-projects", currentOrganization?.id],
      });
    },
  });
}

export function useBulkDeleteVideoProjects() {
  const { currentOrganization } = useAuth();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (projectIds: string[]) => {
      const { error } = await supabase
        .from("video_projects")
        .delete()
        .in("id", projectIds);
      if (error) throw error;
    },
    retry: false,
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["video-projects", currentOrganization?.id],
      });
    },
  });
}

export function useSaveVideoProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (project: VideoProject) => {
      if (!project.id) throw new Error("Cannot save project without ID");
      const { error } = await supabase
        .from("video_projects")
        .update({
          title: project.title,
          scenes: project.scenes as unknown as Record<string, unknown>[],
          settings: project.settings as unknown as Record<string, unknown>,
          voiceover: (project.voiceover || null) as unknown as Record<string, unknown> | null,
          music: (project.music || null) as unknown as Record<string, unknown> | null,
          sound_effects: (project.sound_effects || null) as unknown as Record<string, unknown>[] | null,
        })
        .eq("id", project.id);
      if (error) throw error;
    },
    retry: false,
    onSuccess: (_, project) => {
      queryClient.invalidateQueries({
        queryKey: ["video-project", project.id],
      });
    },
  });
}
