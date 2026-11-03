import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Film, Clock } from "lucide-react";
import { useState } from "react";
import { VideoConfig } from "@/types/wizard";

interface VideoConfigPanelProps {
  config: VideoConfig;
  onChange: (config: VideoConfig) => void;
  isLongform?: boolean;
}

const DURATION_PRESETS = [
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 90, label: "1.5 minutes" },
  { value: 120, label: "2 minutes" },
  { value: 180, label: "3 minutes" },
];

const LONGFORM_DURATION_PRESETS = [
  { value: 30, label: "30s" },
  { value: 60, label: "1 min" },
  { value: 120, label: "2 min" },
  { value: 180, label: "3 min" },
  { value: 300, label: "5 min" },
  { value: 420, label: "7 min" },
  { value: 600, label: "10 min" },
];

const ASPECT_RATIO_OPTIONS = [
  { value: 'landscape' as const, label: "Landscape", description: "16:9 - YouTube, Shorts", icon: "▭" },
  { value: 'portrait' as const, label: "Portrait", description: "9:16 - TikTok, Reels", icon: "▯" },
  { value: 'square' as const, label: "Square", description: "1:1 - Instagram", icon: "□" },
];

export function VideoConfigPanel({ config, onChange, isLongform = false }: VideoConfigPanelProps) {
  const [customDuration, setCustomDuration] = useState<string>("");
  const [isCustom, setIsCustom] = useState(false);

  const durationPresets = isLongform ? LONGFORM_DURATION_PRESETS : DURATION_PRESETS;

  const handleDurationChange = (duration: number) => {
    // Prevent unnecessary updates
    if (duration === config.totalDuration) {
      return;
    }
    setIsCustom(false);
    setCustomDuration("");
    onChange({
      ...config,
      totalDuration: duration,
    });
  };

  const handleCustomDurationChange = (value: string) => {
    setCustomDuration(value);
    const duration = parseInt(value);
    if (!isNaN(duration) && duration > 0) {
      onChange({
        ...config,
        totalDuration: duration,
      });
    }
  };

  const handleAspectRatioChange = (aspectRatio: string) => {
    // Prevent infinite loops - only update if the value actually changed
    if (aspectRatio === config.aspectRatio) {
      return;
    }
    const newConfig = {
      ...config,
      aspectRatio: aspectRatio as 'landscape' | 'portrait' | 'square',
    };
    onChange(newConfig);
  };

  return (
    <Card className="border-cta/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Film className="h-5 w-5 text-cta" />
          <CardTitle>Video Configuration</CardTitle>
        </div>
        <CardDescription>
          Set the target duration and aspect ratio for your video
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Total Duration */}
        <div className="space-y-3">
          <Label className="text-base font-medium flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Total Duration
          </Label>
          <div className={`grid gap-2 ${isLongform ? 'grid-cols-5' : 'grid-cols-3'}`}>
            {durationPresets.map((preset) => (
              <button
                key={preset.value}
                onClick={() => handleDurationChange(preset.value)}
                className={`px-4 py-2 rounded-md border text-sm font-medium transition-all ${
                  config.totalDuration === preset.value && !isCustom
                    ? "bg-cta text-cta-foreground border-cta"
                    : "bg-background hover:bg-accent border-border"
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              type="number"
              placeholder="Custom duration (seconds)"
              value={customDuration}
              onChange={(e) => {
                setIsCustom(true);
                handleCustomDurationChange(e.target.value);
              }}
              min={1}
              className="flex-1"
            />
            {isCustom && customDuration && (
              <Badge variant="secondary" className="self-center">
                Custom
              </Badge>
            )}
          </div>
        </div>

        {/* Aspect Ratio */}
        <div className="space-y-3">
          <Label className="text-base font-medium flex items-center gap-2">
            <Film className="h-4 w-4" />
            Aspect Ratio
          </Label>
          <div className="grid grid-cols-3 gap-2">
            {ASPECT_RATIO_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => handleAspectRatioChange(option.value)}
                className={`flex flex-col items-center cursor-pointer rounded-md border px-4 py-3 text-sm font-medium transition-all ${
                  config.aspectRatio === option.value
                    ? "bg-cta text-cta-foreground border-cta"
                    : "bg-background hover:bg-accent border-border"
                }`}
              >
                <div className="text-2xl mb-1">{option.icon}</div>
                <div className="font-medium">{option.label}</div>
                <div className="text-xs opacity-80 text-center mt-1">{option.description}</div>
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
