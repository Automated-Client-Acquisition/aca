import { Check, Circle, AlertCircle, Loader2, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { StageConfig } from "@/types/pipelineStages";

interface StageProgressIndicatorProps {
  stages: StageConfig[];
  stageStatuses: Record<string, 'pending' | 'processing' | 'approved' | 'rejected' | 'awaiting_approval'>;
  currentStage?: string;
  onStageClick?: (stageId: string) => void;
}

export function StageProgressIndicator({
  stages,
  stageStatuses,
  currentStage,
  onStageClick,
}: StageProgressIndicatorProps) {
  const currentStageIndex = stages.findIndex(s => s.id === currentStage);

  const getStageIcon = (stageId: string) => {
    const status = stageStatuses[stageId] || 'pending';
    
    switch (status) {
      case 'approved':
        return <Check className="h-4 w-4" />;
      case 'rejected':
        return <AlertCircle className="h-4 w-4" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin" />;
      case 'awaiting_approval':
        return <Clock className="h-4 w-4" />;
      default:
        return <Circle className="h-4 w-4" />;
    }
  };

  const getStageColor = (stageId: string) => {
    const status = stageStatuses[stageId] || 'pending';
    
    switch (status) {
      case 'approved':
        return 'bg-green-500 text-white border-green-500';
      case 'rejected':
        return 'bg-destructive text-destructive-foreground border-destructive';
      case 'processing':
        return 'bg-primary text-primary-foreground border-primary';
      case 'awaiting_approval':
        return 'bg-amber-500 text-white border-amber-500';
      default:
        return 'bg-muted text-muted-foreground border-border';
    }
  };

  const getConnectorColor = (index: number) => {
    if (index >= stages.length - 1) return '';
    
    const currentStatus = stageStatuses[stages[index].id] || 'pending';
    return currentStatus === 'approved' ? 'bg-green-500' : 'bg-border';
  };

  return (
    <div className="relative bg-gradient-to-r from-muted/30 via-muted/20 to-muted/30 rounded-lg p-6 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 left-1/4 w-32 h-32 bg-primary/20 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-32 h-32 bg-secondary/20 rounded-full blur-3xl" />
      </div>

      <div className="relative flex items-center justify-between">
        {stages.map((stage, index) => {
          const status = stageStatuses[stage.id] || 'pending';
          const isCurrent = currentStage === stage.id;
          const isCompleted = status === 'approved';

          return (
            <div key={stage.id} className="flex items-center flex-1">
              {/* Stage Node */}
              <button
                onClick={() => onStageClick?.(stage.id)}
                className={cn(
                  "relative group flex flex-col items-center gap-2 transition-all duration-300",
                  "hover:scale-110 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-inset rounded-lg p-2",
                  isCurrent && "scale-110"
                )}
              >
                {/* Icon Circle */}
                <div
                  className={cn(
                    "relative flex items-center justify-center w-12 h-12 rounded-full border-2 transition-all duration-300",
                    "shadow-lg",
                    isCompleted && "bg-green-500 border-green-500 text-white shadow-green-500/50",
                    status === 'processing' && "bg-primary border-primary text-primary-foreground animate-glow-pulse shadow-primary/50",
                    status === 'awaiting_approval' && "bg-amber-500 border-amber-500 text-white shadow-amber-500/50",
                    status === 'rejected' && "bg-destructive border-destructive text-destructive-foreground shadow-destructive/50",
                    status === 'pending' && "bg-muted border-border text-muted-foreground",
                    isCurrent && !isCompleted && "ring-4 ring-primary/20"
                  )}
                >
                  {getStageIcon(stage.id)}
                  
                  {/* Pulse ring for processing */}
                  {status === 'processing' && (
                    <div className="absolute inset-0 rounded-full border-2 border-primary animate-ping" />
                  )}
                  
                  {/* Subtle pulse for awaiting approval */}
                  {status === 'awaiting_approval' && (
                    <div className="absolute inset-0 rounded-full border-2 border-amber-500 animate-pulse" />
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    "text-xs font-medium whitespace-nowrap transition-colors max-w-[80px] text-center",
                    isCurrent ? "text-foreground" : "text-muted-foreground",
                    "group-hover:text-foreground"
                  )}
                >
                  {stage.label}
                </span>
              </button>

              {/* Connector Line */}
              {index < stages.length - 1 && (
                <div className="flex-1 mx-2 relative h-0.5">
                  <div
                    className={cn(
                      "absolute inset-0 transition-all duration-500",
                      getConnectorColor(index) === 'bg-green-500' 
                        ? "bg-green-500 shadow-lg shadow-green-500/50" 
                        : "bg-border"
                    )}
                  />
                  {/* Animated progress for current connector */}
                  {index === currentStageIndex - 1 && status === 'processing' && (
                    <div className="absolute inset-0 bg-gradient-to-r from-primary/50 to-transparent animate-shimmer" 
                         style={{ backgroundSize: '200% 100%' }} />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
