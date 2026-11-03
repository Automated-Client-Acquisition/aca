import { useMemo, useState, useCallback, useRef } from "react";
import { useVideoEditor } from "./context/VideoEditorContext";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Film, Image, Mic, Music, Volume2, Upload, Plus, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ── Asset item types ─────────────────────────────────────────────────

type AssetRole = "a-roll" | "b-roll" | "voiceover" | "music" | "sfx";

interface ProjectAsset {
  id: string;
  role: AssetRole;
  label: string;
  thumbnail?: string;
  type: "video" | "image" | "audio";
}

const ROLE_LABELS: Record<AssetRole, string> = {
  "a-roll": "A Roll",
  "b-roll": "B Roll",
  voiceover: "Voice",
  music: "Music",
  sfx: "SFX",
};

const ROLE_COLORS: Record<AssetRole, string> = {
  "a-roll": "bg-blue-500/20 text-blue-400 border-blue-500/30",
  "b-roll": "bg-purple-500/20 text-purple-400 border-purple-500/30",
  voiceover: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  music: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  sfx: "bg-rose-500/20 text-rose-400 border-rose-500/30",
};

// ── Asset thumbnail card ─────────────────────────────────────────────

function AssetCard({ asset }: { asset: ProjectAsset }) {
  const isAudio = asset.type === "audio";

  return (
    <div className="group relative rounded-md overflow-hidden border border-border bg-muted/30 hover:border-border/70 transition-colors">
      {/* Thumbnail or audio placeholder */}
      <div className="aspect-video w-full bg-muted flex items-center justify-center overflow-hidden">
        {asset.thumbnail ? (
          <img
            src={asset.thumbnail}
            alt={asset.label}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        ) : (
          <div className="flex flex-col items-center gap-1 text-muted-foreground/40">
            {isAudio ? (
              asset.role === "voiceover" ? (
                <Mic className="h-5 w-5" />
              ) : asset.role === "music" ? (
                <Music className="h-5 w-5" />
              ) : (
                <Volume2 className="h-5 w-5" />
              )
            ) : asset.type === "video" ? (
              <Film className="h-5 w-5" />
            ) : (
              <Image className="h-5 w-5" />
            )}
          </div>
        )}
      </div>

      {/* Role badge */}
      <div className="absolute top-1 left-1">
        <span
          className={cn(
            "text-[8px] font-semibold uppercase tracking-wide px-1 py-0.5 rounded border",
            ROLE_COLORS[asset.role]
          )}
        >
          {ROLE_LABELS[asset.role]}
        </span>
      </div>

      {/* Label */}
      <div className="px-1.5 py-1 flex items-center gap-1">
        <p className="text-[9px] text-muted-foreground truncate flex-1">{asset.label}</p>
      </div>
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────

export function AssetsWindow() {
  const { state, addChatUpload } = useVideoEditor();
  const { currentOrganization } = useAuth();
  const { project } = state;
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

        addChatUpload({
          url: publicUrl,
          type: isVideo ? "video" : "image",
          name: file.name,
          transcriptionState: isVideo ? "idle" : undefined,
        });
      }

      setIsUploading(false);
    },
    [currentOrganization, addChatUpload]
  );

  const assets = useMemo<ProjectAsset[]>(() => {
    const result: ProjectAsset[] = [];
    const seenUrls = new Set<string>();

    // Scene media - first scene is A roll, rest are B roll
    project.scenes.forEach((scene, index) => {
      if (!scene.media?.url || seenUrls.has(scene.media.url)) return;
      seenUrls.add(scene.media.url);

      const role: AssetRole = index === 0 ? "a-roll" : "b-roll";
      const label =
        scene.media.prompt ||
        scene.media.url.split("/").pop()?.split("?")[0] ||
        `Scene ${index + 1}`;

      result.push({
        id: scene.id,
        role,
        label,
        thumbnail: scene.media.thumbnail_url || (scene.media.type === "image" ? scene.media.url : undefined),
        type: scene.media.type === "color" ? "image" : scene.media.type,
      });
    });

    // Voiceover
    if (project.voiceover?.url) {
      result.push({
        id: "voiceover",
        role: "voiceover",
        label: project.voiceover.script
          ? project.voiceover.script.slice(0, 40) + (project.voiceover.script.length > 40 ? "..." : "")
          : "Voiceover",
        type: "audio",
      });
    }

    // Music
    if (project.music?.url) {
      result.push({
        id: "music",
        role: "music",
        label: project.music.title || "Background Music",
        type: "audio",
      });
    }

    // Sound effects
    project.sound_effects?.forEach((sfx) => {
      result.push({
        id: sfx.id,
        role: "sfx",
        label: sfx.name,
        type: "audio",
      });
    });

    return result;
  }, [project]);

  return (
    <div
      className="relative flex flex-col h-full min-h-0"
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
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border flex-shrink-0">
        <div className="flex items-center gap-1.5">
          <Upload className="h-3 w-3 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">Assets</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground tabular-nums">{assets.length}</span>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
          >
            {isUploading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Plus className="h-3 w-3" />
            )}
          </Button>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="video/*,image/*"
        className="hidden"
        onChange={(e) => e.target.files && handleFiles(e.target.files)}
      />

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {dragOver && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-primary/5 border-2 border-dashed border-primary rounded-lg">
            <p className="text-xs text-primary font-medium">Drop files here</p>
          </div>
        )}
        {assets.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center h-20 gap-1 text-center cursor-pointer"
            onClick={() => fileInputRef.current?.click()}
          >
            <Upload className="h-5 w-5 text-muted-foreground/20" />
            <p className="text-[10px] text-muted-foreground">
              {isUploading ? "Uploading..." : "Drop or click to upload"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {assets.map((asset) => (
              <AssetCard key={asset.id} asset={asset} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
