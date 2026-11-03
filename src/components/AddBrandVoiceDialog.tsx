import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { useBrandVoices, type ColorPalette, type VisualTemplate, type FontStyle, type AccentStyle } from "@/hooks/useBrandVoices";
import { ColorPicker } from "@/components/ui/color-picker";
import { Mic, Sparkles, MessageSquare, FileText, ChevronDown, ChevronRight, Palette, X, Image, Type, Layers, Minus, Circle, Blend, Lightbulb, Check, Eye, Paintbrush, Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface AddBrandVoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

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

export function AddBrandVoiceDialog({ open, onOpenChange }: AddBrandVoiceDialogProps) {
  const { createBrandVoice, isCreating } = useBrandVoices();
  const [name, setName] = useState("");
  const [tone, setTone] = useState("");
  const [description, setDescription] = useState("");
  const [styleGuidelines, setStyleGuidelines] = useState("");
  const [logos, setLogos] = useState<string[]>([]);
  const [newLogoUrl, setNewLogoUrl] = useState("");
  const [guidelinesOpen, setGuidelinesOpen] = useState(true);
  const [visualIdentityOpen, setVisualIdentityOpen] = useState(false);

  // Visual identity state
  const [visualTemplate, setVisualTemplate] = useState<VisualTemplate | null>(null);
  const [colorPalette, setColorPalette] = useState<ColorPalette>(DEFAULT_PALETTE);
  const [fontStyle, setFontStyle] = useState<FontStyle | null>(null);
  const [accentStyle, setAccentStyle] = useState<AccentStyle | null>(null);
  const [visualStyleDescription, setVisualStyleDescription] = useState("");
  const [moodKeywords, setMoodKeywords] = useState<string[]>([]);
  const [keywordInput, setKeywordInput] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Only include visual fields if any are set
    const hasVisualStyling = visualTemplate || fontStyle || accentStyle || visualStyleDescription || moodKeywords.length > 0;

    createBrandVoice({
      name,
      tone: tone || null,
      description: description || null,
      style_guidelines: styleGuidelines || null,
      logo: logos.length > 0 ? logos[0] : null, // Keep first logo for backwards compatibility
      logos: logos.length > 0 ? logos : null,
      visual_template: visualTemplate,
      color_palette: hasVisualStyling ? colorPalette : null,
      font_style: fontStyle,
      accent_style: accentStyle,
      visual_style_description: visualStyleDescription || null,
      mood_keywords: moodKeywords.length > 0 ? moodKeywords : null,
    });
    onOpenChange(false);
    resetForm();
  };

  const resetForm = () => {
    setName("");
    setTone("");
    setDescription("");
    setStyleGuidelines("");
    setLogos([]);
    setNewLogoUrl("");
    setGuidelinesOpen(true);
    setVisualIdentityOpen(false);
    setVisualTemplate(null);
    setColorPalette(DEFAULT_PALETTE);
    setFontStyle(null);
    setAccentStyle(null);
    setVisualStyleDescription("");
    setMoodKeywords([]);
    setKeywordInput("");
  };

  const handleAddKeyword = () => {
    const trimmed = keywordInput.trim().toLowerCase();
    if (trimmed && !moodKeywords.includes(trimmed)) {
      setMoodKeywords([...moodKeywords, trimmed]);
      setKeywordInput("");
    }
  };

  const handleRemoveKeyword = (keyword: string) => {
    setMoodKeywords(moodKeywords.filter(k => k !== keyword));
  };

  const handleKeywordKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddKeyword();
    }
  };

  const updatePaletteColor = (key: keyof ColorPalette, value: string) => {
    setColorPalette(prev => ({ ...prev, [key]: value }));
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetForm();
    }
    onOpenChange(newOpen);
  };

  const applyPresetPalette = (preset: ColorPalette) => {
    setColorPalette(preset);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl flex flex-col h-[90vh] overflow-hidden p-0">
        <form className="flex flex-col flex-1 min-h-0" onSubmit={handleSubmit}>
          {/* Header with gradient background */}
          <div className="shrink-0 px-6 pt-6 pb-4 bg-gradient-to-br from-primary/10 via-pink-500/5 to-transparent">
            <div className="absolute top-4 right-8">
              <Badge className="bg-gradient-to-r from-primary to-pink-500 text-white border-0">
                <Sparkles className="w-3 h-3 mr-1" />
                New Brand
              </Badge>
            </div>
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-primary to-pink-500 flex items-center justify-center shadow-lg">
                <Mic className="w-6 h-6 text-white" />
              </div>
              <div>
                <DialogTitle className="text-xl font-bold">Create Brand Voice</DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Define your brand's tone, style, and visual identity
                </p>
              </div>
            </div>
          </div>

          <ScrollArea className="flex-1 min-h-0 px-6 py-6">
            <div className="space-y-6">
              <Card className="border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
                <div className="h-1.5 bg-gradient-to-r from-primary to-pink-500" />
                <CardContent className="pt-6 space-y-5">
                  <div className="space-y-2">
                    <Label htmlFor="name" className="text-base font-semibold flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary" />
                      Brand Name
                    </Label>
                    <Input
                      id="name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g., Acme Corp"
                      required
                      className="h-11 text-base font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-base font-semibold flex items-center gap-2">
                      <Image className="w-4 h-4 text-primary" />
                      Logos
                    </Label>
                    <div className="flex gap-2">
                      <Input
                        value={newLogoUrl}
                        onChange={(e) => setNewLogoUrl(e.target.value)}
                        placeholder="https://example.com/logo.png"
                        className="h-11 flex-1 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            if (newLogoUrl.trim() && !logos.includes(newLogoUrl.trim())) {
                              setLogos([...logos, newLogoUrl.trim()]);
                              setNewLogoUrl("");
                            }
                          }
                        }}
                      />
                      <Button
                        type="button"
                        variant="secondary"
                        onClick={() => {
                          if (newLogoUrl.trim() && !logos.includes(newLogoUrl.trim())) {
                            setLogos([...logos, newLogoUrl.trim()]);
                            setNewLogoUrl("");
                          }
                        }}
                        disabled={!newLogoUrl.trim()}
                        className="h-11"
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    </div>
                    {logos.length > 0 && (
                      <div className="mt-2 space-y-2">
                        {logos.map((logoUrl, index) => (
                          <div key={index} className="flex items-center gap-2 p-2 border rounded-lg bg-muted/50">
                            <img
                              src={logoUrl}
                              alt={`Logo ${index + 1}`}
                              className="h-10 w-10 object-contain rounded"
                              onError={(e) => {
                                (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="gray" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>';
                              }}
                            />
                            <span className="flex-1 text-sm truncate text-muted-foreground">{logoUrl}</span>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setLogos(logos.filter((_, i) => i !== index))}
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
                    <Label htmlFor="tone" className="text-base font-semibold flex items-center gap-2">
                      <MessageSquare className="w-4 h-4 text-primary" />
                      Tone
                    </Label>
                    <Input
                      id="tone"
                      value={tone}
                      onChange={(e) => setTone(e.target.value)}
                      placeholder="e.g., Professional, Friendly, Casual"
                      className="h-11 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="description" className="text-base font-semibold flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Description
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Describe the essence of this brand voice..."
                    className="min-h-[100px] max-h-[200px] resize-y focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                  />
                </div>
              </div>

              <Collapsible open={guidelinesOpen} onOpenChange={setGuidelinesOpen}>
                <CollapsibleTrigger className="w-full">
                  <Card className="border-2 hover:border-primary/30 transition-all duration-200 cursor-pointer">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary/10 to-pink-500/10 flex items-center justify-center">
                            <FileText className="w-5 h-5 text-primary" />
                          </div>
                          <span className="text-base font-semibold">Style Guidelines</span>
                        </div>
                        {guidelinesOpen ? (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <Textarea
                    id="style_guidelines"
                    value={styleGuidelines}
                    onChange={(e) => setStyleGuidelines(e.target.value)}
                    placeholder="Define writing style, formatting preferences, vocabulary choices..."
                    className="min-h-[120px] max-h-[300px] resize-y font-mono text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                  />
                </CollapsibleContent>
              </Collapsible>

              {/* Visual Identity Section - Redesigned */}
              <Collapsible open={visualIdentityOpen} onOpenChange={setVisualIdentityOpen}>
                <CollapsibleTrigger className="w-full">
                  <Card className="border-2 hover:border-cyan-500/30 transition-all duration-200 cursor-pointer">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-cyan-500/10 to-blue-500/10 flex items-center justify-center">
                            <Palette className="w-5 h-5 text-cyan-600" />
                          </div>
                          <div className="text-left">
                            <span className="text-base font-semibold block">Visual Identity</span>
                            <span className="text-xs text-muted-foreground">For Instagram carousels & generated visuals</span>
                          </div>
                        </div>
                        {visualIdentityOpen ? (
                          <ChevronDown className="w-5 h-5 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-5 h-5 text-muted-foreground" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-4">
                  <Card className="border-2 border-cyan-500/20 overflow-hidden">
                    <div className="h-1 bg-gradient-to-r from-cyan-500 to-blue-500" />
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
                                  onClick={() => setVisualTemplate(visualTemplate === template.value ? null : template.value)}
                                  className={cn(
                                    "relative flex flex-col items-center gap-2 p-3 rounded-lg border-2 transition-all",
                                    "hover:border-cyan-500/50 hover:bg-cyan-500/5",
                                    visualTemplate === template.value
                                      ? "border-cyan-500 bg-cyan-500/10"
                                      : "border-border"
                                  )}
                                >
                                  {visualTemplate === template.value && (
                                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                                      <Check className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                  <div className={cn(
                                    "w-8 h-8 rounded-lg flex items-center justify-center",
                                    visualTemplate === template.value ? "text-cyan-600" : "text-muted-foreground"
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
                              value={visualStyleDescription}
                              onChange={(e) => setVisualStyleDescription(e.target.value)}
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
                            {moodKeywords.length > 0 ? (
                              <div className="flex flex-wrap gap-1.5">
                                {moodKeywords.map(keyword => (
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
                                    JSON.stringify(colorPalette) === JSON.stringify(preset.colors)
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
                                value={colorPalette.primary}
                                onChange={(v) => updatePaletteColor('primary', v)}
                              />
                              <ColorPicker
                                label="Secondary"
                                value={colorPalette.secondary}
                                onChange={(v) => updatePaletteColor('secondary', v)}
                              />
                              <ColorPicker
                                label="Background"
                                value={colorPalette.background}
                                onChange={(v) => updatePaletteColor('background', v)}
                              />
                              <ColorPicker
                                label="Text"
                                value={colorPalette.text}
                                onChange={(v) => updatePaletteColor('text', v)}
                              />
                              <ColorPicker
                                label="Muted Text"
                                value={colorPalette.textMuted}
                                onChange={(v) => updatePaletteColor('textMuted', v)}
                              />
                            </div>
                          </div>

                          {/* Palette Preview Bar */}
                          <div className="space-y-2">
                            <Label className="text-sm font-medium">Palette Preview</Label>
                            <div className="flex gap-1 p-3 rounded-lg border bg-muted/30">
                              <div className="h-10 flex-1 rounded-l-md flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: colorPalette.primary }}>
                                Primary
                              </div>
                              <div className="h-10 flex-1 flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: colorPalette.secondary }}>
                                Secondary
                              </div>
                              <div className="h-10 flex-1 flex items-center justify-center text-xs font-medium border" style={{ backgroundColor: colorPalette.background, color: colorPalette.text }}>
                                BG
                              </div>
                              <div className="h-10 flex-1 flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: colorPalette.text }}>
                                Text
                              </div>
                              <div className="h-10 flex-1 rounded-r-md flex items-center justify-center text-white text-xs font-medium" style={{ backgroundColor: colorPalette.textMuted }}>
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
                                  onClick={() => setFontStyle(fontStyle === font.value ? null : font.value)}
                                  className={cn(
                                    "relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                                    "hover:border-cyan-500/50 hover:bg-cyan-500/5",
                                    fontStyle === font.value
                                      ? "border-cyan-500 bg-cyan-500/10"
                                      : "border-border"
                                  )}
                                >
                                  {fontStyle === font.value && (
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
                                  onClick={() => setAccentStyle(accentStyle === accent.value ? null : accent.value)}
                                  className={cn(
                                    "relative flex flex-col items-center gap-2 p-4 rounded-lg border-2 transition-all",
                                    "hover:border-cyan-500/50 hover:bg-cyan-500/5",
                                    accentStyle === accent.value
                                      ? "border-cyan-500 bg-cyan-500/10"
                                      : "border-border"
                                  )}
                                >
                                  {accentStyle === accent.value && (
                                    <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-cyan-500 flex items-center justify-center">
                                      <Check className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                  <div
                                    className={cn("w-12 h-6 rounded", accent.className)}
                                    style={{
                                      color: colorPalette.primary,
                                      borderColor: accent.value === 'outline' ? colorPalette.primary : undefined,
                                      background: accent.value === 'gradient'
                                        ? `linear-gradient(to right, ${colorPalette.primary}, ${colorPalette.secondary})`
                                        : accent.value === 'outline'
                                          ? 'transparent'
                                          : colorPalette.primary,
                                      boxShadow: accent.value === 'glow' ? `0 4px 14px ${colorPalette.primary}50` : undefined
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
                              style={{ backgroundColor: colorPalette.background }}
                            >
                              {/* Header */}
                              <div
                                className="p-4"
                                style={{
                                  background: accentStyle === 'gradient'
                                    ? `linear-gradient(to right, ${colorPalette.primary}, ${colorPalette.secondary})`
                                    : colorPalette.primary
                                }}
                              >
                                <h3 className="text-white font-bold text-lg">
                                  {name || 'Your Brand'}
                                </h3>
                              </div>

                              {/* Content */}
                              <div className="p-5 space-y-4">
                                <div>
                                  <h4
                                    className={cn(
                                      "text-xl font-bold mb-2",
                                      fontStyle === 'serif' && 'font-serif',
                                      fontStyle === 'display' && 'font-sans font-black tracking-tight',
                                      fontStyle === 'handwritten' && 'italic'
                                    )}
                                    style={{ color: colorPalette.text }}
                                  >
                                    Sample Headline
                                  </h4>
                                  <p
                                    className="text-sm leading-relaxed"
                                    style={{ color: colorPalette.textMuted }}
                                  >
                                    This is how your content will look with the selected visual identity settings.
                                  </p>
                                </div>

                                <div className="flex gap-2">
                                  <button
                                    className={cn(
                                      "px-4 py-2 rounded-lg text-sm font-semibold transition-all",
                                      accentStyle === 'outline' && "bg-transparent border-2",
                                      fontStyle === 'serif' && 'font-serif',
                                      fontStyle === 'display' && 'font-sans font-black tracking-tight',
                                      fontStyle === 'handwritten' && 'italic'
                                    )}
                                    style={{
                                      background: accentStyle === 'gradient'
                                        ? `linear-gradient(to right, ${colorPalette.primary}, ${colorPalette.secondary})`
                                        : accentStyle === 'outline'
                                          ? 'transparent'
                                          : colorPalette.primary,
                                      borderColor: accentStyle === 'outline' ? colorPalette.primary : undefined,
                                      color: accentStyle === 'outline' ? colorPalette.primary : 'white',
                                      boxShadow: accentStyle === 'glow' ? `0 4px 14px ${colorPalette.primary}50` : undefined
                                    }}
                                  >
                                    Primary Action
                                  </button>
                                  <button
                                    className={cn(
                                      "px-4 py-2 rounded-lg text-sm font-semibold border-2 bg-transparent",
                                      fontStyle === 'serif' && 'font-serif',
                                      fontStyle === 'display' && 'font-sans font-black tracking-tight',
                                      fontStyle === 'handwritten' && 'italic'
                                    )}
                                    style={{
                                      borderColor: colorPalette.secondary,
                                      color: colorPalette.secondary
                                    }}
                                  >
                                    Secondary
                                  </button>
                                </div>
                              </div>
                            </div>

                            {/* Summary */}
                            <div className="flex flex-wrap gap-2 pt-2">
                              {visualTemplate && (
                                <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-700">
                                  {TEMPLATE_PRESETS.find(t => t.value === visualTemplate)?.label}
                                </Badge>
                              )}
                              {fontStyle && (
                                <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-700">
                                  {FONT_STYLE_OPTIONS.find(f => f.value === fontStyle)?.label}
                                </Badge>
                              )}
                              {accentStyle && (
                                <Badge variant="outline" className="bg-cyan-500/10 border-cyan-500/30 text-cyan-700">
                                  {ACCENT_STYLE_OPTIONS.find(a => a.value === accentStyle)?.label} Accent
                                </Badge>
                              )}
                              {moodKeywords.map(kw => (
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

          {/* Footer */}
          <div className="shrink-0 px-6 py-4 border-t bg-background flex items-center justify-between">
            <span className="text-sm text-muted-foreground">
              {name.trim() ? "Ready to create" : "Fill in brand details"}
            </span>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={isCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreating || !name.trim()}
                variant="cta"
                className="min-w-[140px]"
              >
                {isCreating ? (
                  <>Creating...</>
                ) : (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Create Brand
                  </>
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
