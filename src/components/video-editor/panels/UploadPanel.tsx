import { useState, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, Film, Image, X } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import type { VideoScene } from "@/types/videoEditor";

interface UploadedAsset {
  url: string;
  type: "video" | "image";
  name: string;
}

export function UploadPanel() {
  const [uploads, setUploads] = useState<UploadedAsset[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { selectedScene, updateScene, addScene, selectScene, state } =
    useVideoEditor();
  const { currentOrganization } = useAuth();

  const handleFiles = useCallback(
    async (files: FileList) => {
      if (!currentOrganization?.id) return;
      setIsUploading(true);

      for (const file of Array.from(files)) {
        const isVideo = file.type.startsWith("video/");
        const isImage = file.type.startsWith("image/");
        if (!isVideo && !isImage) continue;

        const ext = file.name.split(".").pop() || "mp4";
        const path = `video-editor/${currentOrganization.id}/${Date.now()}_${Math.random().toString(36).slice(2, 6)}.${ext}`;

        const { error } = await supabase.storage
          .from("content-media")
          .upload(path, file, { contentType: file.type });

        if (error) {
          console.error("Upload failed:", error);
          continue;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("content-media").getPublicUrl(path);

        setUploads((prev) => [
          ...prev,
          {
            url: publicUrl,
            type: isVideo ? "video" : "image",
            name: file.name,
          },
        ]);
      }

      setIsUploading(false);
    },
    [currentOrganization]
  );

  const applyAsset = useCallback(
    (asset: UploadedAsset) => {
      if (selectedScene) {
        updateScene(selectedScene.id, {
          media: {
            type: asset.type,
            url: asset.url,
            thumbnail_url: asset.type === "image" ? asset.url : undefined,
            source: "uploaded",
          },
        });
      } else {
        const newScene: VideoScene = {
          id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          order: state.project.scenes.length,
          duration: 5,
          media: {
            type: asset.type,
            url: asset.url,
            thumbnail_url: asset.type === "image" ? asset.url : undefined,
            source: "uploaded",
          },
          transition: "fade",
        };
        addScene(newScene);
        selectScene(newScene.id);
      }
    },
    [selectedScene, updateScene, addScene, selectScene, state.project.scenes.length]
  );

  return (
    <div className="flex flex-col h-full">
      {/* Drop zone */}
      <div className="px-3 py-3 border-b border-border">
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors cursor-pointer ${
            dragOver
              ? "border-primary bg-primary/5"
              : "border-muted-foreground/20 hover:border-muted-foreground/40"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? (
            <Loader2 className="h-6 w-6 mx-auto text-muted-foreground animate-spin" />
          ) : (
            <Upload className="h-6 w-6 mx-auto text-muted-foreground/40" />
          )}
          <p className="text-xs text-muted-foreground mt-2">
            {isUploading
              ? "Uploading..."
              : "Drop video or images here, or click to browse"}
          </p>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*"
          className="hidden"
          onChange={(e) => e.target.files && handleFiles(e.target.files)}
        />
      </div>

      {/* Uploaded assets */}
      <div className="flex-1 overflow-y-auto p-2">
        {uploads.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Uploaded files will appear here
          </p>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {uploads.map((asset, i) => (
            <button
              key={i}
              onClick={() => applyAsset(asset)}
              className="group relative rounded-md overflow-hidden bg-muted aspect-video hover:ring-2 ring-primary transition-all"
            >
              {asset.type === "image" ? (
                <img
                  src={asset.url}
                  alt=""
                  className="w-full h-full object-cover"
                />
              ) : (
                <video
                  src={asset.url}
                  className="w-full h-full object-cover"
                  muted
                />
              )}
              <div className="absolute bottom-1 left-1 flex items-center gap-0.5 text-[9px] bg-black/70 text-white px-1 py-0.5 rounded">
                {asset.type === "video" ? (
                  <Film className="h-2.5 w-2.5" />
                ) : (
                  <Image className="h-2.5 w-2.5" />
                )}
                <span className="truncate max-w-[60px]">{asset.name}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
