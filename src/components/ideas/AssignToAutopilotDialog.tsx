import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useAssignIdeasToAutopilot, useFeedOptions } from "@/hooks/useIdeaFeeds";
import { formatRunway, fuelState } from "@/lib/idea-feeds";

interface AssignToAutopilotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaIds: string[];
  /** Preselect this autopilot's first feed. */
  autopilotId?: string | null;
  onDone?: () => void;
}

/** Point ideas at an autopilot: they get the tag it draws from and join its pool. */
export function AssignToAutopilotDialog({ open, onOpenChange, ideaIds, autopilotId, onDone }: AssignToAutopilotDialogProps) {
  const { options, anyIdea, isLoading } = useFeedOptions();
  const assign = useAssignIdeasToAutopilot();
  const [key, setKey] = useState<string>("");

  // Preselect on open (and once options load); a background refetch must not undo the user's pick.
  const hasOptions = options.length > 0;
  useEffect(() => {
    if (!open) return;
    const preferred = autopilotId ? options.find((o) => o.target.autopilotId === autopilotId) : undefined;
    setKey((preferred ?? options[0])?.target.key ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autopilotId, hasOptions]);

  const chosen = options.find((o) => o.target.key === key);
  const n = ideaIds.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-muted-foreground" />
            Use {n === 1 ? "this idea" : `${n} ideas`} in an autopilot
          </DialogTitle>
          <DialogDescription>
            The autopilot picks {n === 1 ? "it" : "them"} up on its next runs, new ideas before ones it has already posted.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? null : options.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            {anyIdea.length > 0
              ? `${anyIdea.map((f) => f.name).join(", ")} already ${anyIdea.length === 1 ? "uses" : "use"} any idea, so there's nothing to assign.`
              : "You have no autopilots that pick ideas by tag yet."}
            <div className="mt-3">
              <Link to="/blueprints" className="text-foreground underline underline-offset-4">Automate a blueprint</Link>
            </div>
          </div>
        ) : (
          <RadioGroup value={key} onValueChange={setKey} className="max-h-[50vh] gap-2 overflow-y-auto">
            {options.map((o) => {
              const state = fuelState(o.fuel);
              const runway = formatRunway(o.fuel.runway_days);
              return (
                <Label
                  key={o.target.key}
                  htmlFor={o.target.key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-lg border p-3 font-normal transition-colors hover:bg-muted/40",
                    key === o.target.key && "border-foreground/40 bg-muted/60",
                  )}
                >
                  <RadioGroupItem id={o.target.key} value={o.target.key} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{o.label}</div>
                    <div className="text-xs text-muted-foreground">
                      {state === "paused"
                        ? "Paused"
                        : o.fuel.fresh_ideas === 0
                          ? state === "review" ? "Waiting on idea approval" : "No new ideas left"
                          : `${o.fuel.fresh_ideas} new idea${o.fuel.fresh_ideas === 1 ? "" : "s"}${runway ? `, about ${runway}` : ""}`}
                      {" · tag "}
                      <span className="font-mono">{o.target.tagName}</span>
                    </div>
                  </div>
                </Label>
              );
            })}
            {anyIdea.length > 0 && (
              <p className="px-1 pt-1 text-xs text-muted-foreground">
                {anyIdea.map((f) => f.name).join(", ")} {anyIdea.length === 1 ? "uses" : "use"} any idea already.
              </p>
            )}
          </RadioGroup>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="cta"
            disabled={!chosen || n === 0 || assign.isPending}
            onClick={() =>
              chosen &&
              assign.mutate(
                { ideaIds, target: chosen.target },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    onDone?.();
                  },
                },
              )
            }
          >
            {assign.isPending ? "Assigning…" : chosen ? `Use in ${chosen.fuel.name}` : "Assign"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
