import { useParams } from "react-router-dom";
import { useCallback, useRef } from "react";
import { VideoEditorProvider } from "@/components/video-editor/context/VideoEditorContext";
import { VideoEditorLayout } from "@/components/video-editor/VideoEditorLayout";
import { useVideoProject, useCreateVideoProject, useSaveVideoProject } from "@/hooks/useVideoProject";
import { useCreateVideoEditorJob } from "@/hooks/useVideoEditorJob";
import type { VideoProject } from "@/types/videoEditor";
import { Loader2 } from "lucide-react";

export default function VideoEditorPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { data: project, isLoading } = useVideoProject(projectId);
  const saveProject = useSaveVideoProject();
  const createProject = useCreateVideoProject();
  const createJob = useCreateVideoEditorJob();
  const saveRef = useRef(saveProject);
  saveRef.current = saveProject;
  const creatingRef = useRef(false);

  const handleSave = useCallback(
    async (project: VideoProject) => {
      if (!project.id) return;
      try {
        await saveRef.current.mutateAsync(project);
      } catch (err) {
        console.error("[VideoEditor] Save failed:", err);
      }
    },
    []
  );

  const handleFirstSave = useCallback(async (): Promise<VideoProject> => {
    if (creatingRef.current) throw new Error("Already creating project");
    creatingRef.current = true;
    try {
      const newProject = await createProject.mutateAsync({});
      await createJob.mutateAsync({
        projectId: newProject.id,
        projectTitle: newProject.title,
      });
      window.history.replaceState(null, "", `/editor/${newProject.id}`);
      return newProject;
    } finally {
      creatingRef.current = false;
    }
  }, [createProject, createJob]);

  // Loading state only when fetching an existing project
  if (projectId && isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading project...</p>
        </div>
      </div>
    );
  }

  return (
    <VideoEditorProvider
      initialProject={project || undefined}
      onSave={handleSave}
      onFirstSave={projectId ? undefined : handleFirstSave}
    >
      <VideoEditorLayout />
    </VideoEditorProvider>
  );
}
