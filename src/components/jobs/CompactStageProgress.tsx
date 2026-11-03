import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StageConfig } from "@/types/pipelineStages";

interface CompactStageProgressProps {
  stages: StageConfig[];
  stageStatuses: Record<string, 'pending' | 'generating' | 'ready' | 'failed'>;
  currentStage?: string;
  className?: string;
}

export function CompactStageProgress({
  stages,
  stageStatuses,
  currentStage,
  className,
}: CompactStageProgressProps) {
  // Find current active stage for status text
  const activeStage = stages.find(s => {
    const status = stageStatuses[s.id];
    return status === 'generating';
  });

  const getStatusText = () => {
    if (!activeStage) {
      const allReady = stages.every(s => stageStatuses[s.id] === 'ready');
      if (allReady) return 'Complete';
      const hasFailed = stages.some(s => stageStatuses[s.id] === 'failed');
      if (hasFailed) return 'Failed';
      return '';
    }
    return `${activeStage.label}...`;
  };

  return (
    <div className={cn("flex items-center gap-3", className)}>
      {/* Minimal Stage Steps */}
      <div className="flex items-center gap-1">
        {stages.map((stage, index) => {
          const status = stageStatuses[stage.id] || 'pending';
          const isReady = status === 'ready';
          const isGenerating = status === 'generating';
          const isFailed = status === 'failed';

          return (
            <div key={stage.id} className="flex items-center">
              {/* Step indicator */}
              <div
                className={cn(
                  "relative flex items-center justify-center w-5 h-5 rounded-full transition-all",
                  isReady && "bg-green-500 text-white",
                  isGenerating && "bg-blue-500 text-white",
                  isFailed && "bg-destructive text-white",
                  !isReady && !isGenerating && !isFailed && "bg-muted text-muted-foreground"
                )}
                title={stage.label}
              >
                {isReady ? (
                  <Check className="h-3 w-3" />
                ) : isGenerating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="text-[10px] font-medium">{index + 1}</span>
                )}
              </div>

              {/* Connector line */}
              {index < stages.length - 1 && (
                <div className={cn(
                  "w-4 h-px mx-0.5",
                  isReady ? "bg-green-500" : "bg-border"
                )} />
              )}
            </div>
          );
        })}
      </div>

      {/* Status Text */}
      {getStatusText() && (
        <span className="text-[11px] text-muted-foreground">
          {getStatusText()}
        </span>
      )}
    </div>
  );
}
