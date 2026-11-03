import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { PIPELINES, MODEL_TYPE_LABELS, type PipelineId } from "@/types/pipeline";
import { cn } from "@/lib/utils";

interface PipelineSelectorProps {
  value: PipelineId;
  onChange: (value: PipelineId) => void;
}

export function PipelineSelector({ value, onChange }: PipelineSelectorProps) {
  return (
    <div className="space-y-3">
      <Label>Content Pipeline</Label>
      <RadioGroup value={value} onValueChange={onChange} className="grid gap-3">
        {PIPELINES.filter(p => !p.hidden).map((pipeline) => {
          const Icon = pipeline.icon;
          const isSelected = value === pipeline.id;
          const isComingSoon = pipeline.status === 'coming_soon';

          return (
            <label
              key={pipeline.id}
              className={cn(
                "flex items-start gap-3 p-4 rounded-lg border transition-all",
                isComingSoon
                  ? "opacity-50 cursor-not-allowed"
                  : "cursor-pointer hover:border-primary/50 hover:bg-accent/50",
                isSelected && !isComingSoon && "border-primary bg-accent"
              )}
              onClick={isComingSoon ? (e) => e.preventDefault() : undefined}
            >
              <RadioGroupItem
                value={pipeline.id}
                id={pipeline.id}
                className="mt-1"
                disabled={isComingSoon}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  <span className="font-medium text-sm">{pipeline.name}</span>
                  {isComingSoon && (
                    <Badge variant="secondary" className="text-xs">
                      Coming Soon
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mb-2">
                  {pipeline.description}
                </p>
                <div className="flex flex-wrap gap-1">
                  {pipeline.requiredModels.map((modelType) => (
                    <Badge key={modelType} variant="secondary" className="text-xs">
                      {MODEL_TYPE_LABELS[modelType]}
                    </Badge>
                  ))}
                  {pipeline.optionalModels?.map((modelType) => (
                    <Badge key={modelType} variant="outline" className="text-xs">
                      {MODEL_TYPE_LABELS[modelType]} (optional)
                    </Badge>
                  ))}
                </div>
              </div>
            </label>
          );
        })}
      </RadioGroup>
    </div>
  );
}
