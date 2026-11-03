import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AutosaveIndicator } from "@/components/ui/autosave-indicator";
import { ColorPicker } from "@/components/ui/color-picker";
import { useAutosave } from "@/hooks/useAutosave";
import { useState, useEffect } from "react";
import { Mic, Calendar, Trash2, MessageSquare, ChevronDown, ChevronRight, Sparkles, FileText, Palette, X, Image, Type, Layers, Minus, Circle, Blend, Lightbulb, Check, Eye, Paintbrush, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/tableUtils";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import type { BrandVoice, ColorPalette, VisualTemplate, FontStyle, AccentStyle } from "@/hooks/useBrandVoices";

const DEFAULT_PALETTE: ColorPalette = {
  primary: '#2563EB',
  secondary: '#3B82F6',
  background: '#F8FAFC',
  text: '#1E293B',
  textMuted: '#64748B',
};

// Preset color palettes for quick selection
const PRESET_PALETTES: { name: string; colors: ColorPalette }[] = [
  {
    name: 'Ocean Blue',
    colors: { primary: '#0EA5E9', secondary: '#38BDF8', background: '#F0F9FF', text: '#0C4A6E', textMuted: '#64748B' },
  },
  {
    name: 'Forest Green',
    colors: { primary: '#10B981', secondary: '#34D399', background: '#ECFDF5', text: '#064E3B', textMuted: '#6B7280' },
  },
  {
    name: 'Royal Purple',
    colors: { primary: '#8B5CF6', secondary: '#A78BFA', background: '#FAF5FF', text: '#4C1D95', textMuted: '#6B7280' },
  },
  {
    name: 'Sunset Orange',
    colors: { primary: '#F97316', secondary: '#FB923C', background: '#FFF7ED', text: '#7C2D12', textMuted: '#78716C' },
  },
  {
    name: 'Rose Pink',
    colors: { primary: '#EC4899', secondary: '#F472B6', background: '#FDF2F8', text: '#831843', textMuted: '#6B7280' },
  },
  {
    name: 'Slate Gray',
    colors: { primary: '#475569', secondary: '#64748B', background: '#F8FAFC', text: '#0F172A', textMuted: '#94A3B8' },
  },
];

const TEMPLATE_PRESETS: { value: VisualTemplate; label: string; description: string; icon: React.ReactNode }[] = [
  { value: 'minimal', label: 'Minimal', description: 'Clean & whitespace', icon: <Minus className="w-5 h-5" /> },
  { value: 'bold', label: 'Bold', description: 'High contrast', icon: <Layers className="w-5 h-5" /> },
  { value: 'elegant', label: 'Elegant', description: 'Sophisticated', icon: <Circle className="w-5 h-5" /> },
  { value: 'playful', label: 'Playful', description: 'Fun & rounded', icon: <Sparkles className="w-5 h-5" /> },
  { value: 'professional', label: 'Professional', description: 'Corporate', icon: <FileText className="w-5 h-5" /> },
];

const FONT_STYLE_OPTIONS: { value: FontStyle; label: string; preview: string; fontClass: string }[] = [
  { value: 'sans-serif', label: 'Sans Serif', preview: 'Aa', fontClass: 'font-sans' },
  { value: 'serif', label: 'Serif', preview: 'Aa', fontClass: 'font-serif' },
  { value: 'display', label: 'Display', preview: 'Aa', fontClass: 'font-sans font-black tracking-tight' },
  { value: 'handwritten', label: 'Script', preview: 'Aa', fontClass: 'italic' },
];

const ACCENT_STYLE_OPTIONS: { value: AccentStyle; label: string; className: string }[] = [
  { value: 'solid', label: 'Solid', className: 'bg-current' },
  { value: 'gradient', label: 'Gradient', className: 'bg-gradient-to-r from-current to-current/50' },
  { value: 'outline', label: 'Outline', className: 'border-2 border-current bg-transparent' },
  { value: 'glow', label: 'Glow', className: 'bg-current shadow-lg shadow-current/50' },
];

interface BrandVoiceDetailsDialogProps {
  brandVoice: BrandVoice | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (id: string, updates: Partial<BrandVoice>) => void;
  onDelete: (id: string) => void;
  isUpdating: boolean;
}

export function BrandVoiceDetailsDialog({ brandVoice, open, onOpenChange, onSave, onDelete, isUpdating }: BrandVoiceDetailsDialogProps) {
  const [edited, setEdited] = useState<Partial<BrandVoice>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [guidelinesOpen, setGuidelinesOpen] = useState(true);
  const [visualIdentityOpen, setVisualIdentityOpen] = useState(false);
  const [keywordInput, setKeywordInput] = useState("");
  const [newLogoUrl, setNewLogoUrl] = useState("");

  // Reset edited state when dialog opens/closes or brand voice changes
  useEffect(() => {
    if (!open || !brandVoice) {
      setEdited({});
      setKeywordInput("");
      setNewLogoUrl("");
    }
  }, [open, brandVoice?.id]);

  const handleAddKeyword = () => {
    const trimmed = keywordInput.trim().toLowerCase();
    const currentKeywords = edited.mood_keywords ?? brandVoice?.mood_keywords ?? [];
    if (trimmed && !currentKeywords.includes(trimmed)) {
      setEdited({ ...edited, mood_keywords: [...currentKeywords, trimmed] });
      setKeywordInput("");
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    const currentKeywords = edited.mood_keywords ?? brandVoice?.mood_keywords ?? [];
    setEdited({ ...edited, mood_keywords: currentKeywords.filter(k => k !== keyword) });
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddKeyword();
    }
  };

  const updatePaletteColor = (key: keyof ColorPalette, value: string) => {
    const currentPalette = edited.color_palette ?? brandVoice?.color_palette ?? DEFAULT_PALETTE;
    setEdited({ ...edited, color_palette: { ...currentPalette, [key]: value } });
  };

  const applyPresetPalette = (preset: ColorPalette) => {
    setEdited({ ...edited, color_palette: preset });
  };

  // Autosave with debounce
  const { isSaving } = useAutosave(
    (updates) => {
      if (brandVoice) {
        onSave(brandVoice.id, updates);
      }
    },
    edited,
    1000,
    Object.keys(edited).length > 0 && !isUpdating
  );

  const handleDelete = () => {
    if (brandVoice) {
      onDelete(brandVoice.id);
      setDeleteDialogOpen(false);
      onOpenChange(false);
    }
  };

  if (!brandVoice) return null;

  const currentName = edited.name ?? brandVoice.name;
  const currentDescription = edited.description ?? brandVoice.description ?? "";
  const currentTone = edited.tone ?? brandVoice.tone ?? "";
  const currentStyleGuidelines = edited.style_guidelines ?? brandVoice.style_guidelines ?? "";
  const currentLogos = edited.logos ?? brandVoice.logos ?? [];

  // Visual identity fields
  const currentVisualTemplate = edited.visual_template ?? brandVoice.visual_template;
  const currentColorPalette = edited.color_palette ?? brandVoice.color_palette ?? DEFAULT_PALETTE;
  const currentFontStyle = edited.font_style ?? brandVoice.font_style;
  const currentAccentStyle = edited.accent_style ?? brandVoice.accent_style;
  const currentVisualStyleDescription = edited.visual_style_description ?? brandVoice.visual_style_description ?? "";
  const currentMoodKeywords = edited.mood_keywords ?? brandVoice.mood_keywords ?? [];

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-3xl flex flex-col h-[90vh] overflow-hidden p-0">
          <form className="flex flex-col flex-1 min-h-0">
            <DialogHeader className="shrink-0 px-6 pt-6 pb-4 border-b">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                    <Mic className="w-5 h-5 text-foreground" />
                  </div>
                  <div>
                    <DialogTitle className="text-xl">Edit Brand</DialogTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(brandVoice.created_at)}
                      </span>
                      {brandVoice.tone && (
                        <Badge variant="secondary" className="text-xs">
                          {brandVoice.tone}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <AutosaveIndicator isSaving={isSaving} />
              </div>
            </DialogHeader>

            <ScrollArea className="flex-1 min-h-0">
              <div className="space-y-6 px-6 py-4">
                <div className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="name" className="text-sm font-medium">
                        Brand Name
                      </Label>
                      <Input
                        id="name"
                        value={currentName}
                        onChange={(e) => setEdited({ ...edited, name: e.target.value })}
                        className="h-11 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm font-medium">
                        Logos
                      </Label>
                      <div className="flex gap-2">
                        <Input
                          value={newLogoUrl}
                          onChange={(e) => setNewLogoUrl(e.target.value)}
                          placeholder="https://example.com/logo.png"
                          className="h-11 flex-1 focus-visible:ring-2 focus-visible:ring-ring"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              if (newLogoUrl.trim() && !currentLogos.includes(newLogoUrl.trim())) {
                                const newLogos = [...currentLogos, newLogoUrl.trim()];
                                setEdited({ ...edited, logos: newLogos, logo: newLogos[0] });
                                setNewLogoUrl("");
                              }
                            }
                          }}
                        />
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            if (newLogoUrl.trim() && !currentLogos.includes(newLogoUrl.trim())) {
                              const newLogos = [...currentLogos, newLogoUrl.trim()];
                              setEdited({ ...edited, logos: newLogos, logo: newLogos[0] });
                              setNewLogoUrl("");
                            }
                          }}
                          disabled={!newLogoUrl.trim()}
                          className="h-11"
                        >
                          <Plus className="w-4 h-4" />
                        </Button>
                      </div>
                      {currentLogos.length > 0 && (
                        <div className="mt-2 space-y-2">
                          {currentLogos.map((logoUrl, index) => (
                            <div key={index} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/50 min-w-0 overflow-hidden">
                              <img
                                src={logoUrl}
                                alt={`Logo ${index + 1}`}
                                className="h-10 w-10 shrink-0 object-contain rounded"
                                onError={(e) => {
                                  (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
                                }}
                              />
                              <span className="flex-1 min-w-0 text-sm truncate text-muted-foreground">{logoUrl}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const newLogos = currentLogos.filter((_, i) => i !== index);
                                  setEdited({ ...edited, logos: newLogos, logo: newLogos[0] || null });
                                }}
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Add multiple logos to use as reference images for content generation
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="tone" className="text-sm font-medium">
                        Tone
                      </Label>
                      <Input
                        id="tone"
                        value={currentTone}
                        onChange={(e) => setEdited({ ...edited, tone: e.target.value })}
                        placeholder="e.g., Professional, Friendly, Casual"
                        className="h-11 focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                </div>

                <div className="space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="description" className="text-sm font-medium">
                      Description
                    </Label>
                    <Textarea
                      id="description"
                      value={currentDescription}
                      onChange={(e) => setEdited({ ...edited, description: e.target.value })}
                      placeholder="Describe the essence of this brand voice..."
                      className="min-h-[100px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                </div>

                <Collapsible open={guidelinesOpen} onOpenChange={setGuidelinesOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <FileText className="w-4 h-4 text-muted-foreground" />
                            <span className="text-sm font-medium">Style Guidelines</span>
                          </div>
                          {guidelinesOpen ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Textarea
                      id="style_guidelines"
                      value={currentStyleGuidelines}
                      onChange={(e) => setEdited({ ...edited, style_guidelines: e.target.value })}
                      placeholder="Define writing style, formatting preferences, vocabulary choices..."
                      className="min-h-[120px] max-h-[300px] resize-y font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </CollapsibleContent>
                </Collapsible>

                {/* Visual Identity Section - Redesigned */}
                <Collapsible open={visualIdentityOpen} onOpenChange={setVisualIdentityOpen}>
                  <CollapsibleTrigger className="w-full">
                    <div className="rounded-lg border hover:bg-accent/50 transition-colors cursor-pointer p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <Palette className="w-4 h-4 text-muted-foreground" />
                            <div className="text-left">
                              <span className="text-sm font-medium block">Visual Identity</span>
                              <span className="text-xs text-muted-foreground">For Instagram carousels & generated visuals</span>
                            </div>
                          </div>
                          {visualIdentityOpen ? (
                            <ChevronDown className="w-5 h-5 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="w-5 h-5 text-muted-foreground" />
                          )}
                        </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-3">
                    <Card className="border overflow-hidden">
                      <CardContent className="p-0">
                        <Tabs defaultValue="style" className="w-full">
                          <TabsList className="w-full justify-start rounded-none border-b bg-muted/30 p-0 h-auto">
                            <TabsTrigger
                              value="style"
                              className="rounded-none border-b-2 border-transparent data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent py-3 px-4"
                            >
                              <Paintbrush className="w-4 h-4 mr-2" />
                              Style
                            </TabsTrigger>
                            <TabsTrigger
                              value="colors"
                              className="rounded-none border-b-2 border-transparent data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent py-3 px-4"
                            >
                              <Palette className="w-4 h-4 mr-2" />
                              Colors
                            </TabsTrigger>
                            <TabsTrigger
                              value="typography"
                              className="rounded-none border-b-2 border-transparent data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent py-3 px-4"
                            >
                              <Type className="w-4 h-4 mr-2" />
                              Typography
                            </TabsTrigger>
                            <TabsTrigger
                              value="preview"
                              className="rounded-none border-b-2 border-transparent data-[state=active]:border-cyan-500 data-[state=active]:bg-transparent py-3 px-4"
                            >
                              <Eye className="w-4 h-4 mr-2" />
                              Preview
                            </TabsTrigger>
                          </TabsList>

                          {/* Style Tab */}
                          <TabsContent value="style" className="p-6 space-y-6 mt-0">
                            {/* Design Template Cards */}
                            <div className="space-y-3">
                              <Label className="text-sm font-medium flex items-center gap-2">
                                <Layers className="w-4 h-4 text-cyan-600" />
                                Design Template
                              </Label>
                              <div className="grid grid-cols-5 gap-2">
                                {TEMPLATE_PRESETS.map((template) => (
                                  <button
                                    key={template.value}
                                    type="button"
                                    onClick={() => setEdited({ ...edited, visual_template: currentVisualTemplate === template.value ? null : template.value })}
                                    className={cn(
                                      "relative flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                                      "hover:border-cyan-500/50 hover:bg-cyan-500/5",
                                      currentVisualTemplate === template.value
                                        ? "border-cyan-500 bg-cyan-500/10"
                                        : "border-border"
                                    )}
                                  >
                                    {currentVisualTemplate === template.value && (
                                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-white" />
                                      </div>
                                    )}
                                    <div className={cn(
                                      "w-8 h-8 rounded-lg flex items-center justify-center",
                                      currentVisualTemplate === template.value ? "text-cyan-600" : "text-muted-foreground"
                                    )}>
                                      {template.icon}
                                    </div>
                                    <div className="text-center">
                                      <p className="text-xs font-medium">{template.label}</p>
                                      <p className="text-[10px] text-muted-foreground leading-tight">{template.description}</p>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Visual Style Description */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium flex items-center gap-2">
                                <Lightbulb className="w-4 h-4 text-cyan-600" />
                                Visual Style Description
                              </Label>
                              <Textarea
                                value={currentVisualStyleDescription}
                                onChange={(e) => setEdited({ ...edited, visual_style_description: e.target.value })}
                                placeholder="Describe the visual aesthetic you want (e.g., minimalist flat design with soft shadows, 3D isometric illustrations, watercolor textures...)"
                                className="min-h-[80px] resize-y text-sm"
                              />
                              <p className="text-xs text-muted-foreground">
                                This will be injected into AI image generation prompts
                              </p>
                            </div>

                            {/* Mood Keywords */}
                            <div className="space-y-3">
                              <Label className="text-sm font-medium">Mood Keywords</Label>
                              <div className="flex gap-2">
                                <Input
                                  value={keywordInput}
                                  onChange={(e) => setKeywordInput(e.target.value)}
                                  onKeyDown={handleKeywordKeyDown}
                                  placeholder="Type a keyword and press Enter..."
                                  className="flex-1"
                                />
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  onClick={handleAddKeyword}
                                  disabled={!keywordInput.trim()}
                                >
                                  Add
                                </Button>
                              </div>
                              {currentMoodKeywords.length > 0 ? (
                                <div className="flex flex-wrap gap-1.5">
                                  {currentMoodKeywords.map(keyword => (
                                    <Badge key={keyword} variant="secondary" className="gap-1 pr-1 bg-cyan-500/10 text-cyan-700 hover:bg-cyan-500/20">
                                      {keyword}
                                      <button
                                        type="button"
                                        onClick={() => handleRemoveKeyword(keyword)}
                                        className="ml-1 hover:bg-cyan-500/20 rounded-full p-0.5"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </Badge>
                                  ))}
                                </div>
                              ) : (
                                <p className="text-xs text-muted-foreground">
                                  Examples: modern, trustworthy, energetic, premium, organic, tech-forward
                                </p>
                              )}
                            </div>
                          </TabsContent>

                          {/* Colors Tab */}
                          <TabsContent value="colors" className="p-6 space-y-6 mt-0">
                            {/* Preset Palettes */}
                            <div className="space-y-3">
                              <Label className="text-sm font-medium">Quick Presets</Label>
                              <div className="grid grid-cols-3 gap-2">
                                {PRESET_PALETTES.map((preset) => (
                                  <button
                                    key={preset.name}
                                    type="button"
                                    onClick={() => applyPresetPalette(preset.colors)}
                                    className={cn(
                                      "flex items-center gap-2 p-2 rounded-lg border transition-all hover:border-cyan-500/50",
                                      JSON.stringify(currentColorPalette) === JSON.stringify(preset.colors)
                                        ? "border-cyan-500 bg-cyan-500/5"
                                        : "border-border"
                                    )}
                                  >
                                    <div className="flex gap-0.5">
                                      <div className="w-4 h-4 rounded-l" style={{ backgroundColor: preset.colors.primary }} />
                                      <div className="w-4 h-4" style={{ backgroundColor: preset.colors.secondary }} />
                                      <div className="w-4 h-4 rounded-r border" style={{ backgroundColor: preset.colors.background }} />
                                    </div>
                                    <span className="text-xs font-medium truncate">{preset.name}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Custom Colors */}
                            <div className="space-y-3">
                              <Label className="text-sm font-medium">Custom Colors</Label>
                              <div className="grid grid-cols-2 gap-3">
                                <ColorPicker
                                  label="Primary"
                                  value={currentColorPalette.primary}
                                  onChange={(v) => updatePaletteColor('primary', v)}
                                />
                                <ColorPicker
                                  label="Secondary"
                                  value={currentColorPalette.secondary}
                                  onChange={(v) => updatePaletteColor('secondary', v)}
                                />
                                <ColorPicker
                                  label="Background"
                                  value={currentColorPalette.background}
                                  onChange={(v) => updatePaletteColor('background', v)}
                                />
                                <ColorPicker
                                  label="Text"
                                  value={currentColorPalette.text}
                                  onChange={(v) => updatePaletteColor('text', v)}
                                />
                                <ColorPicker
                                  label="Muted Text"
                                  value={currentColorPalette.textMuted}
                                  onChange={(v) => updatePaletteColor('textMuted', v)}
                                />
                              </div>
                            </div>

                            {/* Palette Preview Bar */}
                            <div className="space-y-2">
                              <Label className="text-sm font-medium">Palette Preview</Label>
                              <div className="flex gap-1 p-3 rounded-lg border bg-muted/30">
                                <div className="h-10 flex-1 rounded-l-md flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: currentColorPalette.primary }}>
                                  Primary
                                </div>
                                <div className="h-10 flex-1 flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: currentColorPalette.secondary }}>
                                  Secondary
                                </div>
                                <div className="h-10 flex-1 flex items-center justify-center text-xs font-medium border" style={{ backgroundColor: currentColorPalette.background, color: currentColorPalette.text }}>
                                  BG
                                </div>
                                <div className="h-10 flex-1 flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: currentColorPalette.text }}>
                                  Text
                                </div>
                                <div className="h-10 flex-1 rounded-r-md flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: currentColorPalette.textMuted }}>
                                  Muted
                                </div>
                              </div>
                            </div>
                          </TabsContent>

                          {/* Typography Tab */}
                          <TabsContent value="typography" className="p-6 space-y-6 mt-0">
                            {/* Font Style */}
                            <div className="space-y-3">
                              <Label className="text-sm font-medium flex items-center gap-2">
                                <Type className="w-4 h-4 text-cyan-600" />
                                Font Style
                              </Label>
                              <div className="grid grid-cols-4 gap-2">
                                {FONT_STYLE_OPTIONS.map((font) => (
                                  <button
                                    key={font.value}
                                    type="button"
                                    onClick={() => setEdited({ ...edited, font_style: currentFontStyle === font.value ? null : font.value })}
                                    className={cn(
                                      "relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                                      "hover:border-cyan-500/50 hover:bg-cyan-500/5",
                                      currentFontStyle === font.value
                                        ? "border-cyan-500 bg-cyan-500/10"
                                        : "border-border"
                                    )}
                                  >
                                    {currentFontStyle === font.value && (
                                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-white" />
                                      </div>
                                    )}
                                    <span className={cn("text-2xl", font.fontClass)}>{font.preview}</span>
                                    <span className="text-xs font-medium">{font.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Accent Style */}
                            <div className="space-y-3">
                              <Label className="text-sm font-medium flex items-center gap-2">
                                <Blend className="w-4 h-4 text-cyan-600" />
                                Accent Style
                              </Label>
                              <div className="grid grid-cols-4 gap-2">
                                {ACCENT_STYLE_OPTIONS.map((accent) => (
                                  <button
                                    key={accent.value}
                                    type="button"
                                    onClick={() => setEdited({ ...edited, accent_style: currentAccentStyle === accent.value ? null : accent.value })}
                                    className={cn(
                                      "relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                                      "hover:border-cyan-500/50 hover:bg-cyan-500/5",
                                      currentAccentStyle === accent.value
                                        ? "border-cyan-500 bg-cyan-500/10"
                                        : "border-border"
                                    )}
                                  >
                                    {currentAccentStyle === accent.value && (
                                      <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                                        <Check className="w-3 h-3 text-white" />
                                      </div>
                                    )}
                                    <div
                                      className={cn("w-12 h-6 rounded", accent.className)}
                                      style={{
                                        color: currentColorPalette.primary,
                                        borderColor: accent.value === 'outline' ? currentColorPalette.primary : undefined,
                                        background: accent.value === 'gradient'
                                          ? `linear-gradient(to right, ${currentColorPalette.primary}, ${currentColorPalette.secondary})`
                                          : accent.value === 'outline'
                                            ? 'transparent'
                                            : currentColorPalette.primary,
                                        boxShadow: accent.value === 'glow' ? `0 4px 14px ${currentColorPalette.primary}50` : undefined
                                      }}
                                    />
                                    <span className="text-xs font-medium">{accent.label}</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          </TabsContent>

                          {/* Preview Tab */}
                          <TabsContent value="preview" className="p-6 mt-0">
                            <div className="space-y-4">
                              <Label className="text-sm font-medium">Live Preview</Label>

                              {/* Preview Card */}
                              <div
                                className="rounded-xl overflow-hidden border-2 shadow-lg"
                                style={{ backgroundColor: currentColorPalette.background }}
                              >
                                {/* Header */}
                                <div
                                  className="p-4"
                                  style={{
                                    background: currentAccentStyle === 'gradient'
                                      ? `linear-gradient(to right, ${currentColorPalette.primary}, ${currentColorPalette.secondary})`
                                      : currentColorPalette.primary
                                  }}
                                >
                                  <h3 className="text-white font-bold text-lg">
                                    {currentName || 'Your Brand'}
                                  </h3>
                                </div>

                                {/* Content */}
                                <div className="p-5 space-y-4">
                                  <div>
                                    <h4
                                      className={cn(
                                        "text-xl font-bold mb-2",
                                        currentFontStyle === 'serif' && 'font-serif',
                                        currentFontStyle === 'display' && 'font-sans font-black tracking-tight',
                                        currentFontStyle === 'handwritten' && 'italic'
                                      )}
                                      style={{ color: currentColorPalette.text }}
                                    >
                                      Sample Headline
                                    </h4>
                                    <p
                                      className="text-sm leading-relaxed"
                                      style={{ color: currentColorPalette.textMuted }}
                                    >
                                      This is how your content will look with the selected visual identity settings.
                                    </p>
                                  </div>

                                  <div className="flex gap-2">
                                    <button
                                      className={cn(
                                        "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                                        currentAccentStyle === 'outline' && "bg-transparent border-2",
                                        currentFontStyle === 'serif' && 'font-serif',
                                        currentFontStyle === 'display' && 'font-sans font-black tracking-tight',
                                        currentFontStyle === 'handwritten' && 'italic'
                                      )}
                                      style={{
                                        background: currentAccentStyle === 'gradient'
                                          ? `linear-gradient(to right, ${currentColorPalette.primary}, ${currentColorPalette.secondary})`
                                          : currentAccentStyle === 'outline'
                                            ? 'transparent'
                                            : currentColorPalette.primary,
                                        borderColor: currentAccentStyle === 'outline' ? currentColorPalette.primary : undefined,
                                        color: currentAccentStyle === 'outline' ? currentColorPalette.primary : 'white',
                                        boxShadow: currentAccentStyle === 'glow' ? `0 4px 14px ${currentColorPalette.primary}50` : undefined
                                      }}
                                    >
                                      Primary Action
                                    </button>
                                    <button
                                      className={cn(
                                        "px-4 py-2 rounded-lg text-sm font-semibold border-2 bg-transparent",
                                        currentFontStyle === 'serif' && 'font-serif',
                                        currentFontStyle === 'display' && 'font-sans font-black tracking-tight',
                                        currentFontStyle === 'handwritten' && 'italic'
                                      )}
                                      style={{
                                        borderColor: currentColorPalette.secondary,
                                        color: currentColorPalette.secondary
                                      }}
                                    >
                                      Secondary
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {/* Summary */}
                              <div className="flex flex-wrap gap-2 pt-2">
                                {currentVisualTemplate && (
                                  <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-700">
                                    {TEMPLATE_PRESETS.find(t => t.value === currentVisualTemplate)?.label}
                                  </Badge>
                                )}
                                {currentFontStyle && (
                                  <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-700">
                                    {FONT_STYLE_OPTIONS.find(f => f.value === currentFontStyle)?.label}
                                  </Badge>
                                )}
                                {currentAccentStyle && (
                                  <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-700">
                                    {ACCENT_STYLE_OPTIONS.find(a => a.value === currentAccentStyle)?.label} Accent
                                  </Badge>
                                )}
                                {currentMoodKeywords.map(kw => (
                                  <Badge key={kw} variant="secondary" className="text-xs">
                                    {kw}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                          </TabsContent>
                        </Tabs>
                      </CardContent>
                    </Card>
                  </CollapsibleContent>
                </Collapsible>
              </div>
            </ScrollArea>

            <div className="shrink-0 px-6 py-4 border-t flex items-center justify-between">
              <Button
                type="button"
                variant="destructive"
                onClick={() => setDeleteDialogOpen(true)}
                disabled={isUpdating}
                className="gap-2"
              >
                <Trash2 className="w-4 h-4" />
                Delete Brand
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                className="min-w-24"
              >
                Close
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Brand</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{brandVoice.name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
