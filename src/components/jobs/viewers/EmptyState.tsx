import { FileQuestion, LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface EmptyStateProps {
  title?: string;
  message: string;
  icon?: LucideIcon;
  actionLabel?: string;
  onAction?: () => void;
}

export function EmptyState({
  title = "No content yet",
  message,
  icon: Icon = FileQuestion,
  actionLabel,
  onAction
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center space-y-4">
      <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center">
        <Icon className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <h4 className="font-medium text-foreground">{title}</h4>
        <p className="text-sm text-muted-foreground max-w-md">{message}</p>
      </div>
      {actionLabel && onAction && (
        <Button variant="outline" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
