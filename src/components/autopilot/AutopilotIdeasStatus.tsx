import { Link } from "react-router-dom";
import { Lightbulb, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAutopilotFuel } from "@/hooks/useIdeaFeeds";
import { FUEL_DOT, fuelAction, fuelDetail, fuelHeadline, fuelState, needsIdeas } from "@/lib/idea-feeds";

/**
 * How many new ideas an autopilot has left, with a way to give it more. Same
 * wording as the cards on the Ideas page.
 */
export function AutopilotIdeasStatus({ autopilotId, className }: { autopilotId: string; className?: string }) {
  const { data: fuel } = useAutopilotFuel();
  const f = fuel?.find((x) => x.autopilot_id === autopilotId);
  if (!f) return null;

  const state = fuelState(f, { ignorePause: true });
  const hungry = needsIdeas(state);
  const action = fuelAction(f.autopilot_id, state);
  const href = hungry ? action.href : f.draws_from_all ? "/ideas" : `/ideas?feed=${f.autopilot_id}`;

  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        hungry ? "border-amber-500/40 bg-amber-500/5" : "border-border/50 bg-muted/40",
        className,
      )}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between gap-2 text-xs">
        <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
          <Lightbulb className="h-3.5 w-3.5" />
          Ideas
        </div>
        <Link to={href} className="flex items-center gap-1 font-medium text-foreground hover:underline">
          {hungry ? action.cta : "See its ideas"}
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="mt-1.5 flex items-center gap-2 text-sm font-semibold">
        <span className={cn("h-2 w-2 shrink-0 rounded-full", FUEL_DOT[state])} aria-hidden />
        {fuelHeadline(f, state)}
      </div>
      <p className="mt-0.5 text-xs text-muted-foreground">{fuelDetail(f, state)}</p>
    </div>
  );
}
