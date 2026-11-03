import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useDuplicateEmailSequence } from "@/hooks/useEmailSequences";
import { useNavigate } from "react-router-dom";
import { Copy, Loader2 } from "lucide-react";

interface DuplicateSequenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequence: {
    id: string;
    name: string;
    status: string;
    lead_list_ids?: string[] | null;
  } | null;
  /** Enrollment count on the source, when the caller already knows it. */
  enrollmentTotal?: number;
  /** Open the copy in the builder once it exists. Defaults to true. */
  navigateOnSuccess?: boolean;
}

export function DuplicateSequenceDialog({
  open,
  onOpenChange,
  sequence,
  enrollmentTotal,
  navigateOnSuccess = true,
}: DuplicateSequenceDialogProps) {
  const navigate = useNavigate();
  const duplicate = useDuplicateEmailSequence();

  const [name, setName] = useState("");
  const [copyLeadLists, setCopyLeadLists] = useState(false);
  const [copyEnrolledLeads, setCopyEnrolledLeads] = useState(false);

  const listCount = sequence?.lead_list_ids?.length ?? 0;
  const hasLeads = (enrollmentTotal ?? 0) > 0;

  // Reset to "content only" every time the dialog opens — copying an audience is
  // a send-affecting choice and should be made deliberately, not inherited.
  useEffect(() => {
    if (open && sequence) {
      setName(`${sequence.name} (copy)`);
      setCopyLeadLists(false);
      setCopyEnrolledLeads(false);
    }
  }, [open, sequence]);

  const handleDuplicate = () => {
    if (!sequence) return;
    duplicate.mutate(
      {
        id: sequence.id,
        name: name.trim() || undefined,
        copyLeadLists,
        copyEnrolledLeads,
      },
      {
        onSuccess: (result) => {
          onOpenChange(false);
          if (navigateOnSuccess) navigate(`/email/sequences/${result.sequence.id}`);
        },
      }
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !duplicate.isPending && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Copy className="h-4 w-4" />
            Duplicate sequence
          </DialogTitle>
          <DialogDescription>
            Copies every step, the settings, mailbox pool and tracking domain. The copy is
            created as a draft — nothing sends until you activate it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="duplicate-sequence-name">Name</Label>
            <Input
              id="duplicate-sequence-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={sequence ? `${sequence.name} (copy)` : "Sequence name"}
              autoFocus
            />
          </div>

          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-start gap-3">
              <Checkbox
                id="duplicate-copy-lists"
                checked={copyLeadLists}
                onCheckedChange={(v) => setCopyLeadLists(v === true)}
                disabled={listCount === 0}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label
                  htmlFor="duplicate-copy-lists"
                  className={listCount === 0 ? "text-muted-foreground" : undefined}
                >
                  Attach the same lead lists
                </Label>
                <p className="text-xs text-muted-foreground">
                  {listCount === 0
                    ? "This sequence has no lead lists attached."
                    : `Carries ${listCount} lead list${listCount === 1 ? "" : "s"}, the auto-enroll setting and the enrollment filter.`}
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id="duplicate-copy-leads"
                checked={copyEnrolledLeads}
                onCheckedChange={(v) => setCopyEnrolledLeads(v === true)}
                disabled={enrollmentTotal !== undefined && !hasLeads}
                className="mt-0.5"
              />
              <div className="space-y-0.5">
                <Label
                  htmlFor="duplicate-copy-leads"
                  className={
                    enrollmentTotal !== undefined && !hasLeads ? "text-muted-foreground" : undefined
                  }
                >
                  Enroll the same leads
                </Label>
                <p className="text-xs text-muted-foreground">
                  {enrollmentTotal !== undefined && !hasLeads
                    ? "No leads are enrolled in this sequence."
                    : `Re-enrols ${
                        enrollmentTotal !== undefined
                          ? enrollmentTotal.toLocaleString() + " "
                          : "the "
                      }lead${enrollmentTotal === 1 ? "" : "s"} from the start. Leads that are unsubscribed, bounced, or already active in another sequence are skipped.`}
                </p>
              </div>
            </div>

            {copyEnrolledLeads && sequence?.status === "active" && (
              <p className="text-xs text-amber-600 dark:text-amber-500">
                This sequence is active, so its leads are already being worked — most will be
                skipped by the one-active-sequence-per-lead rule. Pause or move them first if you
                meant to hand the audience over.
              </p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={duplicate.isPending}
          >
            Cancel
          </Button>
          <Button variant="cta" onClick={handleDuplicate} disabled={duplicate.isPending}>
            {duplicate.isPending ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Duplicating…
              </>
            ) : (
              <>
                <Copy className="h-4 w-4 mr-2" />
                Duplicate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
