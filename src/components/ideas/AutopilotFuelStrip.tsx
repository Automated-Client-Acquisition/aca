import { Link, useSearchParams } from "react-router-dom";
import { Zap, ArrowRight, Plus, ListChecks, ChevronDown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  type FuelState,
  type AutopilotFuel,
  FUEL_DOT,
  feedTargets,
  fuelDetail,
  fuelHeadline,
  fuelState,
  needsIdeas,
} from "@/lib/idea-feeds";

const STATE_ORDER: FuelState[] = [
  "no_match",
  "review",
  "out",
  "missed",
  "repeating",
  "low",
  "ok",
  "paused",
];

interface AutopilotFuelStripProps {
  fuel: AutopilotFuel[];
  existingTagNames: string[];
  /** Unused ideas that don't feed any autopilot by tag: what "Pick ideas" offers. */
  unassignedCount: number;
  selectedAutopilotId: string | null;
  onSelect: (autopilotId: string | null) => void;
  onPickIdeas: (autopilotId: string) => void;
  onAddIdeas: (autopilotId: string) => void;
}

/**
 * A compact disclosure of active autopilot availability, with details and
 * actions on demand. Eligibility describes what can be used, not usage history.
 */
export function AutopilotFuelStrip({
  fuel,
  existingTagNames,
  unassignedCount,
  selectedAutopilotId,
  onSelect,
  onPickIdeas,
  onAddIdeas,
}: AutopilotFuelStripProps) {
  const [, setSearchParams] = useSearchParams();
  // Show this autopilot's ideas in the "Review guidelines" view.
  const reviewIdeas = (autopilotId: string) => {
    if (selectedAutopilotId !== autopilotId) onSelect(autopilotId);
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      params.set("view", "review");
      return params;
    });
  };
  const active = fuel
    .filter((f) => f.status === "active")
    .map((f) => ({ f, state: fuelState(f) }))
    .sort(
      (a, b) =>
        STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) ||
        a.f.name.localeCompare(b.f.name),
    );
  const pausedCount = fuel.length - active.length;
  if (active.length === 0) return null;

  const attention = active.filter(
    (a) => needsIdeas(a.state) || a.state === "missed",
  ).length;
  const selectedFeed = fuel.find((f) => f.autopilot_id === selectedAutopilotId);

  return (
    <details
      className="group mb-4 rounded-lg border bg-card"
      aria-label="Autopilot idea availability"
    >
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm [&::-webkit-details-marker]:hidden">
        <Zap className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="font-medium">Autopilot ideas</span>
        <span className="text-muted-foreground">{active.length} active</span>
        {attention > 0 ? (
          <span className="text-xs font-medium text-amber-700 dark:text-amber-300">
            {attention} need attention
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">
            Enough ideas available
          </span>
        )}
        {selectedFeed && (
          <span className="max-w-full truncate text-xs text-muted-foreground">
            Viewing: {selectedFeed.name}
          </span>
        )}
        <ChevronDown
          className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Autopilots choose from matching ideas. Open one to see what is
            available.
          </p>
          <Link
            to="/blueprints"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {pausedCount > 0 ? `${pausedCount} paused · ` : ""}Blueprints{" "}
            <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {active.map(({ f, state }) => {
            const selected = selectedAutopilotId === f.autopilot_id;
            const canPick =
              unassignedCount > 0 &&
              feedTargets(f, existingTagNames).length > 0;
            const filterable = !f.draws_from_all;
            return (
              <div
                key={f.autopilot_id}
                className={cn(
                  "flex flex-col rounded-xl border bg-card p-4 transition-colors",
                  selected && "border-foreground/40 ring-1 ring-foreground/10",
                  (state === "no_match" || state === "out") &&
                    !selected &&
                    "border-destructive/40",
                )}
              >
                <button
                  type="button"
                  className="flex-1 text-left disabled:cursor-default"
                  aria-label={`Available to ${f.name}${selected ? ", showing matching ideas" : ""}`}
                  onClick={() => onSelect(selected ? null : f.autopilot_id)}
                  disabled={!filterable}
                  aria-pressed={selected}
                  title={
                    filterable
                      ? selected
                        ? "Show all ideas"
                        : "Show ideas available to this autopilot"
                      : undefined
                  }
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        FUEL_DOT[state],
                      )}
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium">
                      {f.name}
                    </span>
                  </div>
                  <div className="mt-1.5 text-sm font-semibold">
                    {fuelHeadline(f, state)}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {fuelDetail(f, state)}
                  </p>
                </button>

                {needsIdeas(state) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {state === "review" && (
                      <Button
                        size="sm"
                        variant="cta"
                        className="h-8"
                        onClick={() => reviewIdeas(f.autopilot_id)}
                      >
                        <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                        Review {f.awaiting_review}
                      </Button>
                    )}
                    {canPick && state !== "review" && (
                      <Button
                        size="sm"
                        variant="cta"
                        className="h-8"
                        onClick={() => onPickIdeas(f.autopilot_id)}
                      >
                        <ListChecks className="mr-1.5 h-3.5 w-3.5" />
                        Pick from {unassignedCount} unused
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={() => onAddIdeas(f.autopilot_id)}
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      New ideas
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </details>
  );
}
