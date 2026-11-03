import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Image, LayoutGrid } from "lucide-react";
import { OutputConfig, AspectRatio } from "@/types/wizard";

interface OutputConfigPanelProps {
  config: OutputConfig;
  onChange: (config: OutputConfig) => void;
  pipeline?: string; // To show carousel-specific options
}

const ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; description: string; icon: string }[] = [
  { value: 'landscape', label: "Landscape", description: "16:9 - YouTube, LinkedIn", icon: "▭" },
  { value: 'portrait', label: "Portrait", description: "9:16 - TikTok, Reels", icon: "▯" },
  { value: 'square', label: "Square", description: "1:1 - Instagram", icon: "□" },
];

// Carousel-specific aspect ratio options (Instagram formats)
const CAROUSEL_ASPECT_RATIO_OPTIONS: { value: AspectRatio; label: string; description: string; icon: string }[] = [
  { value: 'square', label: "Square", description: "1:1 - Classic feed", icon: "□" },
  { value: 'portrait', label: "Portrait", description: "4:5 - Optimal feed", icon: "▯" },
];

export function OutputConfigPanel({ config, onChange, pipeline }: OutputConfigPanelProps) {
  const isCarousel = pipeline === 'instagram_carousel';
  const aspectOptions = isCarousel ? CAROUSEL_ASPECT_RATIO_OPTIONS : ASPECT_RATIO_OPTIONS;

  const handleAspectRatioChange = (aspectRatio: string) => {
    // Prevent unnecessary updates that could cause infinite loops
    if (aspectRatio === config.aspectRatio) {
      return;
    }
    onChange({
      ...config,
      aspectRatio: aspectRatio as AspectRatio,
    });
  };

  return (
    <Card className="border-cta/20">
      <CardHeader>
        <div className="flex items-center gap-2">
          {isCarousel ? (
            <LayoutGrid className="h-5 w-5 text-cta" />
          ) : (
            <Image className="h-5 w-5 text-cta" />
          )}
          <CardTitle>{isCarousel ? 'Carousel Format' : 'Output Format'}</CardTitle>
        </div>
        <CardDescription>
          {isCarousel
            ? 'Configure the aspect ratio, slides, and visual template'
            : 'Configure the aspect ratio for your generated images'
          }
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Aspect Ratio Selection */}
        <div className="space-y-3">
          <Label className="text-base font-medium flex items-center gap-2">
            Aspect Ratio
          </Label>
          <div className={`grid gap-2 ${isCarousel ? 'grid-cols-2' : 'grid-cols-3'}`}>
            {aspectOptions.map((option) => (
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
