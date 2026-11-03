import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Check, Palette, Type, Sparkles, LayoutGrid, Wand2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  CarouselStyleConfig,
  CarouselTemplate,
  CarouselColorPalette,
  AccentStyle,
  CAROUSEL_STYLE_PRESETS,
  DEFAULT_CAROUSEL_STYLE,
  buildCarouselStylePromptPrefix,
} from "@/types/carousel";

interface CarouselStyleEditorProps {
  value?: CarouselStyleConfig;
  onChange: (style: CarouselStyleConfig) => void;
  onConfirm?: () => void;
  isReadOnly?: boolean;
}

const TEMPLATE_OPTIONS: { value: CarouselTemplate; label: string; description: string }[] = [
  { value: 'minimal', label: 'Minimal', description: 'Clean, lots of whitespace' },
  { value: 'bold', label: 'Bold', description: 'High contrast, strong colors' },
  { value: 'elegant', label: 'Elegant', description: 'Sophisticated, muted tones' },
  { value: 'playful', label: 'Playful', description: 'Bright, fun, rounded elements' },
  { value: 'professional', label: 'Professional', description: 'Corporate, clean lines' },
  { value: 'custom', label: 'Custom', description: 'Define your own style' },
];

const ACCENT_STYLE_OPTIONS: { value: AccentStyle; label: string }[] = [
  { value: 'solid', label: 'Solid' },
  { value: 'gradient', label: 'Gradient' },
  { value: 'outline', label: 'Outline' },
  { value: 'glow', label: 'Glow' },
];

const FONT_STYLE_OPTIONS: { value: CarouselStyleConfig['fontStyle']; label: string }[] = [
  { value: 'sans-serif', label: 'Sans Serif' },
  { value: 'serif', label: 'Serif' },
  { value: 'display', label: 'Display' },
  { value: 'handwritten', label: 'Handwritten' },
];

export function CarouselStyleEditor({
  value = DEFAULT_CAROUSEL_STYLE,
  onChange,
  onConfirm,
  isReadOnly = false,
}: CarouselStyleEditorProps) {
  const [activeTab, setActiveTab] = useState<'presets' | 'custom'>('presets');

  const handleTemplateSelect = (template: CarouselTemplate) => {
    if (template === 'custom') {
      onChange({ ...value, template: 'custom' });
    } else {
      const preset = CAROUSEL_STYLE_PRESETS[template];
      onChange({
        ...value,
        template,
        palette: preset.palette || value.palette,
        accentStyle: preset.accentStyle || value.accentStyle,
        fontStyle: preset.fontStyle || value.fontStyle,
        visualStyle: preset.visualStyle || value.visualStyle,
        moodKeywords: preset.moodKeywords || value.moodKeywords,
      });
    }
  };

  const handleColorChange = (key: keyof CarouselColorPalette, color: string) => {
    onChange({
      ...value,
      palette: { ...value.palette, [key]: color },
      template: 'custom',
    });
  };

  const stylePrefix = buildCarouselStylePromptPrefix(value);

  return (
    <div className="space-y-6">
      {/* Template Selection */}
      <div className="space-y-3">
        <Label className="text-sm font-medium">Style Template</Label>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {TEMPLATE_OPTIONS.map((option) => {
            const isSelected = value.template === option.value;
            const preset = option.value !== 'custom' ? CAROUSEL_STYLE_PRESETS[option.value] : null;

            return (
              <Card
                key={option.value}
                className={cn(
                  "p-3 cursor-pointer transition-all hover:shadow-md",
                  isSelected && "ring-2 ring-primary shadow-md",
                  isReadOnly && "pointer-events-none opacity-60"
                )}
                onClick={() => !isReadOnly && handleTemplateSelect(option.value)}
              >
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-sm">{option.label}</span>
                    {isSelected && <Check className="h-4 w-4 text-primary" />}
                  </div>
                  <p className="text-xs text-muted-foreground">{option.description}</p>

                  {/* Color Preview */}
                  {preset?.palette && (
                    <div className="flex gap-1 mt-2">
                      <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: preset.palette.primary }}
                        title="Primary"
                      />
                      <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: preset.palette.secondary }}
                        title="Secondary"
                      />
                      <div
                        className="w-5 h-5 rounded-full border border-border"
                        style={{ backgroundColor: preset.palette.background }}
                        title="Background"
                      />
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Custom Colors Section */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'presets' | 'custom')}>
        <TabsList className="w-full">
          <TabsTrigger value="presets" className="flex-1">
            <Palette className="h-4 w-4 mr-2" />
            Quick Settings
          </TabsTrigger>
          <TabsTrigger value="custom" className="flex-1">
            <Wand2 className="h-4 w-4 mr-2" />
            Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="presets" className="space-y-4 mt-4">
          {/* Font Style */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Type className="h-4 w-4" />
              Font Style
            </Label>
            <Select
              value={value.fontStyle}
              onValueChange={(v) => !isReadOnly && onChange({ ...value, fontStyle: v as CarouselStyleConfig['fontStyle'] })}
              disabled={isReadOnly}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_STYLE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Accent Style */}
          <div className="space-y-2">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Sparkles className="h-4 w-4" />
              Accent Style
            </Label>
            <div className="flex gap-2 flex-wrap">
              {ACCENT_STYLE_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  variant={value.accentStyle === option.value ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => !isReadOnly && onChange({ ...value, accentStyle: option.value })}
                  disabled={isReadOnly}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="custom" className="space-y-4 mt-4">
          {/* Color Palette */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              <Palette className="h-4 w-4" />
              Color Palette
            </Label>
            <div className="grid grid-cols-2 gap-3">
              {(Object.keys(value.palette) as Array<keyof CarouselColorPalette>).map((colorKey) => (
                <div key={colorKey} className="space-y-1">
                  <Label className="text-xs text-muted-foreground capitalize">
                    {colorKey.replace(/([A-Z])/g, ' $1').trim()}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      type="color"
                      value={value.palette[colorKey]}
                      onChange={(e) => handleColorChange(colorKey, e.target.value)}
                      className="w-12 h-9 p-1 cursor-pointer"
                      disabled={isReadOnly}
                    />
                    <Input
                      type="text"
                      value={value.palette[colorKey]}
                      onChange={(e) => handleColorChange(colorKey, e.target.value)}
                      className="flex-1 font-mono text-sm"
                      placeholder="#000000"
                      disabled={isReadOnly}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Visual Style */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Visual Style Description</Label>
            <Textarea
              value={value.visualStyle || ''}
              onChange={(e) => !isReadOnly && onChange({ ...value, visualStyle: e.target.value })}
              placeholder="e.g., minimalist flat design, 3D rendered, watercolor style"
              className="min-h-[80px]"
              disabled={isReadOnly}
            />
            <p className="text-xs text-muted-foreground">
              Describe the visual aesthetic for AI image generation
            </p>
          </div>

          {/* Mood Keywords */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">Mood Keywords</Label>
            <Input
              value={value.moodKeywords?.join(', ') || ''}
              onChange={(e) => !isReadOnly && onChange({
                ...value,
                moodKeywords: e.target.value.split(',').map(k => k.trim()).filter(Boolean)
              })}
              placeholder="professional, trustworthy, modern"
              disabled={isReadOnly}
            />
            <p className="text-xs text-muted-foreground">
              Comma-separated keywords to guide the visual mood
            </p>
          </div>
        </TabsContent>
      </Tabs>

      {/* Style Preview */}
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-2">
          <LayoutGrid className="h-4 w-4" />
          Style Preview
        </Label>
        <Card className="overflow-hidden">
          <div
            className="h-32 flex items-center justify-center p-4 transition-colors"
            style={{ backgroundColor: value.palette.background }}
          >
            <div className="text-center space-y-2">
              <p
                className="text-xl font-bold"
                style={{ color: value.palette.text }}
              >
                Preview Headline
              </p>
              <p
                className="text-sm"
                style={{ color: value.palette.textMuted }}
              >
                This is how your carousel will look
              </p>
              <div
                className={cn(
                  "inline-block px-4 py-1.5 rounded-full text-sm font-medium",
                  value.accentStyle === 'outline' && "border-2",
                  value.accentStyle === 'glow' && "shadow-lg",
                )}
                style={{
                  backgroundColor: value.accentStyle !== 'outline' ? value.palette.primary : 'transparent',
                  color: value.accentStyle === 'outline' ? value.palette.primary : value.palette.background,
                  borderColor: value.palette.primary,
                  boxShadow: value.accentStyle === 'glow' ? `0 0 20px ${value.palette.primary}50` : undefined,
                  background: value.accentStyle === 'gradient'
                    ? `linear-gradient(135deg, ${value.palette.primary}, ${value.palette.secondary})`
                    : undefined,
                }}
              >
                Call to Action
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* AI Prompt Preview */}
      <div className="space-y-2">
        <Label className="text-xs text-muted-foreground">AI Style Prefix (auto-generated)</Label>
        <div className="p-3 bg-muted/50 rounded-lg">
          <p className="text-xs font-mono text-muted-foreground break-words">
            {stylePrefix}
          </p>
        </div>
      </div>

      {/* Confirm Button */}
      {onConfirm && !isReadOnly && (
        <Button onClick={onConfirm} className="w-full" size="lg">
          <Check className="h-4 w-4 mr-2" />
          Confirm Style & Continue
        </Button>
      )}
    </div>
  );
}
