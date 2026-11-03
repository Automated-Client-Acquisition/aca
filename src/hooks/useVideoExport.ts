import { useState, useCallback, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { VideoProject } from "@/types/videoEditor";

type ExportStatus = "idle" | "exporting" | "completed" | "failed";

function deriveStatus(project?: VideoProject): ExportStatus {
  if (project?.status === "completed" && project?.output_url) return "completed";
  if (project?.status === "rendering") return "exporting";
  if (project?.status === "failed") return "failed";
  return "idle";
}

export function useVideoExport(projectId: string | undefined, project?: VideoProject) {
  const [status, setStatus] = useState<ExportStatus>(() => deriveStatus(project));
  const [outputUrl, setOutputUrl] = useState<string | null>(
    () => (project?.status === "completed" ? project?.output_url || null : null)
  );
  const [error, setError] = useState<string | null>(
    () => (project?.status === "failed" ? project?.render_error || null : null)
  );

  // Sync local state when the project prop changes (e.g. refetch after navigation)
  useEffect(() => {
    if (!project) return;
    const derived = deriveStatus(project);
    setStatus(derived);
    if (derived === "completed") {
      setOutputUrl(project.output_url || null);
      setError(null);
    } else if (derived === "failed") {
      setError(project.render_error || "Render failed");
      setOutputUrl(null);
    }
  }, [project?.status, project?.output_url, project?.render_error]);

  // Subscribe to realtime status updates while exporting
  useEffect(() => {
    if (!projectId || status !== "exporting") return;

    const channel = supabase
      .channel(`video-project-${projectId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "video_projects",
          filter: `id=eq.${projectId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (updated.status === "completed") {
            setStatus("completed");
            setOutputUrl(updated.output_url);
          } else if (updated.status === "failed") {
            setStatus("failed");
            setError(updated.render_error || "Render failed");
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [projectId, status]);

  const exportVideo = useCallback(
    async (project: VideoProject) => {
      setStatus("exporting");
      setError(null);
      setOutputUrl(null);

      try {
        const { error: fnError } = await supabase.functions.invoke(
          "render-video-project",
          {
            body: { project_id: project.id },
          }
        );

        if (fnError) {
          throw fnError;
        }
      } catch (err: any) {
        setStatus("failed");
        setError(err.message || "Export failed");
      }
    },
    []
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setOutputUrl(null);
    setError(null);
  }, []);

  return { status, outputUrl, error, exportVideo, reset };
}
