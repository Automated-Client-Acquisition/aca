import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { AspectRatio } from "@/types/videoEditor";

interface GeneratedImage {
  url: string;
  prompt: string;
}

interface GeneratedVideo {
  url: string;
  thumbnail?: string;
  prompt: string;
}

export function useAIGenerate() {
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  const [generatedImages, setGeneratedImages] = useState<GeneratedImage[]>([]);
  const [generatedVideos, setGeneratedVideos] = useState<GeneratedVideo[]>([]);
  const { currentOrganization } = useAuth();

  const generateImage = useCallback(
    async (prompt: string, aspectRatio: AspectRatio) => {
      if (!currentOrganization?.id) return;
      setIsGenerating(true);

      try {
        const { data, error } = await supabase.functions.invoke(
          "editor-generate-media",
          {
            body: {
              type: "image",
              prompt,
              aspect_ratio: aspectRatio,
              organization_id: currentOrganization.id,
            },
          }
        );

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        if (data?.image_url) {
          setGeneratedImages((prev) => [
            { url: data.image_url, prompt },
            ...prev,
          ]);
          toast.success("Image generated");
        }
      } catch (err: any) {
        console.error("Image generation failed:", err);
        const message = err?.message || "Unknown error";
        if (message.includes("Replicate API key not configured")) {
          toast.error("Replicate API key not configured", {
            description: "Add your Replicate API key in Settings → API Keys.",
            action: {
              label: "Go to Settings",
              onClick: () => (window.location.href = "/settings"),
            },
          });
        } else {
          toast.error("Image generation failed", { description: message });
        }
      } finally {
        setIsGenerating(false);
      }
    },
    [currentOrganization]
  );

  const generateVideo = useCallback(
    async (prompt: string, aspectRatio: AspectRatio) => {
      if (!currentOrganization?.id) return;
      setIsGeneratingVideo(true);

      try {
        const { data, error } = await supabase.functions.invoke(
          "editor-generate-media",
          {
            body: {
              type: "video",
              prompt,
              aspect_ratio: aspectRatio,
              organization_id: currentOrganization.id,
            },
          }
        );

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        if (data?.video_url) {
          setGeneratedVideos((prev) => [
            { url: data.video_url, thumbnail: data.thumbnail_url, prompt },
            ...prev,
          ]);
          toast.success("Video generated");
        }
      } catch (err: any) {
        console.error("Video generation failed:", err);
        const message = err?.message || "Unknown error";
        if (message.includes("Replicate API key not configured")) {
          toast.error("Replicate API key not configured", {
            description: "Add your Replicate API key in Settings → API Keys.",
            action: {
              label: "Go to Settings",
              onClick: () => (window.location.href = "/settings"),
            },
          });
        } else {
          toast.error("Video generation failed", { description: message });
        }
      } finally {
        setIsGeneratingVideo(false);
      }
    },
    [currentOrganization]
  );

  return {
    generateImage,
    generateVideo,
    isGenerating,
    isGeneratingVideo,
    generatedImages,
    generatedVideos,
  };
}
