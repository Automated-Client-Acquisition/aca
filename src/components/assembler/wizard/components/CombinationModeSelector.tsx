import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Layers, LayoutGrid, Check } from "lucide-react";

interface CombinationModeSelectorProps {
  mode: 'combine' | 'separate';
  onChange: (mode: 'combine' | 'separate') => void;
  elementCount: number;
  ideaCount: number;
  elementLabel?: string; // e.g., "characters", "products"
}

export function CombinationModeSelector({
  mode,
  onChange,
  elementCount,
  ideaCount,
  elementLabel = "items",
}: CombinationModeSelectorProps) {
  const combineOutputs = ideaCount;
  const separateOutputs = ideaCount * elementCount;

  return (
    <div className="space-y-3">
      <label className="text-sm font-medium text-muted-foreground">
        How should these {elementLabel} be used?
      </label>

      <div className="grid grid-cols-2 gap-3">
        {/* Combine Option */}
        <Card
          className={cn(
            "relative cursor-pointer p-4 transition-all hover:shadow-md",
            mode === 'combine'
              ? "border-2 border-primary ring-2 ring-primary/20 bg-primary/5"
              : "border hover:border-primary/50"
          )}
          onClick={() => onChange('combine')}
        >
          {/* Selected indicator */}
          {mode === 'combine' && (
            <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-0.5">
              <Check className="h-3 w-3" />
            </div>
          )}

          {/* Visual representation */}
          <div className="flex items-center justify-center mb-3">
            <div className="flex items-center gap-1 p-2 rounded-lg bg-muted/50">
              {/* Show elements merging into one */}
              <div className="flex -space-x-1">
                {Array.from({ length: Math.min(elementCount, 3) }).map((_, i) => (
                  <div
                    key={i}
                    className="w-6 h-6 rounded-full bg-primary/20 border-2 border-background flex items-center justify-center text-xs font-medium"
                  >
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
                {elementCount > 3 && (
                  <div className="w-6 h-6 rounded-full bg-muted border-2 border-background flex items-center justify-center text-xs">
                    +{elementCount - 3}
                  </div>
                )}
              </div>
              <span className="mx-2 text-muted-foreground">→</span>
              <Badge variant="secondary" className="font-mono">1</Badge>
            </div>
          </div>

          {/* Label */}
          <div className="text-center">
            <div className="font-medium flex items-center justify-center gap-1.5">
              <Layers className="h-4 w-4" />
              Combine
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              All {elementLabel} together in each output
            </p>
          </div>

          {/* Output count */}
          <div className="mt-3 pt-3 border-t text-center">
            <span className="text-xs text-muted-foreground">
              Creates{' '}
              <span className="font-semibold text-foreground">{combineOutputs}</span>{' '}
              output{combineOutputs !== 1 ? 's' : ''}
            </span>
          </div>
        </Card>

        {/* Separate Option */}
        <Card
          className={cn(
            "relative cursor-pointer p-4 transition-all hover:shadow-md",
            mode === 'separate'
              ? "border-2 border-primary ring-2 ring-primary/20 bg-primary/5"
              : "border hover:border-primary/50"
          )}
          onClick={() => onChange('separate')}
        >
          {/* Selected indicator */}
          {mode === 'separate' && (
            <div className="absolute top-2 right-2 bg-primary text-primary-foreground rounded-full p-0.5">
              <Check className="h-3 w-3" />
            </div>
          )}

          {/* Visual representation */}
          <div className="flex items-center justify-center mb-3">
            <div className="flex items-center gap-1 p-2 rounded-lg bg-muted/50">
              {/* Show elements as separate outputs */}
              <div className="flex gap-1">
                {Array.from({ length: Math.min(elementCount, 3) }).map((_, i) => (
                  <div
                    key={i}
                    className="w-6 h-6 rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center text-xs font-medium"
                  >
                    {String.fromCharCode(65 + i)}
                  </div>
                ))}
                {elementCount > 3 && (
                  <div className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs">
                    +{elementCount - 3}
                  </div>
                )}
              </div>
              <span className="mx-2 text-muted-foreground">→</span>
              <Badge variant="secondary" className="font-mono">{elementCount}</Badge>
            </div>
          </div>

          {/* Label */}
          <div className="text-center">
            <div className="font-medium flex items-center justify-center gap-1.5">
              <LayoutGrid className="h-4 w-4" />
              Separate
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              One output per {elementLabel.endsWith('s') ? elementLabel.slice(0, -1) : elementLabel}
            </p>
          </div>

          {/* Output count */}
          <div className="mt-3 pt-3 border-t text-center">
            <span className="text-xs text-muted-foreground">
              Creates{' '}
              <span className="font-semibold text-foreground">{separateOutputs}</span>{' '}
              output{separateOutputs !== 1 ? 's' : ''}
            </span>
            {elementCount > 1 && (
              <span className="text-xs text-muted-foreground block mt-0.5">
                ({ideaCount} × {elementCount})
              </span>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
