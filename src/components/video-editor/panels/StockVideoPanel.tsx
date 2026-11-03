import { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Search, Loader2, Film, Image } from "lucide-react";
import { useVideoEditor } from "../context/VideoEditorContext";
import { useStockMedia } from "@/hooks/useStockMedia";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { VideoScene } from "@/types/videoEditor";

export function StockVideoPanel() {
  const [query, setQuery] = useState("");
  const [mediaType, setMediaType] = useState<"videos" | "photos">("videos");
  const { searchResults, isSearching, search } = useStockMedia();
  const { selectedScene, updateScene, addScene, selectScene, state } = useVideoEditor();

  const handleSearch = useCallback(() => {
    if (query.trim()) {
      search(query.trim(), mediaType, state.project.settings.aspect_ratio);
    }
  }, [query, mediaType, search, state.project.settings.aspect_ratio]);

  const applyMedia = useCallback(
    (url: string, thumbnail: string, type: "video" | "image") => {
      if (selectedScene) {
        updateScene(selectedScene.id, {
          media: {
            type,
            url,
            thumbnail_url: thumbnail,
            source: "stock",
          },
        });
      } else {
        const newScene: VideoScene = {
          id: `scene_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          order: state.project.scenes.length,
          duration: 5,
          media: { type, url, thumbnail_url: thumbnail, source: "stock" },
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
      <div className="px-3 py-2 border-b border-border space-y-2">
        <div className="flex gap-1.5">
          <Input
            placeholder="Search stock media..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            className="h-8 text-xs"
          />
          <Button
            variant="cta"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleSearch}
            disabled={isSearching}
          >
            {isSearching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        <Tabs value={mediaType} onValueChange={(v) => setMediaType(v as "videos" | "photos")}>
          <TabsList className="h-7 w-full">
            <TabsTrigger value="videos" className="text-[10px] flex-1 gap-1">
              <Film className="h-3 w-3" /> Videos
            </TabsTrigger>
            <TabsTrigger value="photos" className="text-[10px] flex-1 gap-1">
              <Image className="h-3 w-3" /> Photos
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {searchResults.length === 0 && !isSearching && (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Search className="h-8 w-8 text-muted-foreground/20 mb-2" />
            <p className="text-xs text-muted-foreground">
              Search for stock {mediaType}
            </p>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              Powered by Pexels
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {searchResults.map((item) => (
            <button
              key={item.id}
              onClick={() =>
                applyMedia(
                  item.url,
                  item.thumbnail_url,
                  "thumbnail_url" in item && item.duration ? "video" : "image"
                )
              }
              className="group relative rounded-md overflow-hidden bg-muted aspect-video hover:ring-2 ring-primary transition-all"
            >
              <img
                src={item.thumbnail_url}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {item.duration && (
                <span className="absolute bottom-1 right-1 text-[9px] bg-black/70 text-white px-1 py-0.5 rounded">
                  {item.duration}s
                </span>
              )}
              <div className="absolute inset-0 bg-primary/10 opacity-0 group-hover:opacity-100 transition-opacity" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
