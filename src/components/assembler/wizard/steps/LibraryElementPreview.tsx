import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetClose } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Lightbox } from "@/components/ui/lightbox";
import { cn } from "@/lib/utils";
import {
  User,
  ShoppingBag,
  Mic,
  Users,
  Sparkles,
  Palette,
  MessageSquare,
  Target,
  Heart,
  AlertTriangle,
  Tag,
  Image as ImageIcon,
  FileText,
  Shirt,
  Scissors,
  Type,
  Blend,
  Layers,
  X,
  CheckCircle2,
  ZoomIn
} from "lucide-react";

interface LibraryElementPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: any;
  selectedImages: string[];
  onImageSelectionChange: (urls: string[]) => void;
}

// Helper to detect item type based on available fields
function getItemType(item: any): 'character' | 'product' | 'brand_voice' | 'icp' | 'block' | 'unknown' {
  if (item.visual_style || item.gender || item.age_range || item.speaking_style || item.hair_description) {
    return 'character';
  }
  if (item.price !== undefined || item.sku || item.features) {
    return 'product';
  }
  if (item.tone || item.style_guidelines || item.color_palette || item.visual_template || item.font_style || item.accent_style) {
    return 'brand_voice';
  }
  if (item.pain_points || item.desires || item.objections || item.language_style) {
    return 'icp';
  }
  if (item.block_type || (item.content && !item.description)) {
    return 'block';
  }
  return 'unknown';
}

// Get icon and color scheme based on item type
function getItemTypeConfig(type: ReturnType<typeof getItemType>) {
  switch (type) {
    case 'character':
      return {
        icon: User,
        label: 'Character',
        gradient: 'from-primary/20 to-primary/30',
        iconColor: 'text-primary',
        accentColor: 'border-primary/30 bg-primary/10 text-primary'
      };
    case 'product':
      return {
        icon: ShoppingBag,
        label: 'Product',
        gradient: 'from-primary/20 to-pink-500/20',
        iconColor: 'text-primary',
        accentColor: 'border-primary/30 bg-primary/10 text-primary'
      };
    case 'brand_voice':
      return {
        icon: Mic,
        label: 'Brand Voice',
        gradient: 'from-primary/20 to-pink-500/20',
        iconColor: 'text-primary',
        accentColor: 'border-primary/30 bg-primary/10 text-primary'
      };
    case 'icp':
      return {
        icon: Users,
        label: 'Target Audience',
        gradient: 'from-blue-500/20 to-cyan-500/20',
        iconColor: 'text-blue-600',
        accentColor: 'border-blue-500/30 bg-blue-500/10 text-blue-700'
      };
    case 'block':
      return {
        icon: Sparkles,
        label: 'Content Block',
        gradient: 'from-cta/20 to-cta-hover/20',
        iconColor: 'text-cta',
        accentColor: 'border-cta/30 bg-cta/10 text-cta'
      };
    default:
      return {
        icon: FileText,
        label: 'Library Item',
        gradient: 'from-gray-500/20 to-slate-500/20',
        iconColor: 'text-gray-600',
        accentColor: 'border-gray-500/30 bg-gray-500/10 text-gray-700'
      };
  }
}

// Section component for consistent styling
function Section({
  icon: Icon,
  title,
  children,
  iconColor = "text-muted-foreground"
}: {
  icon: React.ElementType;
  title: string;
  children: React.ReactNode;
  iconColor?: string;
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("w-4 h-4", iconColor)} />
        <h3 className="text-sm font-semibold">{title}</h3>
      </div>
      {children}
    </div>
  );
}

// Text block with proper formatting
function TextBlock({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn(
      "text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap rounded-lg bg-muted/50 p-3 border",
      className
    )}>
      {text}
    </div>
  );
}

// List with bullet points
function BulletList({ items, emptyText }: { items: string[]; emptyText?: string }) {
  if (!items || items.length === 0) {
    return emptyText ? <p className="text-sm text-muted-foreground italic">{emptyText}</p> : null;
  }
  return (
    <ul className="space-y-2">
      {items.map((item, idx) => (
        <li key={idx} className="flex items-start gap-2 text-sm text-muted-foreground">
          <span className="w-1.5 h-1.5 rounded-full bg-primary/60 mt-2 shrink-0" />
          <span className="leading-relaxed">{item}</span>
        </li>
      ))}
    </ul>
  );
}

// Badge group for tags/traits
function BadgeGroup({ items, variant = "outline" }: { items: string[]; variant?: "outline" | "secondary" }) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item, idx) => (
        <Badge key={idx} variant={variant} className="text-xs">
          {item}
        </Badge>
      ))}
    </div>
  );
}

// Attribute row for key-value pairs
function AttributeRow({ label, value, badge }: { label: string; value?: string | null; badge?: boolean }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between py-2 border-b border-border/50 last:border-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      {badge ? (
        <Badge variant="secondary" className="capitalize">{value}</Badge>
      ) : (
        <span className="text-sm font-medium">{value}</span>
      )}
    </div>
  );
}

export function LibraryElementPreview({
  open,
  onOpenChange,
  item,
  selectedImages,
  onImageSelectionChange,
}: LibraryElementPreviewProps) {
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);

  if (!item) return null;

  // Collect images from various fields depending on library type
  const images = item.reference_images || item.images || item.logos || (item.logo ? [item.logo] : []);
  const itemName = item.name || item.title || 'Untitled';
  const itemType = getItemType(item);
  const typeConfig = getItemTypeConfig(itemType);
  const IconComponent = typeConfig.icon;

  const handleImageToggle = (url: string) => {
    if (selectedImages.includes(url)) {
      onImageSelectionChange(selectedImages.filter(u => u !== url));
    } else {
      onImageSelectionChange([...selectedImages, url]);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl flex flex-col p-0 gap-0" side="right">
        {/* Header - Fixed at top */}
        <div className="shrink-0 p-6 border-b bg-gradient-to-br from-background to-muted/30 relative">
          {/* Explicit Close Button for better UX */}
          <div className="absolute right-4 top-4 z-50">
            <SheetClose asChild>
              <button className="rounded-full p-2 bg-background/50 hover:bg-background border transition-colors">
                <X className="h-4 w-4" />
                <span className="sr-only">Close</span>
              </button>
            </SheetClose>
          </div>

          <SheetHeader className="space-y-4 pr-8">
            <div className="flex items-start gap-4">
              <div className={cn(
                "w-12 h-12 rounded-xl bg-gradient-to-br flex items-center justify-center shrink-0 shadow-sm",
                typeConfig.gradient
              )}>
                <IconComponent className={cn("w-6 h-6", typeConfig.iconColor)} />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <SheetTitle className="text-xl leading-tight truncate">{itemName}</SheetTitle>
                <SheetDescription className="mt-1 flex items-center gap-2">
                  <Badge variant="outline" className={cn("text-xs font-normal", typeConfig.accentColor)}>
                    {typeConfig.label}
                  </Badge>
                  {images.length > 0 && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <ImageIcon className="h-3 w-3" />
                      {images.length} images
                    </span>
                  )}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
        </div>

        {/* Content - Scrollable Area */}
        <ScrollArea className="flex-1 w-full">
          <div className="p-6 space-y-8 pb-20">

            {/* Description - Always show first if available */}
            {item.description && (
              <Section icon={FileText} title="Description" iconColor={typeConfig.iconColor}>
                <TextBlock text={item.description} className="bg-muted/30 border-none shadow-sm" />
              </Section>
            )}

            {/* Images Section - Important for selection */}
            {images.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ImageIcon className={cn("w-4 h-4", typeConfig.iconColor)} />
                    <h3 className="text-sm font-semibold">Reference Images</h3>
                  </div>
                  <Badge variant={selectedImages.length > 0 ? "default" : "secondary"} className="text-xs">
                    {selectedImages.length}/{images.length} Selected
                  </Badge>
                </div>

                <p className="text-xs text-muted-foreground">
                  Select images to guide the AI generation style.
                </p>

                <div className="grid grid-cols-2 gap-3">
                  {images.map((url: string, idx: number) => {
                    const isSelected = selectedImages.includes(url);
                    return (
                      <div
                        key={idx}
                        className={cn(
                          "group relative rounded-lg overflow-hidden border-2 cursor-pointer transition-all duration-200",
                          isSelected
                            ? "border-primary shadow-md ring-2 ring-primary/20 scale-[1.02]"
                            : "border-border/50 hover:border-primary/50 hover:shadow-sm"
                        )}
                        onClick={() => handleImageToggle(url)}
                      >
                        <div className="aspect-[4/3] w-full relative bg-muted/50 flex items-center justify-center">
                          <img
                            src={url}
                            alt={`${itemName} - Image ${idx + 1}`}
                            className="max-w-full max-h-full object-contain transition-transform duration-500 group-hover:scale-105"
                          />
                          {/* Overlay gradient for text readability if needed, or visual effect */}
                          <div className={cn(
                            "absolute inset-0 bg-black/0 transition-colors pointer-events-none",
                            isSelected ? "bg-primary/5" : "group-hover:bg-black/5"
                          )} />
                        </div>

                        {/* Expand button */}
                        <button
                          className="absolute top-2 left-2 bg-black/60 hover:bg-black/80 text-white rounded-full w-7 h-7 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setLightboxImage(url);
                          }}
                        >
                          <ZoomIn className="h-4 w-4" />
                        </button>

                        <div className="absolute top-2 right-2 z-10">
                          <div className={cn(
                            "w-6 h-6 rounded-full flex items-center justify-center transition-all shadow-sm backdrop-blur-sm",
                            isSelected
                              ? "bg-primary text-primary-foreground scale-100"
                              : "bg-white/80 text-muted-foreground opacity-0 group-hover:opacity-100 scale-90 group-hover:scale-100"
                          )}>
                            {isSelected ? <CheckCircle2 className="h-4 w-4" /> : <div className="w-3 h-3 rounded-full border-2 border-current" />}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom Separator */}
            {(itemType !== 'unknown' || item.tags) && <Separator className="bg-border/60" />}

            {/* Character-specific fields */}
            {itemType === 'character' && (
              <div className="space-y-6">
                {/* Visual Attributes Grid */}
                {(item.gender || item.age_range || item.build || item.ethnicity) && (
                  <Section icon={User} title="Appearance" iconColor="text-primary">
                    <div className="grid grid-cols-2 gap-3">
                      {item.gender && <div className="p-3 bg-card rounded-lg border shadow-sm"><span className="text-xs text-muted-foreground block mb-1">Gender</span><span className="font-medium text-sm">{item.gender}</span></div>}
                      {item.age_range && <div className="p-3 bg-card rounded-lg border shadow-sm"><span className="text-xs text-muted-foreground block mb-1">Age</span><span className="font-medium text-sm">{item.age_range}</span></div>}
                      {item.build && <div className="p-3 bg-card rounded-lg border shadow-sm"><span className="text-xs text-muted-foreground block mb-1">Build</span><span className="font-medium text-sm">{item.build}</span></div>}
                      {item.ethnicity && <div className="p-3 bg-card rounded-lg border shadow-sm"><span className="text-xs text-muted-foreground block mb-1">Ethnicity</span><span className="font-medium text-sm">{item.ethnicity}</span></div>}
                    </div>
                  </Section>
                )}

                {/* Hair & Clothing */}
                {(item.hair_description || item.typical_clothing) && (
                  <Section icon={Shirt} title="Style Details" iconColor="text-pink-600">
                    {item.hair_description && (
                      <div className="mb-4">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Hair</p>
                        <TextBlock text={item.hair_description} />
                      </div>
                    )}
                    {item.typical_clothing && (
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Clothing</p>
                        <TextBlock text={item.typical_clothing} />
                      </div>
                    )}
                  </Section>
                )}

                {/* Visual Style */}
                {item.visual_style && (
                  <Section icon={Palette} title="Visual Style" iconColor="text-cyan-600">
                    <TextBlock text={item.visual_style} />
                  </Section>
                )}

                {/* Voice & Speaking */}
                {(item.speaking_style || item.overall_tone) && (
                  <Section icon={MessageSquare} title="Voice & Communication" iconColor="text-primary">
                    <div className="bg-card rounded-lg border p-4 shadow-sm space-y-3">
                      {item.overall_tone && (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-medium">Overall Tone</span>
                          <Badge variant="secondary" className="capitalize">{item.overall_tone}</Badge>
                        </div>
                      )}
                      {item.speaking_style && (
                        <div className="pt-2 border-t">
                          <span className="text-xs text-muted-foreground block mb-1">Speaking Style</span>
                          <p className="text-sm leading-relaxed">{item.speaking_style}</p>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {/* Personality */}
                {(item.personality || item.personality_traits) && (
                  <Section icon={Heart} title="Personality" iconColor="text-rose-600">
                    {item.personality_traits && Array.isArray(item.personality_traits) && item.personality_traits.length > 0 && (
                      <div className="mb-3">
                        <BadgeGroup items={item.personality_traits} variant="secondary" />
                      </div>
                    )}
                    {item.personality && (
                      <TextBlock text={typeof item.personality === 'string' ? item.personality : item.personality?.description || ''} />
                    )}
                  </Section>
                )}
              </div>
            )}

            {/* Product-specific fields */}
            {itemType === 'product' && (
              <div className="space-y-6">
                {/* Product Details */}
                {(item.brand || item.category || item.sku || item.price) && (
                  <Section icon={ShoppingBag} title="Product Details" iconColor="text-primary">
                    <div className="rounded-lg border bg-card overflow-hidden">
                      <AttributeRow label="Brand" value={item.brand} badge />
                      <AttributeRow label="Category" value={item.category} badge />
                      <AttributeRow label="SKU" value={item.sku} />
                      {item.price && (
                        <AttributeRow
                          label="Price"
                          value={`${item.currency || 'USD'} ${typeof item.price === 'number' ? item.price.toFixed(2) : item.price}`}
                        />
                      )}
                    </div>
                  </Section>
                )}

                {/* Features */}
                {item.features && Array.isArray(item.features) && item.features.length > 0 && (
                  <Section icon={Sparkles} title="Features" iconColor="text-cta">
                    <BulletList items={item.features} />
                  </Section>
                )}

                {/* Key Benefits */}
                {item.key_benefits && Array.isArray(item.key_benefits) && item.key_benefits.length > 0 && (
                  <Section icon={Target} title="Key Benefits" iconColor="text-green-600">
                    <BulletList items={item.key_benefits} />
                  </Section>
                )}
              </div>
            )}

            {/* Brand Voice fields */}
            {itemType === 'brand_voice' && (
              <div className="space-y-6">
                {/* Logo */}
                {item.logo && (
                  <Section icon={ImageIcon} title="Logo" iconColor="text-primary">
                    <div className="p-6 border rounded-xl bg-white/50 flex items-center justify-center">
                      <img
                        src={item.logo}
                        alt={`${itemName} logo`}
                        className="max-h-24 object-contain"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  </Section>
                )}

                {/* Tone */}
                {item.tone && (
                  <Section icon={MessageSquare} title="Tone" iconColor="text-primary">
                    <Badge variant="secondary" className="capitalize text-sm h-7 px-3">{item.tone}</Badge>
                  </Section>
                )}

                {/* Style Guidelines */}
                {item.style_guidelines && (
                  <Section icon={FileText} title="Style Guidelines" iconColor="text-blue-600">
                    <TextBlock text={item.style_guidelines} className="font-mono text-xs bg-slate-50 border-slate-100 dark:bg-slate-900/50 dark:border-slate-800" />
                  </Section>
                )}

                {/* Visual Identity Section */}
                {(item.visual_template || item.color_palette || item.font_style || item.accent_style) && (
                  <Section icon={Palette} title="Visual Identity" iconColor="text-cyan-600">
                    <div className="space-y-4">
                      {/* Visual Template & Typography Row */}
                      {(item.visual_template || item.font_style || item.accent_style) && (
                        <div className="rounded-lg border bg-card">
                          {item.visual_template && (
                            <div className="flex items-center justify-between py-2 px-3 border-b border-border/50">
                              <span className="text-sm text-muted-foreground flex items-center gap-2">
                                <Layers className="w-3.5 h-3.5" />
                                Design Template
                              </span>
                              <Badge variant="secondary" className="capitalize">{item.visual_template}</Badge>
                            </div>
                          )}
                          {item.font_style && (
                            <div className="flex items-center justify-between py-2 px-3 border-b border-border/50">
                              <span className="text-sm text-muted-foreground flex items-center gap-2">
                                <Type className="w-3.5 h-3.5" />
                                Font Style
                              </span>
                              <Badge variant="secondary" className="capitalize">{item.font_style.replace('-', ' ')}</Badge>
                            </div>
                          )}
                          {item.accent_style && (
                            <div className="flex items-center justify-between py-2 px-3">
                              <span className="text-sm text-muted-foreground flex items-center gap-2">
                                <Blend className="w-3.5 h-3.5" />
                                Accent Style
                              </span>
                              <Badge variant="secondary" className="capitalize">{item.accent_style}</Badge>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Color Palette */}
                      {item.color_palette && (
                        <div className="space-y-2">
                          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Color Palette</p>
                          <div className="flex gap-1 p-2 rounded-lg border bg-muted/30">
                            {['primary', 'secondary', 'background', 'text', 'textMuted'].map((key) => {
                              const color = item.color_palette[key];
                              if (!color) return null;
                              return (
                                <div key={key} className="flex-1 flex flex-col items-center gap-1 group/color">
                                  <div
                                    className="w-full h-8 rounded-md border shadow-sm group-hover/color:scale-105 transition-transform"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="text-[10px] text-muted-foreground capitalize">{key.replace('textMuted', 'Muted')}</span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </Section>
                )}

                {/* Visual Style Description */}
                {item.visual_style_description && (
                  <Section icon={Sparkles} title="Visual Style Description" iconColor="text-cyan-600">
                    <TextBlock text={item.visual_style_description} />
                  </Section>
                )}

                {/* Mood Keywords */}
                {item.mood_keywords && Array.isArray(item.mood_keywords) && item.mood_keywords.length > 0 && (
                  <Section icon={Sparkles} title="Mood Keywords" iconColor="text-pink-600">
                    <BadgeGroup items={item.mood_keywords} variant="secondary" />
                  </Section>
                )}
              </div>
            )}

            {/* ICP/Target Audience fields */}
            {itemType === 'icp' && (
              <div className="space-y-6">
                {/* Pain Points */}
                {item.pain_points && Array.isArray(item.pain_points) && item.pain_points.length > 0 && (
                  <Section icon={Target} title="Pain Points" iconColor="text-red-600">
                    <BulletList items={item.pain_points} />
                  </Section>
                )}

                {/* Desires */}
                {item.desires && Array.isArray(item.desires) && item.desires.length > 0 && (
                  <Section icon={Heart} title="Desires & Goals" iconColor="text-pink-600">
                    <BulletList items={item.desires} />
                  </Section>
                )}

                {/* Objections */}
                {item.objections && Array.isArray(item.objections) && item.objections.length > 0 && (
                  <Section icon={AlertTriangle} title="Common Objections" iconColor="text-amber-600">
                    <BulletList items={item.objections} />
                  </Section>
                )}

                {/* Language Style */}
                {item.language_style && (
                  <Section icon={MessageSquare} title="Language Style" iconColor="text-primary">
                    <TextBlock text={item.language_style} />
                  </Section>
                )}
              </div>
            )}

            {/* Content Block fields */}
            {itemType === 'block' && (
              <div className="space-y-6">
                {item.block_type && (
                  <Section icon={Scissors} title="Block Type" iconColor="text-cta">
                    <Badge variant="secondary" className="capitalize">{item.block_type.replace('_', ' ')}</Badge>
                  </Section>
                )}

                {item.content && (
                  <Section icon={FileText} title="Content" iconColor="text-blue-600">
                    <TextBlock text={item.content} className="font-mono text-xs whitespace-pre-wrap" />
                  </Section>
                )}
              </div>
            )}

            {/* Tags - Universal for all types */}
            {item.tags && Array.isArray(item.tags) && item.tags.length > 0 && (
              <>
                <Separator />
                <Section icon={Tag} title="Tags" iconColor="text-slate-600">
                  <BadgeGroup items={item.tags} />
                </Section>
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer (Optional) - Could have actions like "Select This Item" if we wanted to direct select from here */}

      </SheetContent>

      {/* Lightbox for expanded image view */}
      <Lightbox
        open={!!lightboxImage}
        onOpenChange={(open) => !open && setLightboxImage(null)}
        src={lightboxImage}
      />
    </Sheet>
  );
}
