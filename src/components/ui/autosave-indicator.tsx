import { Loader2, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface AutosaveIndicatorProps {
  isSaving: boolean;
  className?: string;
}

export function AutosaveIndicator({ isSaving, className }: AutosaveIndicatorProps) {
  return (
    <div className={cn("flex items-center gap-2 text-sm", className)}>
      {isSaving ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          <span className="text-muted-foreground">Saving...</span>
        </>
      ) : (
        <>
          <Check className="w-4 h-4 text-green-600" />
          <span className="text-green-600">Saved</span>
        </>
      )}
    </div>
  );
}
