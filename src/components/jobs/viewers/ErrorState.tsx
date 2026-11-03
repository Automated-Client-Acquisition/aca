import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  isRetrying?: boolean;
}

export function ErrorState({ 
  title = "Something went wrong",
  message, 
  onRetry,
  isRetrying = false 
}: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
        <AlertCircle className="h-6 w-6 text-destructive" />
      </div>
      <div className="space-y-1">
        <h4 className="font-medium text-foreground">{title}</h4>
        <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      </div>
      {onRetry && (
        <Button 
          variant="outline" 
          size="sm" 
          onClick={onRetry}
          disabled={isRetrying}
        >
          {isRetrying ? "Retrying..." : "Try Again"}
        </Button>
      )}
    </div>
  );
}
