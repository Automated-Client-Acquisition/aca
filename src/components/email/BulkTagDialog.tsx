import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Loader2 } from "lucide-react";
import { MailboxTagSelector } from "@/components/email/MailboxTagSelector";
import { useBulkUpdateMailboxTags } from "@/hooks/useEmailMailboxes";

interface BulkTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  selectedEmails: string[];
}

export function BulkTagDialog({
  open,
  onOpenChange,
  selectedIds,
  selectedEmails,
}: BulkTagDialogProps) {
  const [mode, setMode] = useState<"add" | "remove" | "set">("add");
  const [tags, setTags] = useState<string[]>([]);
  const bulkMutation = useBulkUpdateMailboxTags();

  const handleApply = async () => {
    if (tags.length === 0) return;

    await bulkMutation.mutateAsync({ ids: selectedIds, tags, mode });
    onOpenChange(false);
    setTags([]);
    setMode("add");
  };

  const handleClose = () => {
    onOpenChange(false);
    setTags([]);
    setMode("add");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Tag Update</DialogTitle>
          <DialogDescription>
            Update tags for {selectedIds.length} selected mailbox
            {selectedIds.length !== 1 ? "es" : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-3">
            <Label>Action</Label>
            <RadioGroup
              value={mode}
              onValueChange={(v) => setMode(v as "add" | "remove" | "set")}
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="add" id="bulk-tag-add" />
                <Label htmlFor="bulk-tag-add" className="font-normal cursor-pointer">
                  Add tags to existing
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="remove" id="bulk-tag-remove" />
                <Label htmlFor="bulk-tag-remove" className="font-normal cursor-pointer">
                  Remove tags
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="set" id="bulk-tag-set" />
                <Label htmlFor="bulk-tag-set" className="font-normal cursor-pointer">
                  Replace all tags
                </Label>
              </div>
            </RadioGroup>
          </div>

          <div className="space-y-2">
            <Label>Tags</Label>
            <MailboxTagSelector
              tags={tags}
              onChange={setTags}
              placeholder="Type and press Enter..."
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <p className="font-medium mb-1">Selected mailboxes:</p>
            <div className="max-h-20 overflow-y-auto space-y-0.5">
              {selectedEmails.slice(0, 5).map((email) => (
                <p key={email}>{email}</p>
              ))}
              {selectedEmails.length > 5 && (
                <p>... and {selectedEmails.length - 5} more</p>
              )}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            variant="cta"
            onClick={handleApply}
            disabled={tags.length === 0 || bulkMutation.isPending}
          >
            {bulkMutation.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
