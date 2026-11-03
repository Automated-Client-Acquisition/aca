import { useState, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useSavedContent } from "@/hooks/useSavedContent";
import {
  Search,
  FileText,
  Image,
  Video,
  Music,
  Star,
  Check,
  Bookmark,
} from "lucide-react";
import type {
  SavedContent,
  SavedContentType,
  TextContentData,
  ImageContentData,
  VideoContentData,
  AudioContentData,
} from "@/types/savedContent";

type FilterType = "all" | SavedContentType;

interface SavedContentPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (item: SavedContent) => void;
  /** Filter to specific content types */
  allowedTypes?: SavedContentType[];
  /** Title for the dialog */
  title?: string;
  /** Allow multiple selections */
  multiple?: boolean;
  /** Currently selected item IDs (for multiple mode) */
  selectedIds?: string[];
}

const contentTypeIcons: Record<SavedContentType, React.ReactNode> = {
  text: <FileText className="h-4 w-4" />,
  image: <Image className="h-4 w-4" />,
  video: <Video className="h-4 w-4" />,
  audio: <Music className="h-4 w-4" />,
};

const contentTypeColors: Record<SavedContentType, string> = {
  text: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  image: "bg-green-500/10 text-green-600 border-green-500/20",
  video: "bg-primary/10 text-primary border-primary/20",
  audio: "bg-orange-500/10 text-orange-600 border-orange-500/20",
};

function getContentPreview(item: SavedContent): string {
  switch (item.content_type) {
    case "text":
      return (item.content as TextContentData).text?.substring(0, 150) + "..." || "";
    case "image":
      return (item.content as ImageContentData).prompt || "Image";
    case "video":
      const videoDuration = (item.content as VideoContentData).duration;
      return videoDuration ? `Video (${videoDuration}s)` : "Video";
    case "audio":
      const audioContent = item.content as AudioContentData;
      return audioContent.transcript?.substring(0, 150) + "..." ||
        (audioContent.duration ? `Audio (${audioContent.duration}s)` : "Audio");
    default:
      return "";
  }
}

function ContentThumbnail({ item }: { item: SavedContent }) {
  if (item.content_type === "image") {
    const url = (item.content as ImageContentData).url;
    return url ? (
      <img src={url} alt={item.name} className="h-12 w-12 rounded object-cover" />
    ) : (
      <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
        <Image className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  if (item.content_type === "video") {
    const thumbnail = (item.content as VideoContentData).thumbnail_url;
    return thumbnail ? (
      <img src={thumbnail} alt={item.name} className="h-12 w-12 rounded object-cover" />
    ) : (
      <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
        <Video className="h-6 w-6 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-12 w-12 rounded bg-muted flex items-center justify-center">
      {contentTypeIcons[item.content_type]}
    </div>
  );
}

export function SavedContentPicker({
  open,
  onOpenChange,
  onSelect,
  allowedTypes,
  title = "Select from Library",
  multiple = false,
  selectedIds = [],
}: SavedContentPickerProps) {
  const { savedContent, isLoading } = useSavedContent();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");

  // Filter content based on allowed types
  const filteredByType = useMemo(() => {
    if (!allowedTypes || allowedTypes.length === 0) return savedContent;
    return savedContent.filter((item) => allowedTypes.includes(item.content_type));
  }, [savedContent, allowedTypes]);

  // Filter by active tab
  const filteredByTab = useMemo(() => {
    if (activeFilter === "all") return filteredByType;
    return filteredByType.filter((item) => item.content_type === activeFilter);
  }, [filteredByType, activeFilter]);

  // Filter by search query
  const filteredContent = useMemo(() => {
    if (!searchQuery) return filteredByTab;
    const query = searchQuery.toLowerCase();
    return filteredByTab.filter(
      (item) =>
        item.name?.toLowerCase().includes(query) ||
        item.description?.toLowerCase().includes(query) ||
        item.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  }, [filteredByTab, searchQuery]);

  // Get unique types for tabs
  const availableTypes = useMemo(() => {
    const types = new Set(filteredByType.map((item) => item.content_type));
    return Array.from(types) as SavedContentType[];
  }, [filteredByType]);

  const handleSelect = (item: SavedContent) => {
    onSelect(item);
    if (!multiple) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bookmark className="h-5 w-5" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 flex-1 min-h-0 flex flex-col">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search saved content..."
              className="pl-9"
            />
          </div>

          {/* Type Tabs - only show if multiple types available */}
          {availableTypes.length > 1 && (
            <Tabs value={activeFilter} onValueChange={(v) => setActiveFilter(v as FilterType)}>
              <TabsList className="w-full justify-start">
                <TabsTrigger value="all" className="gap-1.5">
                  All
                  <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">
                    {filteredByType.length}
                  </Badge>
                </TabsTrigger>
                {availableTypes.map((type) => (
                  <TabsTrigger key={type} value={type} className="gap-1.5">
                    {contentTypeIcons[type]}
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}

          {/* Content List */}
          <ScrollArea className="flex-1 min-h-0 -mx-6 px-6">
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-20 w-full" />
                ))}
              </div>
            ) : filteredContent.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bookmark className="h-12 w-12 text-muted-foreground/50 mb-4" />
                <p className="text-muted-foreground">
                  {searchQuery
                    ? "No saved content matches your search"
                    : "No saved content yet"}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Save content from your jobs to use here
                </p>
              </div>
            ) : (
              <div className="space-y-2 pb-4">
                {filteredContent.map((item) => {
                  const isSelected = selectedIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      onClick={() => handleSelect(item)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg border text-left transition-colors hover:bg-muted/50 ${
                        isSelected
                          ? "border-primary bg-primary/5"
                          : "border-border"
                      }`}
                    >
                      <ContentThumbnail item={item} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium truncate">{item.name}</span>
                          {item.is_favorite && (
                            <Star className="h-3.5 w-3.5 fill-yellow-400 text-yellow-400 shrink-0" />
                          )}
                          {isSelected && (
                            <Check className="h-4 w-4 text-primary shrink-0" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                          {getContentPreview(item)}
                        </p>
                        <div className="flex items-center gap-2 mt-1.5">
                          <Badge
                            variant="outline"
                            className={`text-xs ${contentTypeColors[item.content_type]}`}
                          >
                            {contentTypeIcons[item.content_type]}
                            <span className="ml-1">
                              {item.content_type.charAt(0).toUpperCase() +
                                item.content_type.slice(1)}
                            </span>
                          </Badge>
                          {item.tags?.slice(0, 2).map((tag, idx) => (
                            <Badge key={idx} variant="secondary" className="text-xs">
                              {tag}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  );
}
