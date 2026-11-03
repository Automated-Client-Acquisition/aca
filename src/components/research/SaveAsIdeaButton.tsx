import { Link } from "react-router-dom";
import { Check, ChevronDown, Lightbulb, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { useFeedOptions } from "@/hooks/useIdeaFeeds";
import type { FeedTarget } from "@/lib/idea-feeds";

interface SaveAsIdeaButtonProps {
  onSave: (target?: FeedTarget) => void;
  saving?: boolean;
  /** Already an idea: show that instead of the button. */
  saved?: boolean;
  label?: string;
  size?: "sm" | "default";
  className?: string;
}

/**
 * The one action on anything found in Research: keep it as an idea, or send it
 * straight to an autopilot. Split button so the common case stays one click.
 */
export function SaveAsIdeaButton({ onSave, saving, saved, label = "Save as idea", size = "sm", className }: SaveAsIdeaButtonProps) {
  const { options } = useFeedOptions();
  const active = options.filter((o) => o.fuel.status === "active");

  if (saved) {
    return (
      <Button asChild variant="outline" size={size} className={cn("gap-1.5", className)}>
        <Link to="/ideas">
          <Check className="h-3.5 w-3.5 text-emerald-600" />
          In your ideas
        </Link>
      </Button>
    );
  }

  const main = (
    <Button
      variant="cta"
      size={size}
      className={cn("gap-1.5", active.length > 0 && "rounded-r-none", className)}
      disabled={saving}
      onClick={() => onSave()}
    >
      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lightbulb className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );

  if (active.length === 0) return main;

  return (
    <div className="flex">
      {main}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="cta"
            size={size}
            className={cn("rounded-l-none border-l border-black/10 px-2", className)}
            disabled={saving}
            aria-label="Save for an autopilot"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">Save and let an autopilot post it</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {active.map((o) => (
            <DropdownMenuItem key={o.target.key} onClick={() => onSave(o.target)}>
              <Zap className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">{o.label}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
