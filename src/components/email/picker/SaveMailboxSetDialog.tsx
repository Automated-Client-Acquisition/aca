import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  useCreateMailboxSet,
  useMailboxSets,
  useUpdateMailboxSet,
  type MailboxSet,
} from "@/hooks/useMailboxSets";

interface SaveMailboxSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mailboxIds: string[];
  existingSetId: string | null;
  onSaved?: (set: MailboxSet) => void;
}

export function SaveMailboxSetDialog({
  open,
  onOpenChange,
  mailboxIds,
  existingSetId,
  onSaved,
}: SaveMailboxSetDialogProps) {
  const { data: sets = [] } = useMailboxSets();
  const createSet = useCreateMailboxSet();
  const updateSet = useUpdateMailboxSet();

  const existing = existingSetId ? sets.find((s) => s.id === existingSetId) : null;
  const [mode, setMode] = useState<"update" | "new">(existing ? "update" : "new");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (open) {
      if (existing) {
        setMode("update");
        setName(existing.name);
        setDescription(existing.description || "");
      } else {
        setMode("new");
        setName("");
        setDescription("");
      }
    }
  }, [open, existing]);

  const isPending = createSet.isPending || updateSet.isPending;
  const canSubmit = mode === "update" ? !!existing : name.trim().length > 0;

  const handleSubmit = async () => {
    if (mode === "update" && existing) {
      const result = await updateSet.mutateAsync({
        id: existing.id,
        name: name.trim() || existing.name,
        description: description,
        mailbox_ids: mailboxIds,
      });
      onSaved?.(result);
      onOpenChange(false);
      return;
    }
    const result = await createSet.mutateAsync({
      name: name.trim(),
      description,
      mailbox_ids: mailboxIds,
    });
    onSaved?.(result);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {existing ? "Save preset" : "Save as preset"}
          </DialogTitle>
          <DialogDescription>
            {mailboxIds.length} mailbox{mailboxIds.length !== 1 ? "es" : ""} in this preset.
          </DialogDescription>
        </DialogHeader>

        {existing && (
          <div className="flex gap-2 p-1 bg-muted rounded-md text-xs">
            <button
              type="button"
              onClick={() => setMode("update")}
              className={`flex-1 py-1.5 rounded ${
                mode === "update" ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              Update &ldquo;{existing.name}&rdquo;
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("new");
                setName("");
                setDescription("");
              }}
              className={`flex-1 py-1.5 rounded ${
                mode === "new" ? "bg-background shadow-sm" : "text-muted-foreground"
              }`}
            >
              Save as new
            </button>
          </div>
        )}

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VIP senders"
              autoFocus={mode === "new"}
              disabled={mode === "update" && !existing}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="preset-desc">Description (optional)</Label>
            <Textarea
              id="preset-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Founder mailboxes used for high-value outreach"
              rows={2}
              className="resize-none"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleSubmit} disabled={!canSubmit || isPending}>
            {isPending ? "Saving..." : mode === "update" ? "Update preset" : "Save preset"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
