import { useState } from "react";
import { useSavedContent } from "@/hooks/useSavedContent";
import { useVideoEditor } from "../context/VideoEditorContext";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Search,
  Image,
  Film,
  FileText,
  Music,
  Plus,
  Star,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { SavedContent, SavedContentType } from "@/types/savedContent";
import type { VideoScene } from "@/types/videoEditor";

// ── Helpers ─────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

const TYPE_ICONS: Record<SavedContentType, React.ReactNode> = {
  image: <Image className="h-3 w-3" />,
  video: <Film className="h-3 w-3" />,
  text: <FileText className="h-3 w-3" />,
  audio: <Music className="h-3 w-3" />,
};

const TYPE_TABS: { label: string; value: SavedContentType | "all" }[] = [
  { label: "All", value: "all" },
  { label: "Images", value: "image" },
  { label: "Videos", value: "video" },
  { label: "Text", value: "text" },
];

// ── Asset card ──────────────────────────────────────────────────────

function AssetCard({
  item,
  onAdd,
}: {
  item: SavedContent;
  onAdd: (item: SavedContent) => void;
}) {
  const contentData = item.content as any;
  const thumbnail =
    contentData?.thumbnail_url || (item.content_type === "image" ? contentData?.url : null);

  return (
    <div className="group relative rounded-lg border border-border bg-muted/30 overflow-hidden hover:border-border/80 transition-colors">
      {/* Thumbnail / preview */}
      {thumbnail ? (
        <div className="aspect-video w-full overflow-hidden bg-muted">
          <img
            src={thumbnail}
            alt={item.name}
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).style.display = "none";
            }}
          />
        </div>
      ) : (
        <div className="aspect-video w-full flex items-center justify-center bg-muted">
          <span className="text-muted-foreground">
            {TYPE_ICONS[item.content_type]}
          </span>
        </div>
      )}

      {/* Info row */}
      <div className="px-2 py-1.5 flex items-center gap-1.5">
        <span className="text-muted-foreground flex-shrink-0">
          {TYPE_ICONS[item.content_type]}
        </span>
        <p className="text-[10px] text-foreground truncate flex-1">{item.name}</p>
        {item.is_favorite && (
          <Star className="h-2.5 w-2.5 text-amber-400 flex-shrink-0 fill-amber-400" />
        )}
      </div>

      {/* Hover overlay - add button */}
      {(item.content_type === "image" || item.content_type === "video") && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-[10px] gap-1 bg-background/90"
            onClick={() => onAdd(item)}
          >
            <Plus className="h-3 w-3" />
            Add to scene
          </Button>
        </div>
      )}

      {/* Text content - show snippet */}
      {item.content_type === "text" && (
        <div className="px-2 pb-1.5">
          <p className="text-[9px] text-muted-foreground line-clamp-2">
            {(item.content as any)?.text || ""}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="mt-1 h-5 text-[9px] w-full"
            onClick={() => onAdd(item)}
          >
            Copy text
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Main panel ──────────────────────────────────────────────────────

export function SavedAssetsPanel() {
  const [search, setSearch] = useState("");
  const [activeType, setActiveType] = useState<SavedContentType | "all">("all");

  const { savedContent, isLoading } = useSavedContent(
    activeType !== "all" ? activeType : undefined
  );

  const { addScene, state } = useVideoEditor();

  const filtered = savedContent.filter(
    (item) =>
      !search ||
      item.name.toLowerCase().includes(search.toLowerCase()) ||
      (item.description || "").toLowerCase().includes(search.toLowerCase())
  );

  function handleAdd(item: SavedContent) {
    const contentData = item.content as any;

    if (item.content_type === "image") {
      const scene: VideoScene = {
        id: `scene_${generateId()}`,
        order: state.project.scenes.length,
        duration: 5,
        media: {
          type: "image",
          url: contentData.url || "",
          source: "uploaded",
          prompt: contentData.prompt,
        },
        transition: "fade",
      };
      addScene(scene);
      toast.success("Image added as new scene");
    } else if (item.content_type === "video") {
      const scene: VideoScene = {
        id: `scene_${generateId()}`,
        order: state.project.scenes.length,
        duration: Math.round(contentData.duration || 5),
        media: {
          type: "video",
          url: contentData.url || "",
          thumbnail_url: contentData.thumbnail_url,
          source: "uploaded",
        },
        transition: "fade",
      };
      addScene(scene);
      toast.success("Video added as new scene");
    } else if (item.content_type === "text") {
      const text = contentData?.text || "";
      navigator.clipboard.writeText(text).then(() => {
        toast.success("Text copied to clipboard");
      });
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="p-2 border-b border-border space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <Input
            placeholder="Search saved assets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-6 h-7 text-xs"
          />
        </div>

        {/* Type tabs */}
        <div className="flex gap-1">
          {TYPE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setActiveType(tab.value)}
              className={cn(
                "flex-1 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors",
                activeType === tab.value
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-y-auto p-2 min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center h-20">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-20 text-center gap-1">
            <Image className="h-6 w-6 text-muted-foreground/20" />
            <p className="text-[10px] text-muted-foreground">
              {search ? "No assets match your search" : "No saved assets yet"}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-1.5">
            {filtered.map((item) => (
              <AssetCard key={item.id} item={item} onAdd={handleAdd} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
