import { useState, useMemo } from "react";
import { Blueprint, PinnedLibraryElements, LibraryElementType } from "@/types/blueprint";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Search, CheckCircle2, Library, AlertCircle, Eye, Image as ImageIcon, ExternalLink, ImagePlus, Mic, User, Package, Palette, Target, Blocks, ZoomIn, Video, Tag } from "lucide-react";
import { useLibraryStepData } from "@/hooks/useLibraryStepData";
import { LibraryElementPreview } from "./LibraryElementPreview";
import { CombinationModeSelector } from "../components/CombinationModeSelector";
import { OnboardingTooltip, ONBOARDING_TIPS } from "../components/OnboardingTooltip";
import { cn } from "@/lib/utils";
import { CharacterDetailsDialog } from "@/components/CharacterDetailsDialog";
import { ProductDetailsDialog } from "@/components/ProductDetailsDialog";
import { BrandVoiceDetailsDialog } from "@/components/BrandVoiceDetailsDialog";
import { BlockDetailsDialog } from "@/components/BlockDetailsDialog";
import { ICPDetailsDialog } from "@/components/ICPDetailsDialog";
import { Lightbox } from "@/components/ui/lightbox";
import { useNavigate } from "react-router-dom";

// Static map of well-known ElevenLabs voice IDs to human-readable names
const KNOWN_VOICE_NAMES: Record<string, string> = {
  'pNInz6obpgDQGcFmaJgB': 'Adam',
  'EXAVITQu4vr4xnSDxMaL': 'Bella',
  '21m00Tcm4TlvDq8ikWAM': 'Rachel',
  'ErXwobaYiN019PkySvjV': 'Antoni',
  'AZnzlk1XvdvUeBnXmlld': 'Domi',
  'MF3mGyEYCl7XYWbV9V6O': 'Elli',
  'TxGEqnHWrfWFTfGW9XjX': 'Josh',
  'yoZ06aMxZJJ28mfd3POQ': 'Sam',
};

function resolveVoiceName(voiceId: string): string {
  return KNOWN_VOICE_NAMES[voiceId] || voiceId;
}

const LIBRARY_TABLE_LABELS: Record<string, string> = {
  library_brand_voices: "Brands",
  library_characters: "People & Faces",
  library_blocks: "Blocks",
  library_products: "Products",
  library_icps: "Target Audiences",
  library_images: "Style & Composition",
};

// Contextual information for each library type
const LIBRARY_CONTEXT: Record<string, {
  icon: typeof User;
  role: string;
  singularLabel: string;
  imageHint: string;
}> = {
  library_characters: {
    icon: User,
    role: "Controls the person's identity and facial likeness",
    singularLabel: "character",
    imageHint: "Reference images help maintain visual consistency for this character"
  },
  library_products: {
    icon: Package,
    role: "Featured product in your content",
    singularLabel: "product",
    imageHint: "Product images will be used for visual placement"
  },
  library_brand_voices: {
    icon: Palette,
    role: "Defines tone and communication style",
    singularLabel: "brand",
    imageHint: "Brand visuals guide the overall style"
  },
  library_icps: {
    icon: Target,
    role: "Target audience context",
    singularLabel: "audience",
    imageHint: "Audience visuals inform content targeting"
  },
  library_blocks: {
    icon: Blocks,
    role: "Reusable content elements",
    singularLabel: "block",
    imageHint: "Block images are included in generation"
  },
  library_images: {
    icon: ImagePlus,
    role: "Controls composition, pose, lighting, and visual style",
    singularLabel: "image",
    imageHint: "These pictures are used directly as visual reference"
  },
};

interface LibraryStepTemplateProps {
  blueprint: Blueprint;
  libraryTable: string;
  value: PinnedLibraryElements;
  onChange: (value: PinnedLibraryElements) => void;
}

export function LibraryStepTemplate({
  blueprint,
  libraryTable,
  value,
  onChange,
}: LibraryStepTemplateProps) {
  const navigate = useNavigate();
  const { data: items, isLoading, onUpdate, onDelete, isUpdating } = useLibraryStepData(libraryTable);
  const [searchQuery, setSearchQuery] = useState("");
  const [previewItem, setPreviewItem] = useState<any>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  const libraryLabel = LIBRARY_TABLE_LABELS[libraryTable] || libraryTable;
  const libraryContext = LIBRARY_CONTEXT[libraryTable];
  const isHeyGenPipeline = blueprint.pipeline === 'ugc_heygen' || blueprint.pipeline === 'ugc_heygen_template';
  const selectedElements = value[libraryTable]?.elements || {};
  const combinationMode = value[libraryTable]?.combination_mode || 'separate';
  const imageCombinationMode = value[libraryTable]?.image_combination_mode || 'combine';

  const filteredItems = useMemo(() => {
    if (!items) return [];
    const query = searchQuery.toLowerCase().trim();
    if (!query) return items;

    return items.filter((item: any) =>
      item.name?.toLowerCase().includes(query) ||
      item.title?.toLowerCase().includes(query) ||
      item.description?.toLowerCase().includes(query) ||
      item.tags?.some((tag: string) => tag.toLowerCase().includes(query))
    );
  }, [items, searchQuery]);

  const handleToggle = (item: any) => {
    const itemId = item.id;
    const newElements = { ...selectedElements };

    if (newElements[itemId]) {
      delete newElements[itemId];
    } else {
      // Default to all of this item's images selected — picking a library
      // is meant to mean "use its images," not an empty selection the user
      // has to separately opt into.
      const images = item.reference_images || item.images || item.logos || (item.logo ? [item.logo] : []);
      newElements[itemId] = { paths: {}, selected_images: [...images] };
    }

    onChange({
      ...value,
      [libraryTable]: {
        combination_mode: combinationMode,
        image_combination_mode: imageCombinationMode,
        elements: newElements,
      },
    });
  };

  const handleImageSelectionChange = (itemId: string, imageUrls: string[]) => {
    const newElements = { ...selectedElements };
    if (newElements[itemId]) {
      newElements[itemId] = {
        ...newElements[itemId],
        selected_images: imageUrls,
      };

      onChange({
        ...value,
        [libraryTable]: {
          combination_mode: combinationMode,
          image_combination_mode: imageCombinationMode,
          elements: newElements,
        },
      });
    }
  };

  const handlePreview = (item: any, e: React.MouseEvent) => {
    e.stopPropagation();
    setPreviewItem(item);
    setPreviewOpen(true);
  };


  const handleCombinationModeChange = (mode: 'combine' | 'separate') => {
    onChange({
      ...value,
      [libraryTable]: {
        combination_mode: mode,
        image_combination_mode: imageCombinationMode,
        elements: selectedElements,
      },
    });
  };

  const handleImageCombinationModeChange = (mode: 'combine' | 'separate') => {
    onChange({
      ...value,
      [libraryTable]: {
        combination_mode: combinationMode,
        image_combination_mode: mode,
        elements: selectedElements,
      },
    });
  };

  // HeyGen avatar profile selection handler
  const handleHeyGenProfileToggle = (itemId: string, profileId: string, allProfileIds: string[]) => {
    const newElements = { ...selectedElements };
    if (!newElements[itemId]) return;

    const current = newElements[itemId].selected_heygen_profiles;
    let newSelected: string[];

    if (!current) {
      newSelected = allProfileIds.filter(id => id !== profileId);
    } else {
      if (current.includes(profileId)) {
        if (current.length <= 1) return;
        newSelected = current.filter(id => id !== profileId);
      } else {
        newSelected = [...current, profileId];
      }
    }

    newElements[itemId] = {
      ...newElements[itemId],
      selected_heygen_profiles: newSelected,
    };

    onChange({
      ...value,
      [libraryTable]: {
        combination_mode: combinationMode,
        image_combination_mode: imageCombinationMode,
        elements: newElements,
      },
    });
  };

  // Per-element image combination mode handler
  const handleElementImageModeChange = (itemId: string, mode: 'combine' | 'separate') => {
    const newElements = { ...selectedElements };
    if (newElements[itemId]) {
      newElements[itemId] = {
        ...newElements[itemId],
        image_combination_mode: mode,
      };

      onChange({
        ...value,
        [libraryTable]: {
          combination_mode: combinationMode,
          image_combination_mode: imageCombinationMode,
          elements: newElements,
        },
      });
    }
  };


  const selectedCount = Object.keys(selectedElements).length;

  // Count total selected images across all selected elements
  const totalSelectedImages = Object.values(selectedElements).reduce(
    (total, element) => total + (element.selected_images?.length || 0),
    0
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-full" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3, 4, 5, 6].map(i => (
            <Skeleton key={i} className="h-32" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={`Search ${libraryLabel.toLowerCase()}...`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 h-12"
        />
      </div>

      {/* Selection Summary with Visual Combination Mode */}
      {selectedCount > 0 && (
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    Selected: {selectedCount} {libraryLabel.toLowerCase()}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {libraryContext?.role || 'Configure how these will be used in generation'}
                  </p>
                </div>
                <Badge variant="secondary">{selectedCount}</Badge>
              </div>

              {/* Visual Combination Mode Selector */}
              {selectedCount > 1 && (
                <div className="pt-4 border-t">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-medium text-muted-foreground">Element Combination Mode</span>
                    <OnboardingTooltip
                      tipKey={ONBOARDING_TIPS.combinationMode.key}
                      title={ONBOARDING_TIPS.combinationMode.title}
                      description={ONBOARDING_TIPS.combinationMode.description}
                      tips={ONBOARDING_TIPS.combinationMode.tips}
                      side="right"
                    />
                  </div>
                  <CombinationModeSelector
                    mode={combinationMode}
                    onChange={handleCombinationModeChange}
                    elementCount={selectedCount}
                    ideaCount={1} // Will be passed from parent if needed
                    elementLabel={libraryLabel.toLowerCase()}
                  />
                </div>
              )}

              {/* Note: Image combination mode is now set per-element in the card below */}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info Alert */}
      {selectedCount === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            Select at least one {libraryLabel.toLowerCase()} to continue. These will be combined with your ideas.
          </AlertDescription>
        </Alert>
      )}

      {/* Items Grid */}
      {filteredItems.length === 0 ? (
        <Card className="p-12 text-center border-dashed">
          <Library className="h-12 w-12 mx-auto mb-4 text-muted-foreground opacity-50" />
          <h3 className="text-lg font-medium mb-2">No {libraryLabel.toLowerCase()} found</h3>
          <p className="text-muted-foreground mb-4">
            {searchQuery
              ? "Try a different search term"
              : `Create ${libraryLabel.toLowerCase()} in the Assets section first`}
          </p>
          {!searchQuery && (
            <Button variant="outline" onClick={() => navigate("/assets")}>
              <ExternalLink className="h-4 w-4 mr-2" />
              Go to Assets
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredItems.map((item: any) => {
            const isSelected = !!selectedElements[item.id];
            const itemName = item.name || item.title || 'Untitled';
            const itemDescription = item.description || item.angle || '';
            // Collect images from various fields depending on library type
            const images = item.reference_images || item.images || item.logos || (item.logo ? [item.logo] : []);
            const hasImages = images.length > 0;
            const selectedImages = selectedElements[item.id]?.selected_images || [];

            return (
              <Card
                key={item.id}
                className={cn(
                  "cursor-pointer transition-all hover:shadow-lg hover:scale-[1.02]",
                  isSelected && "ring-2 ring-primary shadow-lg shadow-primary/20"
                )}
                onClick={() => handleToggle(item)}
              >
                <CardContent className="pt-6">
                  <div className="space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <Checkbox
                        checked={isSelected}
                        className="mt-1"
                      />
                      <div className="flex-1 min-w-0">
                        <h3 className="font-medium line-clamp-2">{itemName}</h3>
                        {itemDescription && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                            {itemDescription}
                          </p>
                        )}
                        {item.tags?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {item.tags.slice(0, 3).map((tag: string) => (
                              <Badge key={tag} variant="outline" className="h-5 gap-1 px-1.5 text-[10px] font-normal">
                                <Tag className="h-2.5 w-2.5" />
                                {tag}
                              </Badge>
                            ))}
                            {item.tags.length > 3 && (
                              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
                                +{item.tags.length - 3}
                              </Badge>
                            )}
                          </div>
                        )}
                        {/* Contextual info for characters - show voice */}
                        {libraryTable === 'library_characters' && item.voice_selection && (
                          <div className="flex items-center gap-1.5 mt-2 text-xs text-muted-foreground">
                            <Mic className="h-3 w-3" />
                            <span>Voice: {resolveVoiceName(item.voice_selection)}</span>
                          </div>
                        )}
                        {/* HeyGen avatar status for HeyGen pipelines */}
                        {libraryTable === 'library_characters' && isHeyGenPipeline && (() => {
                          const profiles = item.heygen_avatars as any[] | null;
                          const hasAvatar = (profiles && profiles.length > 0) || !!item.heygen_avatar_id;
                          const profileCount = profiles?.length || 0;
                          return hasAvatar ? (
                            <div className="flex items-center gap-1.5 mt-2">
                              <Video className="h-3 w-3 text-purple-500 shrink-0" />
                              <div className="flex items-center gap-1">
                                {profiles?.slice(0, 4).map((p: any) => (
                                  p.preview_image_url ? (
                                    <img
                                      key={p.id || p.avatar_id}
                                      src={p.preview_image_url}
                                      alt={p.name || ''}
                                      className="h-5 w-5 rounded-full object-cover border border-purple-500/30"
                                      loading="lazy"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  ) : (
                                    <div key={p.id || p.avatar_id} className="h-5 w-5 rounded-full bg-muted flex items-center justify-center border border-purple-500/30">
                                      <User className="h-2.5 w-2.5 text-muted-foreground" />
                                    </div>
                                  )
                                ))}
                                {profileCount > 4 && (
                                  <span className="text-[10px] text-muted-foreground ml-0.5">+{profileCount - 4}</span>
                                )}
                              </div>
                              <span className="text-xs text-purple-500">
                                {profileCount} avatar{profileCount > 1 ? 's' : ''}
                              </span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1.5 mt-1.5 text-xs text-amber-500">
                              <AlertCircle className="h-3 w-3" />
                              <span>No HeyGen avatar configured</span>
                            </div>
                          );
                        })()}
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                      )}
                    </div>

                    {/* Role context badge - shows when selected */}
                    {isSelected && libraryContext && (
                      <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/10">
                        {(() => {
                          const Icon = libraryContext.icon;
                          return <Icon className="h-3.5 w-3.5 text-primary" />;
                        })()}
                        <span className="text-xs text-muted-foreground">
                          {libraryContext.role}
                        </span>
                      </div>
                    )}

                    {/* HeyGen Avatar Profile Selection - Shows when character is selected and has profiles */}
                    {isSelected && libraryTable === 'library_characters' && isHeyGenPipeline && (() => {
                      const profiles = item.heygen_avatars as any[] | null;
                      if (!profiles || profiles.length === 0) return null;

                      const allProfileIds = profiles.map((p: any) => p.id || p.avatar_id);
                      const selectedProfileIds = selectedElements[item.id]?.selected_heygen_profiles;
                      const effectiveSelected = selectedProfileIds || allProfileIds;
                      const selectedProfileCount = effectiveSelected.length;

                      return (
                        <div className="space-y-2.5 pt-3 border-t rounded-lg p-3 -mx-3 mt-3 bg-purple-500/5 border border-purple-500/20">
                          <div className="flex items-center justify-between">
                            <Label className="text-xs font-medium flex items-center gap-1.5 text-purple-600">
                              <Video className="h-3.5 w-3.5" />
                              Avatar Profiles
                            </Label>
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs border-purple-500/50 text-purple-600 bg-purple-500/10">
                                {selectedProfileCount} selected = {selectedProfileCount} output{selectedProfileCount > 1 ? 's' : ''}
                              </Badge>
                              {profiles.length > 1 && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const newElements = { ...selectedElements };
                                    if (selectedProfileCount === profiles.length) {
                                      newElements[item.id] = {
                                        ...newElements[item.id],
                                        selected_heygen_profiles: [allProfileIds[0]],
                                      };
                                    } else {
                                      const { selected_heygen_profiles: _, ...rest } = newElements[item.id];
                                      newElements[item.id] = rest;
                                    }
                                    onChange({
                                      ...value,
                                      [libraryTable]: {
                                        combination_mode: combinationMode,
                                        image_combination_mode: imageCombinationMode,
                                        elements: newElements,
                                      },
                                    });
                                  }}
                                >
                                  {selectedProfileCount === profiles.length ? "Select First Only" : "Select All"}
                                </Button>
                              )}
                            </div>
                          </div>
                          <div className={profiles.length > 2 ? "grid grid-cols-2 gap-2" : "space-y-2"}>
                            {profiles.map((profile: any) => {
                              const profileId = profile.id || profile.avatar_id;
                              const isProfileSelected = effectiveSelected.includes(profileId);
                              const previewUrl = profile.preview_image_url;
                              return (
                                <div
                                  key={profileId}
                                  className={cn(
                                    "flex items-center gap-2.5 p-2 rounded-lg cursor-pointer transition-all",
                                    isProfileSelected
                                      ? "bg-purple-500/10 border border-purple-500/40 shadow-sm"
                                      : "bg-muted/30 border border-transparent hover:border-muted-foreground/20 opacity-60 hover:opacity-100"
                                  )}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleHeyGenProfileToggle(item.id, profileId, allProfileIds);
                                  }}
                                >
                                  <Checkbox
                                    checked={isProfileSelected}
                                    className="pointer-events-none shrink-0"
                                  />
                                  {previewUrl ? (
                                    <img
                                      src={previewUrl}
                                      alt=""
                                      className={cn(
                                        "h-9 w-9 rounded-md object-cover shrink-0",
                                        isProfileSelected && "ring-2 ring-purple-500"
                                      )}
                                      loading="lazy"
                                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                                    />
                                  ) : (
                                    <div className={cn(
                                      "h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0",
                                      isProfileSelected && "ring-2 ring-purple-500"
                                    )}>
                                      <User className="h-4 w-4 text-muted-foreground" />
                                    </div>
                                  )}
                                  <div className="flex-1 min-w-0">
                                    <p className={cn("text-xs truncate", isProfileSelected ? "font-semibold" : "font-medium")}>
                                      {profile.name || profile.avatar_name || 'Unnamed'}
                                    </p>
                                    {profile.voice_name && (
                                      <p className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                                        <Mic className="h-2.5 w-2.5 shrink-0" />
                                        <span className="truncate">{profile.voice_name}</span>
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Inline Image Selection - Shows when item is selected */}
                    {isSelected && hasImages && (
                      <div className={cn(
                        "space-y-2 pt-3 border-t rounded-lg p-3 -mx-3 mt-3",
                        selectedImages.length === 0
                          ? "bg-amber-500/10 border border-amber-500/30"
                          : "bg-green-500/5 border border-green-500/20"
                      )}>
                        <div className="flex items-center justify-between">
                          <Label className={cn(
                            "text-xs font-medium flex items-center gap-1.5",
                            selectedImages.length === 0 ? "text-amber-600" : "text-green-600"
                          )}>
                            {selectedImages.length === 0 ? (
                              <>
                                <ImagePlus className="h-3.5 w-3.5" />
                                Select Reference Images
                                <OnboardingTooltip
                                  tipKey={ONBOARDING_TIPS.referenceImages.key}
                                  title={ONBOARDING_TIPS.referenceImages.title}
                                  description={ONBOARDING_TIPS.referenceImages.description}
                                  tips={ONBOARDING_TIPS.referenceImages.tips}
                                  side="top"
                                  className="ml-1"
                                />
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {selectedImages.length} of {images.length} images selected
                              </>
                            )}
                          </Label>
                          <div className="flex items-center gap-2">
                            {selectedImages.length === 0 && (
                              <Badge variant="outline" className="text-xs border-amber-500/50 text-amber-600 bg-amber-500/10">
                                Recommended
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs px-2"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (selectedImages.length === images.length) {
                                  handleImageSelectionChange(item.id, []);
                                } else {
                                  handleImageSelectionChange(item.id, [...images]);
                                }
                              }}
                            >
                              {selectedImages.length === images.length ? "Clear" : "Select All"}
                            </Button>
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          {images.map((url: string, idx: number) => {
                            const isImageSelected = selectedImages.includes(url);
                            return (
                              <div
                                key={idx}
                                className={cn(
                                  "relative group cursor-pointer rounded-lg overflow-hidden border-2 transition-all",
                                  isImageSelected
                                    ? "border-green-500 ring-2 ring-green-500/20"
                                    : "border-border hover:border-primary/50"
                                )}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const newSelected = isImageSelected
                                    ? selectedImages.filter(u => u !== url)
                                    : [...selectedImages, url];
                                  handleImageSelectionChange(item.id, newSelected);
                                }}
                              >
                                <div className="aspect-[4/3] w-full bg-muted/50 flex items-center justify-center">
                                  <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                                </div>
                                {/* Expand button */}
                                <button
                                  className="absolute top-1 left-1 bg-black/60 hover:bg-black/80 text-white rounded-full w-6 h-6 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setLightboxImage(url);
                                  }}
                                >
                                  <ZoomIn className="h-3.5 w-3.5" />
                                </button>
                                {/* Hover overlay for unselected images only */}
                                {!isImageSelected && (
                                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                    <Checkbox className="pointer-events-none h-5 w-5" />
                                  </div>
                                )}
                                {/* Green checkmark for selected images */}
                                {isImageSelected && (
                                  <div className="absolute top-1 right-1 bg-green-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold shadow-sm">
                                    ✓
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                        {selectedImages.length === 0 && (
                          <p className="text-xs text-amber-600/80">
                            Click images to select them for visual reference during generation
                          </p>
                        )}

                        {/* Per-element image combination mode - show when 2+ images selected */}
                        {selectedImages.length > 1 && (
                          <div className="pt-2 mt-2 border-t border-green-500/20">
                            <div className="flex items-center justify-between">
                              <span className="text-xs text-muted-foreground">Image Mode:</span>
                              <div className="flex items-center gap-1">
                                <Button
                                  variant={selectedElements[item.id]?.image_combination_mode !== 'separate' ? "default" : "outline"}
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleElementImageModeChange(item.id, 'combine');
                                  }}
                                >
                                  Combine
                                </Button>
                                <Button
                                  variant={selectedElements[item.id]?.image_combination_mode === 'separate' ? "default" : "outline"}
                                  size="sm"
                                  className="h-6 text-xs px-2"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleElementImageModeChange(item.id, 'separate');
                                  }}
                                >
                                  Separate ({selectedImages.length} outputs)
                                </Button>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Preview thumbnails when NOT selected */}
                    {!isSelected && hasImages && (
                      <div className="flex items-center gap-2 pt-2 border-t">
                        <Badge variant="outline" className="text-xs gap-1 border-primary/30 text-primary bg-primary/5">
                          <ImageIcon className="h-3 w-3" />
                          {images.length} {images.length === 1 ? 'image' : 'images'}
                        </Badge>
                        <div className="flex gap-1.5">
                          {images.slice(0, 3).map((url: string, idx: number) => (
                            <div key={idx} className="w-10 h-10 rounded-md overflow-hidden border border-border bg-muted/30 flex items-center justify-center">
                              <img src={url} alt="" className="max-w-full max-h-full object-contain" />
                            </div>
                          ))}
                          {images.length > 3 && (
                            <div className="w-10 h-10 rounded-md bg-muted border border-border flex items-center justify-center text-xs font-medium">
                              +{images.length - 3}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* Additional metadata - show category badge only (tone is too long for brand voices) */}
                    <div className="flex items-center gap-2 flex-wrap">
                      {item.category && (
                        <Badge variant="outline" className="text-xs">{item.category}</Badge>
                      )}
                    </div>

                    {/* Preview Button - Only for viewing full details */}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full mt-2"
                      onClick={(e) => handlePreview(item, e)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Full Details
                    </Button>
                  </div>

                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Preview Dialog */}
      {libraryTable === 'library_characters' ? (
        <CharacterDetailsDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          character={previewItem}
          onSave={onUpdate}
          onDelete={onDelete}
          isUpdating={isUpdating}
        />
      ) : libraryTable === 'library_products' ? (
        <ProductDetailsDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          product={previewItem}
          onSave={onUpdate}
          onDelete={onDelete}
          isUpdating={isUpdating}
        />
      ) : libraryTable === 'library_brand_voices' ? (
        <BrandVoiceDetailsDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          brandVoice={previewItem}
          onSave={onUpdate}
          onDelete={onDelete}
          isUpdating={isUpdating}
        />
      ) : libraryTable === 'library_blocks' ? (
        <BlockDetailsDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          block={previewItem}
          onSave={onUpdate}
          onDelete={onDelete}
          isUpdating={isUpdating}
        />
      ) : libraryTable === 'library_icps' ? (
        <ICPDetailsDialog
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          icp={previewItem}
          onSave={onUpdate}
          onDelete={onDelete}
          isUpdating={isUpdating}
        />
      ) : (
        <LibraryElementPreview
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          item={previewItem}
          selectedImages={previewItem ? (selectedElements[previewItem.id]?.selected_images || []) : []}
          onImageSelectionChange={(urls) => {
            if (previewItem) {
              handleImageSelectionChange(previewItem.id, urls);
            }
          }}
        />
      )}

      {/* Lightbox for expanded image view */}
      <Lightbox
        open={!!lightboxImage}
        onOpenChange={(open) => !open && setLightboxImage(null)}
        src={lightboxImage}
      />
    </div>
  );
}
