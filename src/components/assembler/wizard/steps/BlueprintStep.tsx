import { useBlueprints } from "@/hooks/useBlueprints";
import { Blueprint, BlueprintSlot } from "@/types/blueprint";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { PromptPreview } from "@/components/PromptPreview";
import { CreateBlueprintDialog } from "@/components/blueprints/CreateBlueprintDialog";
import { BlueprintStarterPackDialog } from "@/components/blueprints/BlueprintStarterPackDialog";
import { useState, useMemo } from "react";
import { Search, Sparkles, CheckCircle2, ChevronDown, ChevronUp, FileText, Video, Image, Zap, Lock, Type, User, Megaphone, Package, Target, ArrowRight, Clock } from "lucide-react";
import { BlueprintFoldersSidebar } from "@/components/blueprints/BlueprintFoldersSidebar";
import { cn } from "@/lib/utils";
import {
  getPipelineIcon,
  getPipelineBadgeColor,
  formatRelativeTime,
  formatLabel
} from "@/lib/blueprintCardUtils";
import { PIPELINES } from "@/types/pipeline";
import { useFeatureAccess, UPGRADE_URL } from "@/hooks/useFeatureAccess";
import { allStarterPackBlueprints } from "@/data/starterPackBlueprints";

// Library label + icon mapping (matches BlueprintCard)
const LIBRARY_ICON_LABELS: Record<string, { label: string; icon: typeof User }> = {
  library_brand_voices: { label: 'Brand Voice', icon: Megaphone },
  library_characters: { label: 'Character', icon: User },
  library_products: { label: 'Product', icon: Package },
  library_icps: { label: 'Audience', icon: Target },
  library_blocks: { label: 'Block', icon: Type },
};

function getSlotSummary(slots: BlueprintSlot[]) {
  const textInputs = slots.filter(s => s.type === 'text').length;
  const librarySlots = slots.filter(s => s.type === 'library_element');

  const items: { label: string; icon: typeof User }[] = [];
  if (textInputs > 0) items.push({ label: `${textInputs} text`, icon: Type });
  librarySlots.forEach(s => {
    const config = LIBRARY_ICON_LABELS[s.library_table || ''];
    if (config) items.push(config);
    else items.push({ label: s.label || 'Input', icon: Type });
  });
  return items;
}

function getModelDisplayName(modelId: string): string {
  const parts = modelId.split('/');
  return parts.length > 1 ? parts[1] : parts[0];
}

function getPipelineName(pipelineId: string): string {
  const pipeline = PIPELINES.find(p => p.id === pipelineId);
  return pipeline?.name || formatLabel(pipelineId);
}

function getOutputLabel(pipelineId?: string): string {
  if (!pipelineId) return 'Content';
  const map: Record<string, string> = {
    rich_article: 'Article',
    social_media_post: 'Image + Caption',
    instagram_carousel: 'Carousel',
    image_only: 'Image',
    ugc_video: 'Video',
    generative_video_oneshot: 'Video',
    video_script: 'Script',
    storyboard_video_longform: 'Long-Form Video',
  };
  return map[pipelineId] || 'Content';
}

function getPipelineAccentClass(pipeline?: string): string {
  if (!pipeline) return 'from-primary/5 to-transparent';
  const p = pipeline.toLowerCase();
  if (p.includes('video') || p.includes('script')) return 'from-blue-500/8 to-transparent';
  if (p.includes('carousel') || p.includes('image')) return 'from-pink-500/8 to-transparent';
  if (p.includes('article')) return 'from-emerald-500/8 to-transparent';
  return 'from-primary/5 to-transparent';
}

interface BlueprintStepProps {
  selectedBlueprint: Blueprint | null;
  onSelect: (blueprint: Blueprint) => void;
  pipelineFilter?: string;
  recordingMode?: boolean;
  hasPreRecordedVideo?: boolean;
}

export function BlueprintStep({
  selectedBlueprint,
  onSelect,
  pipelineFilter,
  recordingMode,
  hasPreRecordedVideo,
}: BlueprintStepProps) {
  const { data: blueprints, isLoading } = useBlueprints();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [isPromptPreviewOpen, setIsPromptPreviewOpen] = useState(false);
  const [isImagePromptPreviewOpen, setIsImagePromptPreviewOpen] = useState(false);
  const [starterPackDialogOpen, setStarterPackDialogOpen] = useState(false);

  // Feature access for starter packs
  const { hasFeature } = useFeatureAccess();
  const hasStarterPackAccess = hasFeature('starter_packs');

  const filteredBlueprints = useMemo(() => {
    if (!blueprints) return [];

    return blueprints.filter(bp => {
      // Pipeline filter (for recording mode)
      if (pipelineFilter && bp.pipeline !== pipelineFilter) return false;

      // Folder filter
      if (selectedFolder === "uncategorized") {
        if (bp.folder_id) return false;
      } else if (selectedFolder) {
        if (bp.folder_id !== selectedFolder) return false;
      }

      // Search filter
      const query = searchQuery.toLowerCase().trim();
      if (!query) return true;

      return (
        bp.name.toLowerCase().includes(query) ||
        bp.description?.toLowerCase().includes(query) ||
        bp.pipeline?.toLowerCase().includes(query) ||
        bp.tags?.some(tag => tag.toLowerCase().includes(query))
      );
    });
  }, [blueprints, searchQuery, selectedFolder, pipelineFilter]);

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
        </div>
        <Skeleton className="h-10 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-48" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3 mb-2">
            <Sparkles className="h-8 w-8 text-primary" />
            {recordingMode ? 'Select a Recording Blueprint' : 'Select a Blueprint'}
          </h1>
          <p className="text-muted-foreground text-lg">
            {recordingMode
              ? 'Choose a blueprint that defines how your recording is processed and rendered.'
              : 'Choose a content blueprint that defines the structure and model configuration for your content generation.'}
          </p>
        </div>
        {blueprints && blueprints.length > 0 && (
          <CreateBlueprintDialog />
        )}
      </div>

      {/* Recording captured banner */}
      {recordingMode && hasPreRecordedVideo && (
        <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0" />
          <div>
            <p className="text-sm font-medium text-foreground">Recording uploaded successfully</p>
            <p className="text-xs text-muted-foreground">Select a blueprint to define how your recording is processed.</p>
          </div>
        </div>
      )}

      {/* Search with Starter Pack Button */}
      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search blueprints by name, description, or tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10 h-12"
          />
        </div>
        <Button
          variant="outline"
          onClick={
            hasStarterPackAccess
              ? () => setStarterPackDialogOpen(true)
              : () => window.open(UPGRADE_URL, "_blank")
          }
          className={cn(
            "h-12 px-4",
            hasStarterPackAccess
              ? "border-primary/30 hover:bg-primary/10"
              : "border-amber-500/30 hover:bg-amber-500/10"
          )}
        >
          {hasStarterPackAccess ? (
            <Sparkles className="w-4 h-4 mr-2 text-primary" />
          ) : (
            <Lock className="w-4 h-4 mr-2 text-amber-500" />
          )}
          Starter Pack
          <Badge variant="secondary" className="ml-2 text-xs">
            {allStarterPackBlueprints.length}
          </Badge>
        </Button>
      </div>

      {/* Starter Pack Dialog */}
      <BlueprintStarterPackDialog
        open={starterPackDialogOpen}
        onOpenChange={setStarterPackDialogOpen}
      />

      {/* Folder Sidebar + Blueprint Grid */}
      <div className="flex gap-6">
        <BlueprintFoldersSidebar
          selectedFolder={selectedFolder}
          onSelectFolder={setSelectedFolder}
          className="w-56 shrink-0 h-[calc(100vh-320px)] sticky top-4"
        />

        <div className="flex-1 min-w-0 space-y-4">
          {/* Results Count */}
          {(searchQuery || selectedFolder) && (
            <div className="text-sm text-muted-foreground">
              Found {filteredBlueprints.length} blueprint{filteredBlueprints.length !== 1 ? 's' : ''}
            </div>
          )}

          {/* Blueprint Grid */}
          {filteredBlueprints.length === 0 ? (
            searchQuery || selectedFolder ? (
              <Card className="p-12 text-center">
                <Sparkles className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No blueprints found</h3>
                <p className="text-muted-foreground">
                  Try a different search term or folder
                </p>
              </Card>
            ) : (
              <Card className="border-dashed">
                <CardContent className="flex flex-col items-center justify-center py-16 text-center">
                  <div className="mb-6 relative">
                    <div className="absolute inset-0 bg-primary/5 rounded-full blur-2xl" />
                    <div className="relative bg-primary/10 p-6 rounded-full">
                      <FileText className="h-12 w-12 text-primary" />
                    </div>
                  </div>

                  <h3 className="text-2xl font-semibold mb-3">No blueprints yet</h3>
                  <p className="text-muted-foreground mb-6 max-w-md">
                    Blueprints define how your AI content is generated. Create your first blueprint to start producing content.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 max-w-2xl w-full">
                    <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                      <Video className="h-6 w-6 text-blue-500 mb-2 mx-auto" />
                      <p className="text-sm font-medium mb-1">Video Content</p>
                      <p className="text-xs text-muted-foreground">Create viral video scripts</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                      <Image className="h-6 w-6 text-pink-500 mb-2 mx-auto" />
                      <p className="text-sm font-medium mb-1">Social Media</p>
                      <p className="text-xs text-muted-foreground">Generate engaging posts</p>
                    </div>
                    <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                      <Zap className="h-6 w-6 text-orange-500 mb-2 mx-auto" />
                      <p className="text-sm font-medium mb-1">Articles</p>
                      <p className="text-xs text-muted-foreground">Write SEO-optimized content</p>
                    </div>
                  </div>

                  <CreateBlueprintDialog />
                </CardContent>
              </Card>
            )
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {filteredBlueprints.map(blueprint => {
            const isSelected = selectedBlueprint?.id === blueprint.id;
            const ContentTypeIcon = getPipelineIcon(blueprint.pipeline);
            const badgeColor = getPipelineBadgeColor(blueprint.pipeline);
            const slotSummary = getSlotSummary(blueprint.structure?.slots || []);
            const outputLabel = getOutputLabel(blueprint.pipeline);
            const primaryModel = blueprint.model_config.text_llm?.model_id;
            const primaryModelDisplay = primaryModel ? getModelDisplayName(primaryModel) : null;
            const accentClass = getPipelineAccentClass(blueprint.pipeline);

            return (
              <Card
                key={blueprint.id}
                className={cn(
                  "group relative overflow-hidden border cursor-pointer transition-all duration-200 hover:shadow-md hover:border-border/80 flex flex-col",
                  isSelected && "ring-2 ring-primary shadow-lg shadow-primary/20"
                )}
                onClick={() => onSelect(blueprint)}
              >
                {/* Subtle gradient accent at top */}
                <div className={cn("absolute inset-0 bg-gradient-to-b pointer-events-none", accentClass)} />

                <CardHeader className="pb-2 space-y-0 relative">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h3 className="font-semibold text-base line-clamp-1">
                        {blueprint.name}
                      </h3>
                      {blueprint.description && (
                        <p className="text-[13px] text-muted-foreground line-clamp-2 leading-relaxed mt-0.5">
                          {blueprint.description}
                        </p>
                      )}
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                    )}
                  </div>

                  {/* Pipeline badge + tags */}
                  <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
                    {blueprint.pipeline && (
                      <Badge variant="outline" className={cn("font-medium text-[11px] px-2 py-0.5", badgeColor)}>
                        <ContentTypeIcon className="h-3 w-3 mr-1" />
                        {getPipelineName(blueprint.pipeline)}
                      </Badge>
                    )}
                    {blueprint.tags && blueprint.tags.length > 0 && (
                      <>
                        {blueprint.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} variant="secondary" className="text-[11px] px-1.5 py-0.5 font-normal text-muted-foreground">
                            {tag}
                          </Badge>
                        ))}
                        {blueprint.tags.length > 3 && (
                          <Badge variant="secondary" className="text-[11px] px-1.5 py-0.5 font-normal text-muted-foreground">
                            +{blueprint.tags.length - 3}
                          </Badge>
                        )}
                      </>
                    )}
                  </div>
                </CardHeader>

                <CardContent className="pb-3 pt-1 flex-1 relative">
                  {/* Input chips → Output flow */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    {slotSummary.map((item, i) => {
                      const Icon = item.icon;
                      return (
                        <span key={i} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground bg-muted/60 rounded-md px-1.5 py-0.5">
                          <Icon className="h-3 w-3 shrink-0" />
                          {item.label}
                        </span>
                      );
                    })}
                    {slotSummary.length > 0 && (
                      <ArrowRight className="h-3 w-3 text-muted-foreground/40 shrink-0 mx-0.5" />
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-foreground bg-muted/60 rounded-md px-1.5 py-0.5">
                      <ContentTypeIcon className="h-3 w-3 shrink-0" />
                      {outputLabel}
                    </span>
                  </div>

                  {/* Model pill */}
                  {primaryModelDisplay && (
                    <p className="text-[11px] text-muted-foreground mt-2 truncate">
                      Powered by <span className="font-medium text-muted-foreground/80">{primaryModelDisplay}</span>
                    </p>
                  )}
                </CardContent>

                <CardFooter className="pt-2.5 pb-2.5 px-4 border-t border-border/50 flex items-center justify-between relative">
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground/70">
                    <Clock className="h-3 w-3" />
                    <span>{formatRelativeTime(blueprint.updated_at)}</span>
                  </div>
                  {isSelected && (
                    <Badge variant="default" className="text-[11px] bg-primary/10 text-primary border-primary/20">
                      Selected
                    </Badge>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
          )}
        </div>
      </div>

      {/* Preview Panel for Selected Blueprint */}
      {selectedBlueprint && (
        <div className="mt-6 space-y-3">
          {/* Master Prompt Preview */}
          <Card className="border-primary/20">
            <Collapsible open={isPromptPreviewOpen} onOpenChange={setIsPromptPreviewOpen}>
              <CardHeader className="pb-3">
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" className="w-full justify-between p-0 hover:bg-transparent">
                    <CardTitle className="text-lg">Master Prompt</CardTitle>
                    {isPromptPreviewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  </Button>
                </CollapsibleTrigger>
              </CardHeader>
              <CollapsibleContent>
                <CardContent className="pt-0">
                  <div className="rounded-lg bg-muted/50 p-4 border">
                    <PromptPreview prompt={selectedBlueprint.master_prompt || ""} />
                  </div>
                </CardContent>
              </CollapsibleContent>
            </Collapsible>
          </Card>

          {/* Image Prompt Preview - Only show if blueprint has image_prompt */}
          {selectedBlueprint.image_prompt && (
            <Card className="border-primary/20">
              <Collapsible open={isImagePromptPreviewOpen} onOpenChange={setIsImagePromptPreviewOpen}>
                <CardHeader className="pb-3">
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" className="w-full justify-between p-0 hover:bg-transparent">
                      <CardTitle className="text-lg">Image Prompt</CardTitle>
                      {isImagePromptPreviewOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </Button>
                  </CollapsibleTrigger>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <div className="rounded-lg bg-muted/50 p-4 border">
                      <PromptPreview prompt={selectedBlueprint.image_prompt} />
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          )}

          <p className="text-xs text-muted-foreground">
            You can customize these prompts in the Review step
          </p>
        </div>
      )}
    </div>
  );
}
