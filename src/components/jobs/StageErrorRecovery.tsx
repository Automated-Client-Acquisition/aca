import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useRegenerateStage } from "@/hooks/useRegenerateStage";

interface StageErrorRecoveryProps {
  outputId: string;
  stageId: string;
  stageName: string;
  errorMessage: string;
  errorStack?: string;
  retryCount?: number;
  maxRetries?: number;
}

export function StageErrorRecovery({
  outputId,
  stageId,
  stageName,
  errorMessage,
  errorStack,
  retryCount = 0,
  maxRetries = 3,
}: StageErrorRecoveryProps) {
  const [showDetails, setShowDetails] = useState(false);
  const regenerateStage = useRegenerateStage();

  const handleRetry = () => {
    regenerateStage.mutate({
      outputId,
      stageId,
      preserveDownstream: true,
    });
  };

  const canRetry = retryCount < maxRetries;

  return (
    <Alert variant="destructive" className="mt-4">
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle className="flex items-center justify-between">
        <span>Stage Failed: {stageName}</span>
        {canRetry && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleRetry}
            disabled={regenerateStage.isPending}
            className="ml-auto"
          >
            {regenerateStage.isPending ? (
              <>
                <RefreshCw className="mr-2 h-3 w-3 animate-spin" />
                Retrying...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-3 w-3" />
                Retry ({retryCount}/{maxRetries})
              </>
            )}
          </Button>
        )}
      </AlertTitle>
      <AlertDescription className="mt-2">
        <p className="mb-2">{errorMessage}</p>

        {!canRetry && (
          <p className="text-xs text-muted-foreground mb-2">
            Maximum retry attempts reached. Please check the error details or regenerate with different settings.
          </p>
        )}

        {errorStack && (
          <Collapsible open={showDetails} onOpenChange={setShowDetails}>
            <CollapsibleTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs hover:bg-transparent"
              >
                {showDetails ? (
                  <>
                    <ChevronUp className="mr-1 h-3 w-3" />
                    Hide error details
                  </>
                ) : (
                  <>
                    <ChevronDown className="mr-1 h-3 w-3" />
                    Show error details
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2">
              <pre className="text-xs bg-background/50 p-2 rounded overflow-x-auto">
                {errorStack}
              </pre>
            </CollapsibleContent>
          </Collapsible>
        )}
      </AlertDescription>
    </Alert>
  );
}
