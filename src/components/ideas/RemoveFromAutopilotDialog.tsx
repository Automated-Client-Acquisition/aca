import { useEffect, useState } from "react";
import { ZapOff } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { useFeedOptions, useRemoveIdeasFromAutopilots } from "@/hooks/useIdeaFeeds";

interface RemoveFromAutopilotDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ideaIds: string[];
  /** Tick this autopilot first. */
  defaultAutopilotId?: string | null;
  onDone?: () => void;
}

/**
 * Stop autopilots from using ideas. The ideas and their tags stay, so other
 * autopilots and blueprints keep them; assigning an idea again undoes this.
 * Every autopilot is listed, since a removal on one that does not use the idea
 * yet is harmless and covers a selection whose ideas feed different autopilots.
 */
export function RemoveFromAutopilotDialog({ open, onOpenChange, ideaIds, defaultAutopilotId, onDone }: RemoveFromAutopilotDialogProps) {
  const { fuel, isLoading } = useFeedOptions();
  const remove = useRemoveIdeasFromAutopilots();
  const [picked, setPicked] = useState<string[]>([]);
  const n = ideaIds.length;

  useEffect(() => {
    if (open) setPicked(defaultAutopilotId ? [defaultAutopilotId] : []);
  }, [open, defaultAutopilotId]);

  const toggle = (id: string, on: boolean) => setPicked((p) => (on ? [...p, id] : p.filter((x) => x !== id)));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ZapOff className="h-5 w-5 text-muted-foreground" />
            Remove {n === 1 ? "this idea" : `${n} ideas`} from autopilots
          </DialogTitle>
          <DialogDescription>
            The autopilots you tick stop using {n === 1 ? "it" : "them"}, including any post already queued to be picked.
            {n === 1 ? " The idea keeps" : " The ideas keep"} their tags and stay available everywhere else.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? null : fuel.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            You have no autopilots.
          </div>
        ) : (
          <div className="max-h-[50vh] space-y-2 overflow-y-auto">
            {fuel.map((f) => (
              <Label
                key={f.autopilot_id}
                htmlFor={`rm-${f.autopilot_id}`}
                className="flex cursor-pointer items-center gap-3 rounded-lg border p-3 font-normal hover:bg-muted/40"
              >
                <Checkbox
                  id={`rm-${f.autopilot_id}`}
                  checked={picked.includes(f.autopilot_id)}
                  onCheckedChange={(v) => toggle(f.autopilot_id, v === true)}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{f.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {f.status !== "active" ? "Paused · " : ""}
                    {f.draws_from_all ? "Uses any idea" : `Uses ideas tagged ${f.feed_tags.join(", ")}`}
                  </div>
                </div>
              </Label>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            variant="destructive"
            disabled={picked.length === 0 || n === 0 || remove.isPending}
            onClick={() =>
              remove.mutate(
                { ideaIds, autopilotIds: picked },
                {
                  onSuccess: () => {
                    onOpenChange(false);
                    onDone?.();
                  },
                },
              )
            }
          >
            {remove.isPending ? "Removing…" : "Remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
