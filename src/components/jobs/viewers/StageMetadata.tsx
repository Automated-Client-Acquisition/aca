import { Clock, AlertCircle, CheckCircle2, Info } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { formatDistanceToNow } from "date-fns";

interface StageMetadataProps {
  stageData: any;
  className?: string;
}

export function StageMetadata({ stageData, className }: StageMetadataProps) {
  const {
    generated_at,
    approved_at,
    approved_by,
    error,
    generation_time_ms,
    model_used,
    status
  } = stageData || {};

  return (
    <div className={className}>
      <div className="space-y-2">
        {/* Error Display */}
        {error && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              {error}
            </AlertDescription>
          </Alert>
        )}

        {/* Metadata Grid */}
        <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
          {/* Generation Time */}
          {generation_time_ms && (
            <Badge variant="outline" className="gap-1">
              <Clock className="h-3 w-3" />
              {generation_time_ms < 1000 
                ? `${generation_time_ms}ms`
                : `${(generation_time_ms / 1000).toFixed(1)}s`
              }
            </Badge>
          )}

          {/* Model Used */}
          {model_used && (
            <Badge variant="outline" className="gap-1">
              <Info className="h-3 w-3" />
              {model_used}
            </Badge>
          )}

          {/* Generated Time */}
          {generated_at && (
            <span className="text-xs text-muted-foreground">
              Generated {formatDistanceToNow(new Date(generated_at), { addSuffix: true })}
            </span>
          )}

          {/* Approval Info */}
          {approved_at && status === 'approved' && (
            <Badge variant="outline" className="gap-1 bg-green-500/10 text-green-500 border-green-500/20">
              <CheckCircle2 className="h-3 w-3" />
              Approved {formatDistanceToNow(new Date(approved_at), { addSuffix: true })}
            </Badge>
          )}
        </div>
      </div>
    </div>
  );
}
