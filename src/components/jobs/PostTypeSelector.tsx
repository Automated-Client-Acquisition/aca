import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { PLATFORMS } from "@/lib/platformRequirements";
import { cn } from "@/lib/utils";
import { Grid3X3, Film, Clock, FileText, Play, Smartphone } from "lucide-react";

interface PostTypeSelectorProps {
  platformId: string;
  selectedType: string;
  onTypeChange: (type: string) => void;
  hasImage: boolean;
  hasVideo: boolean;
}

const POST_TYPE_CONFIG: Record<string, { label: string; icon: React.ReactNode; description: string }> = {
  feed: {
    label: 'Feed',
    icon: <Grid3X3 className="h-4 w-4" />,
    description: 'Standard feed post'
  },
  reel: {
    label: 'Reel',
    icon: <Film className="h-4 w-4" />,
    description: 'Short-form video (requires video)'
  },
  story: {
    label: 'Story',
    icon: <Clock className="h-4 w-4" />,
    description: '24-hour temporary post'
  },
  post: {
    label: 'Post',
    icon: <FileText className="h-4 w-4" />,
    description: 'Standard post'
  },
  video: {
    label: 'Video',
    icon: <Play className="h-4 w-4" />,
    description: 'Video post (requires video)'
  },
  short: {
    label: 'Short',
    icon: <Smartphone className="h-4 w-4" />,
    description: 'YouTube Short (requires video)'
  },
};

const POST_TYPE_REQUIREMENTS: Record<string, { requiresVideo?: boolean; requiresImage?: boolean }> = {
  reel: { requiresVideo: true },
  story: { requiresImage: true },
  video: { requiresVideo: true },
  short: { requiresVideo: true },
};

export function PostTypeSelector({
  platformId,
  selectedType,
  onTypeChange,
  hasImage,
  hasVideo
}: PostTypeSelectorProps) {
  const platform = PLATFORMS[platformId];
  if (!platform) return null;

  // Only show if platform has multiple post types
  if (platform.postTypes.length <= 1) return null;

  const isTypeAvailable = (type: string): boolean => {
    const requirements = POST_TYPE_REQUIREMENTS[type];
    if (!requirements) return true;

    if (requirements.requiresVideo && !hasVideo) return false;
    if (requirements.requiresImage && !hasImage) return false;

    return true;
  };

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium">Post as</Label>
      <TooltipProvider delayDuration={300}>
        <ToggleGroup
          type="single"
          value={selectedType}
          onValueChange={(value) => value && onTypeChange(value)}
          className="justify-start gap-1 bg-muted p-1 rounded-lg"
        >
          {platform.postTypes.map((type) => {
            const available = isTypeAvailable(type);
            const config = POST_TYPE_CONFIG[type] || { label: type, icon: <FileText className="h-4 w-4" />, description: type };
            const isSelected = selectedType === type;

            return (
              <Tooltip key={type}>
                <TooltipTrigger asChild>
                  <div>
                    <ToggleGroupItem
                      value={type}
                      disabled={!available}
                      className={cn(
                        "px-3 py-2 gap-2 data-[state=on]:bg-background data-[state=on]:shadow-sm",
                        !available && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      {config.icon}
                      <span className="text-sm font-medium">{config.label}</span>
                    </ToggleGroupItem>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  <p className="text-xs">
                    {config.description}
                    {!available && " (unavailable - missing required content)"}
                  </p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </TooltipProvider>
      {!isTypeAvailable(selectedType) && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500" />
          {POST_TYPE_CONFIG[selectedType]?.label || selectedType} requires {POST_TYPE_REQUIREMENTS[selectedType]?.requiresVideo ? 'video' : 'image'} content
        </p>
      )}
    </div>
  );
}
