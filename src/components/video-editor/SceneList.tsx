import { useVideoEditor } from "./context/VideoEditorContext";
import { Button } from "@/components/ui/button";
import { Plus, Trash2, GripVertical, Image, Film, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import type { VideoScene } from "@/types/videoEditor";
import { useCallback, useRef } from "react";

function generateSceneId() {
  return `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function SceneList() {
  const { state, addScene, removeScene, selectScene, reorderScenes } =
    useVideoEditor();
  const { project, selectedSceneId } = state;
  const dragItemRef = useRef<number | null>(null);
  const dragOverRef = useRef<number | null>(null);

  const handleAddScene = useCallback(() => {
    const newScene: VideoScene = {
      id: generateSceneId(),
      order: project.scenes.length,
      duration: 5,
      media: { type: "color", url: "#1a1a2e", source: "uploaded" },
      transition: "fade",
    };
    addScene(newScene);
    selectScene(newScene.id);
  }, [project.scenes.length, addScene, selectScene]);

  const handleDragStart = (index: number) => {
    dragItemRef.current = index;
  };

  const handleDragEnter = (index: number) => {
    dragOverRef.current = index;
  };

  const handleDragEnd = () => {
    if (
      dragItemRef.current !== null &&
      dragOverRef.current !== null &&
      dragItemRef.current !== dragOverRef.current
    ) {
      const sorted = [...project.scenes].sort((a, b) => a.order - b.order);
      const [dragged] = sorted.splice(dragItemRef.current, 1);
      sorted.splice(dragOverRef.current, 0, dragged);
      reorderScenes(sorted.map((s) => s.id));
    }
    dragItemRef.current = null;
    dragOverRef.current = null;
  };

  const sortedScenes = [...project.scenes].sort((a, b) => a.order - b.order);

  const getMediaIcon = (scene: VideoScene) => {
    switch (scene.media.type) {
      case "video":
        return <Film className="h-3 w-3" />;
      case "image":
        return <Image className="h-3 w-3" />;
      case "color":
        return <Palette className="h-3 w-3" />;
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {sortedScenes.map((scene, index) => (
          <div
            key={scene.id}
            draggable
            onDragStart={() => handleDragStart(index)}
            onDragEnter={() => handleDragEnter(index)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => selectScene(scene.id)}
            className={cn(
              "group flex items-center gap-2 p-1.5 rounded-lg cursor-pointer transition-all",
              "hover:bg-accent/50",
              selectedSceneId === scene.id
                ? "bg-accent ring-1 ring-primary/50 shadow-sm"
                : "border border-transparent"
            )}
          >
            <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 cursor-grab flex-shrink-0" />

            {/* Thumbnail */}
            <div className="w-14 h-9 rounded-md bg-muted flex-shrink-0 overflow-hidden flex items-center justify-center border border-border/50">
              {scene.media.type === "color" ? (
                <div
                  className="w-full h-full"
                  style={{ backgroundColor: scene.media.url || "#1a1a2e" }}
                />
              ) : scene.media.thumbnail_url || scene.media.url ? (
                <img
                  src={scene.media.thumbnail_url || scene.media.url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-muted-foreground/40">
                  {getMediaIcon(scene)}
                </div>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate">
                Scene {index + 1}
              </div>
              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                {getMediaIcon(scene)}
                <span>{scene.duration}s</span>
                <span className="text-muted-foreground/50">{scene.transition}</span>
              </div>
            </div>

            {/* Delete */}
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 opacity-0 group-hover:opacity-100 flex-shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                removeScene(scene.id);
              }}
            >
              <Trash2 className="h-3 w-3 text-destructive" />
            </Button>
          </div>
        ))}

        {/* Add scene button */}
        <button
          onClick={handleAddScene}
          className="w-full flex items-center gap-2 p-2 rounded-lg border border-dashed border-border hover:border-primary/40 hover:bg-accent/30 transition-colors text-muted-foreground hover:text-foreground"
        >
          <div className="w-14 h-9 rounded-md bg-muted/50 flex items-center justify-center flex-shrink-0">
            <Plus className="h-4 w-4" />
          </div>
          <span className="text-xs">Add Scene</span>
        </button>

        {sortedScenes.length === 0 && (
          <div className="flex flex-col items-center justify-center py-6 text-center px-4">
            <div className="w-12 h-12 rounded-full bg-muted/50 flex items-center justify-center mb-3">
              <Film className="h-5 w-5 text-muted-foreground/40" />
            </div>
            <p className="text-xs text-muted-foreground">
              Start by adding your first scene
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
