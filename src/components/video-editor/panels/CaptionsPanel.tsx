import { useVideoEditor } from "../context/VideoEditorContext";
import { cn } from "@/lib/utils";
import { Captions, AlertCircle } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import type { CaptionStyleId, CaptionPosition } from "@/types/videoEditor";
import { CAPTION_PRESETS } from "@/types/videoEditor";

const STYLE_OPTIONS: {
  id: CaptionStyleId;
  label: string;
  description: string;
  preview: string;
}[] = [
  {
    id: "hormozi",
    label: "Hormozi",
    description: "Big bold, center, yellow highlight",
    preview: "SCALE IN",
  },
  {
    id: "tiktok_bounce",
    label: "TikTok Bounce",
    description: "Bouncing words, bottom third",
    preview: "bounce",
  },
  {
    id: "karaoke",
    label: "Karaoke",
    description: "Color fill progression",
    preview: "fill →",
  },
  {
    id: "bold_punch",
    label: "Bold Punch",
    description: "Large uppercase, scale-in",
    preview: "PUNCH",
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "Clean white, no animation",
    preview: "clean",
  },
  {
    id: "boxed",
    label: "Boxed",
    description: "Active word in colored box",
    preview: "[boxed]",
  },
  {
    id: "none",
    label: "None",
    description: "No captions",
    preview: "—",
  },
];

export function CaptionsPanel() {
  const { state, updateSettings } = useVideoEditor();
  const currentStyle = state.project.settings.caption_style;
  const hasVoiceover = !!state.project.voiceover?.word_timestamps?.length;
  const currentPreset = currentStyle !== "none"
    ? CAPTION_PRESETS[currentStyle as Exclude<CaptionStyleId, "none">]
    : null;
  const effectivePosition = state.project.settings.caption_position || currentPreset?.position || "bottom";
  const effectiveFontSize = state.project.settings.caption_font_size || currentPreset?.fontSize || 56;

  return (
    <div className="flex flex-col h-full overflow-y-auto">
      <div className="px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">Caption Style</span>
      </div>

      <div className="p-3 space-y-3">
        {!hasVoiceover && currentStyle !== "none" && (
          <div className="flex items-start gap-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20">
            <AlertCircle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" />
            <p className="text-[10px] text-amber-400">
              Generate a voiceover first to enable animated captions. Captions
              need word-level timestamps from AI TTS.
            </p>
          </div>
        )}

        <div className="grid grid-cols-2 gap-2">
          {STYLE_OPTIONS.map((option) => {
            const preset =
              option.id !== "none"
                ? CAPTION_PRESETS[option.id as Exclude<CaptionStyleId, "none">]
                : null;

            return (
              <button
                key={option.id}
                onClick={() => updateSettings({ caption_style: option.id })}
                className={cn(
                  "relative rounded-lg border p-3 text-left transition-all hover:border-primary/50",
                  currentStyle === option.id
                    ? "border-primary bg-primary/5 ring-1 ring-primary"
                    : "border-border"
                )}
              >
                {/* Mini preview */}
                <div
                  className="rounded bg-black/80 h-12 flex items-center justify-center mb-2 overflow-hidden"
                  style={{
                    fontFamily: preset?.fontFamily || "Arial, sans-serif",
                  }}
                >
                  {preset ? (
                    <span
                      style={{
                        fontSize: 14,
                        fontWeight: preset.fontWeight,
                        color: preset.activeColor,
                        textShadow: preset.textShadow,
                        textTransform: preset.uppercase
                          ? "uppercase"
                          : "none",
                      }}
                    >
                      {option.preview}
                    </span>
                  ) : (
                    <Captions className="h-4 w-4 text-muted-foreground/30" />
                  )}
                </div>

                <div className="text-xs font-medium">{option.label}</div>
                <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">
                  {option.description}
                </div>
              </button>
            );
          })}
        </div>

        {/* Position & size overrides */}
        {currentStyle !== "none" && (
          <div className="space-y-3">
            <div>
              <span className="text-[10px] font-medium text-muted-foreground">Position</span>
              <Select
                value={effectivePosition}
                onValueChange={(val: CaptionPosition) =>
                  updateSettings({ caption_position: val })
                }
              >
                <SelectTrigger className="h-7 text-xs mt-0.5">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="top">Top</SelectItem>
                  <SelectItem value="center">Center</SelectItem>
                  <SelectItem value="bottom">Bottom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <span className="text-[10px] font-medium text-muted-foreground">Font Size</span>
              <div className="flex items-center gap-2 mt-0.5">
                <Slider
                  value={[effectiveFontSize]}
                  min={24}
                  max={120}
                  step={2}
                  onValueChange={([val]) =>
                    updateSettings({ caption_font_size: val })
                  }
                  className="flex-1"
                />
                <span className="text-xs text-muted-foreground min-w-[32px] text-right">
                  {effectiveFontSize}px
                </span>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
