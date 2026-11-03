import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

const COMMON_REASONS = ["Price", "Timing", "No budget", "Went with a competitor", "No decision", "Ghosted", "Bad fit"];

export function LostReasonDialog({
  open,
  dealName,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  dealName?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Why was this deal lost?</DialogTitle>
          <DialogDescription>{dealName ? `"${dealName}". ` : ""}Lost reasons show up in your pipeline report.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {COMMON_REASONS.map((r) => (
            <Badge
              key={r}
              variant={reason === r ? "default" : "outline"}
              className="cursor-pointer"
              onClick={() => setReason(r)}
            >
              {r}
            </Badge>
          ))}
        </div>
        <Input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Or type a reason"
          onKeyDown={(e) => e.key === "Enter" && onConfirm(reason.trim())}
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="cta" onClick={() => onConfirm(reason.trim())}>
            Mark as lost
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
