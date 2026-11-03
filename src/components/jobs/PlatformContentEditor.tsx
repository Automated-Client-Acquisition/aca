import { useRef } from "react";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PLATFORMS } from "@/lib/platformRequirements";
import { PlatformContent } from "@/types/publishing";
import { MultiImageGallery } from "./viewers/MultiImageGallery";
import { VideoUpload } from "./VideoUpload";
import { TagInput } from "./TagInput";
import { PostTypeSelector } from "./PostTypeSelector";
import { RichTextToolbar } from "./RichTextToolbar";
import { cn } from "@/lib/utils";

interface PlatformContentEditorProps {
  baseContent: PlatformContent;
  platformOverrides: Record<string, Partial<PlatformContent>>;
  selectedPlatforms: string[];
  onUpdateBaseContent: (content: Partial<PlatformContent>) => void;
  onUpdatePlatformOverride: (platformId: string, content: Partial<PlatformContent>) => void;
  activePlatform?: string | null; // null or "all" means base content, specific platform ID means platform-specific
}

export function PlatformContentEditor({
  baseContent,
  platformOverrides,
  selectedPlatforms,
  onUpdateBaseContent,
  onUpdatePlatformOverride,
  activePlatform,
}: PlatformContentEditorProps) {
  const getPlatformContent = (platformId: string): PlatformContent => {
    const override = platformOverrides[platformId] || {};
    return {
      caption: override.caption ?? baseContent.caption,
      images: override.images ?? baseContent.images,
      videoUrl: override.videoUrl ?? baseContent.videoUrl,
      videoThumbnail: override.videoThumbnail ?? baseContent.videoThumbnail,
      tags: override.tags ?? baseContent.tags,
      postType: override.postType ?? baseContent.postType,
    };
  };

  const getCharacterCount = (caption: string, platformId?: string): { count: number; limit: number; exceeded: boolean } => {
    const platform = platformId ? PLATFORMS[platformId] : null;
    const limit = platform?.characterLimit ?? 2200;
    const count = caption.length;
    return { count, limit, exceeded: count > limit };
  };

  // Determine if we're editing base content or platform-specific
  const isEditingBase = !activePlatform || activePlatform === "all";
  const currentPlatformId = isEditingBase ? null : activePlatform;
  const currentContent = currentPlatformId ? getPlatformContent(currentPlatformId) : baseContent;
  const platform = currentPlatformId ? PLATFORMS[currentPlatformId] : null;
  const charCount = getCharacterCount(currentContent.caption, currentPlatformId || undefined);

  if (selectedPlatforms.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <p>Select social accounts to customize content</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Post Type Selector - only show for specific platforms */}
      {platform && currentPlatformId && (
        <PostTypeSelector
          platformId={currentPlatformId}
          selectedType={currentContent.postType}
          onTypeChange={(type) => {
            onUpdatePlatformOverride(currentPlatformId, { postType: type });
          }}
          hasImage={currentContent.images.length > 0}
          hasVideo={!!currentContent.videoUrl}
        />
      )}

      {/* Caption */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Caption {currentPlatformId && `(${platform?.name})`}</Label>
          <Badge
            variant={charCount.exceeded ? "destructive" : "secondary"}
            className="text-xs"
          >
            {charCount.count} / {charCount.limit}
          </Badge>
        </div>
        <Textarea
          value={currentContent.caption}
          onChange={(e) => {
            if (isEditingBase) {
              onUpdateBaseContent({ caption: e.target.value });
            } else if (currentPlatformId) {
              onUpdatePlatformOverride(currentPlatformId, { caption: e.target.value });
            }
          }}
          rows={10}
          className={cn(
            "resize-none",
            charCount.exceeded && "border-destructive focus-visible:ring-destructive"
          )}
          placeholder="Write your post caption..."
        />
        <RichTextToolbar
          onInsertText={(text) => {
            const newCaption = currentContent.caption + text;
            if (isEditingBase) {
              onUpdateBaseContent({ caption: newCaption });
            } else if (currentPlatformId) {
              onUpdatePlatformOverride(currentPlatformId, { caption: newCaption });
            }
          }}
          onEmojiSelect={(emoji) => {
            const newCaption = currentContent.caption + emoji;
            if (isEditingBase) {
              onUpdateBaseContent({ caption: newCaption });
            } else if (currentPlatformId) {
              onUpdatePlatformOverride(currentPlatformId, { caption: newCaption });
            }
          }}
        />
      </div>

      {/* Images */}
      <MultiImageGallery
        images={currentContent.images}
        onUpdateImages={(images) => {
          if (isEditingBase) {
            onUpdateBaseContent({ images });
          } else if (currentPlatformId) {
            onUpdatePlatformOverride(currentPlatformId, { images });
          }
        }}
      />

      {/* Video */}
      <VideoUpload
        videoUrl={currentContent.videoUrl}
        videoThumbnail={currentContent.videoThumbnail}
        onUpdateVideo={(videoUrl, thumbnail) => {
          const updates = {
            videoUrl,
            videoThumbnail: thumbnail,
            postType: videoUrl ? 'video' : currentContent.postType
          };
          if (isEditingBase) {
            onUpdateBaseContent(updates);
          } else if (currentPlatformId) {
            onUpdatePlatformOverride(currentPlatformId, updates);
          }
        }}
      />

      {/* Tags */}
      <div className="space-y-2">
        <Label>Hashtags</Label>
        <TagInput
          tags={currentContent.tags}
          onTagsChange={(tags) => {
            if (isEditingBase) {
              onUpdateBaseContent({ tags });
            } else if (currentPlatformId) {
              onUpdatePlatformOverride(currentPlatformId, { tags });
            }
          }}
          placeholder="Add hashtags..."
        />
      </div>
    </div>
  );
}
