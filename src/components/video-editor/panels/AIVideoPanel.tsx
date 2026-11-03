import { useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Film, Loader2, Sparkles } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useAIGenerate } from "@/hooks/useAIGenerate";
import type { VideoScene } from "@/types/videoEditor";

export function AIVideoPanel() {
  const [prompt, setPrompt] = useState("");
  const { generateVideo, isGeneratingVideo, generatedVideos } = useAIGenerate();
  const { selectedScene, updateScene, addScene, selectScene, state } =
    useVideoEditor();

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    await generateVideo(prompt.trim(), state.project.settings.aspect_ratio);
  }, [prompt, generateVideo, state.project.settings.aspect_ratio]);

  const applyVideo = useCallback(
    (url: string, thumbnail?: string) => {
      if (selectedScene) {
        updateScene(selectedScene.id, {
          media: {
            type: "video",
            url,
            thumbnail_url: thumbnail,
            source: "ai_video",
            prompt,
          },
        });
      } else {
        const newScene: VideoScene = {
          id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          order: state.project.scenes.length,
          duration: 5,
          media: {
            type: "video",
            url,
            thumbnail_url: thumbnail,
            source: "ai_video",
            prompt,
          },
          transition: "fade",
        };
        addScene(newScene);
        selectScene(newScene.id);
      }
    },
    [selectedScene, updateScene, addScene, selectScene, state.project.scenes.length, prompt]
  );

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-border space-y-2">
        <Textarea
          placeholder="Describe the video clip you want to generate..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="text-xs min-h-[60px] resize-none"
        />
        <Button
          variant="cta"
          size="sm"
          className="w-full"
          onClick={handleGenerate}
          disabled={isGeneratingVideo || !prompt.trim()}
        >
          {isGeneratingVideo ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Film className="h-3.5 w-3.5 mr-1.5" />
              Generate Video
            </>
          )}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {generatedVideos.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">
              AI-generated video clips will appear here
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Uses Replicate video models
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {generatedVideos.map((vid, i) => (
            <button
              key={i}
              onClick={() => applyVideo(vid.url, vid.thumbnail)}
              className="group relative rounded-md overflow-hidden bg-muted aspect-video hover:ring-2 ring-primary transition-all"
            >
              {vid.thumbnail ? (
                <img
                  src={vid.thumbnail}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={vid.url}
                  className="w-full h-full object-cover"
                  muted
                />
              )}
              <div className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white px-1 py-0.5 rounded">
                AI
              </div>
              <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
