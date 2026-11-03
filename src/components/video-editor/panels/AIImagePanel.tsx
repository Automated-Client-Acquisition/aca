import { useState, useCallback } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Wand2, Loader2, Sparkles } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useAIGenerate } from "@/hooks/useAIGenerate";
import type { VideoScene } from "@/types/videoEditor";

export function AIImagePanel() {
  const [prompt, setPrompt] = useState("");
  const { generateImage, isGenerating, generatedImages } = useAIGenerate();
  const { selectedScene, updateScene, addScene, selectScene, state } =
    useVideoEditor();

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    await generateImage(prompt.trim(), state.project.settings.aspect_ratio);
  }, [prompt, generateImage, state.project.settings.aspect_ratio]);

  const applyImage = useCallback(
    (url: string) => {
      if (selectedScene) {
        updateScene(selectedScene.id, {
          media: {
            type: "image",
            url,
            thumbnail_url: url,
            source: "ai_image",
            prompt,
          },
        });
      } else {
        const newScene: VideoScene = {
          id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          order: state.project.scenes.length,
          duration: 5,
          media: {
            type: "image",
            url,
            thumbnail_url: url,
            source: "ai_image",
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
          placeholder="Describe the image you want to generate..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="text-xs min-h-[60px] resize-none"
        />
        <Button
          variant="cta"
          size="sm"
          className="w-full"
          onClick={handleGenerate}
          disabled={isGenerating || !prompt.trim()}
        >
          {isGenerating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
              Generating...
            </>
          ) : (
            <>
              <Wand2 className="h-3.5 w-3.5 mr-1.5" />
              Generate Image
            </>
          )}
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {generatedImages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Sparkles className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">
              AI-generated images will appear here
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {generatedImages.map((img, i) => (
            <button
              key={i}
              onClick={() => applyImage(img.url)}
              className="group relative rounded-md overflow-hidden bg-muted aspect-square hover:ring-2 ring-primary transition-all"
            >
              <img
                src={img.url}
                alt={img.prompt}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
