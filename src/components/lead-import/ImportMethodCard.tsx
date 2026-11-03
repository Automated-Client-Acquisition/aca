import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ImportSource } from "@/config/importSources";

interface ImportMethodCardProps {
  source: ImportSource;
  isSelected: boolean;
  isDisabled: boolean;
  onClick: () => void;
}

export function ImportMethodCard({
  source,
  isSelected,
  isDisabled,
  onClick,
}: ImportMethodCardProps) {
  const Icon = source.icon;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors",
        "hover:bg-accent/50",
        isSelected && "bg-accent text-accent-foreground",
        !isSelected && "text-muted-foreground hover:text-foreground",
        isDisabled && "opacity-50 cursor-not-allowed hover:bg-transparent"
      )}
    >
      <div
        className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          source.requiresLinkedIn
            ? "bg-blue-100 text-blue-700"
            : "bg-green-100 text-green-600",
          isDisabled && "bg-muted text-muted-foreground"
        )}
      >
        <Icon className="h-4 w-4" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm truncate">{source.title}</span>
          {source.comingSoon && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              Soon
            </Badge>
          )}
          {source.requiresPremium && !source.comingSoon && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Premium
            </Badge>
          )}
        </div>
      </div>
    </button>
  );
}
