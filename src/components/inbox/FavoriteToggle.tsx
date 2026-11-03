import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToggleFavorite, useFavoriteConversationIds } from "@/hooks/crm/useConversationPreferences";

interface FavoriteToggleProps {
  conversationId: string;
  className?: string;
  size?: "sm" | "default";
}

export function FavoriteToggle({
  conversationId,
  className,
  size = "default",
}: FavoriteToggleProps) {
  const { data: favoriteIds } = useFavoriteConversationIds();
  const toggleFavorite = useToggleFavorite();

  const isFavorite = favoriteIds?.has(conversationId) ?? false;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite.mutate({ conversationId, isFavorite: !isFavorite });
  };

  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";
  const buttonSize = size === "sm" ? "h-6 w-6" : "h-8 w-8";

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={cn(buttonSize, className)}
          onClick={handleToggle}
          disabled={toggleFavorite.isPending}
        >
          <Star
            className={cn(
              iconSize,
              "transition-colors",
              isFavorite
                ? "fill-yellow-400 text-yellow-400"
                : "text-muted-foreground hover:text-yellow-400"
            )}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        {isFavorite ? "Remove from favorites" : "Add to favorites"}
      </TooltipContent>
    </Tooltip>
  );
}

// Simplified star icon for use in conversation list (no button wrapper)
interface FavoriteIndicatorProps {
  conversationId: string;
  className?: string;
}

export function FavoriteIndicator({
  conversationId,
  className,
}: FavoriteIndicatorProps) {
  const { data: favoriteIds } = useFavoriteConversationIds();
  const toggleFavorite = useToggleFavorite();

  const isFavorite = favoriteIds?.has(conversationId) ?? false;

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    toggleFavorite.mutate({ conversationId, isFavorite: !isFavorite });
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleToggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handleToggle(e as unknown as React.MouseEvent);
        }
      }}
      className={cn(
        "p-0.5 rounded transition-colors cursor-pointer",
        isFavorite
          ? "text-yellow-400"
          : "text-muted-foreground/30 hover:text-yellow-400/70",
        toggleFavorite.isPending && "pointer-events-none opacity-50",
        className
      )}
      aria-disabled={toggleFavorite.isPending}
    >
      <Star
        className={cn(
          "h-3.5 w-3.5",
          isFavorite && "fill-current"
        )}
      />
    </div>
  );
}
