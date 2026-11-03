import { useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Loader2, ImagePlus } from "lucide-react";
import { useAvatarUpload } from "@/hooks/useAvatarUpload";
import { useBulkUpdateMailboxes } from "@/hooks/useEmailMailboxes";
import { useStartMailboxAvatarSyncJob } from "@/hooks/useM365Mailboxes";
import { useAuth } from "@/contexts/AuthContext";

interface BulkSetAvatarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: string[];
  selectedEmails: string[];
  /** Called with the started avatar sync job's id, so the parent can show progress. */
  onJobStarted: (jobId: string) => void;
}

export function BulkSetAvatarDialog({
  open,
  onOpenChange,
  selectedIds,
  selectedEmails,
  onJobStarted,
}: BulkSetAvatarDialogProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { currentOrganization } = useAuth();
  const { uploadAvatar, isUploading } = useAvatarUpload();
  const bulkUpdateMailboxes = useBulkUpdateMailboxes();
  const startAvatarSyncJob = useStartMailboxAvatarSyncJob();

  const isApplying = isUploading || bulkUpdateMailboxes.isPending || startAvatarSyncJob.isPending;

  const resetState = () => {
    setFile(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleClose = () => {
    onOpenChange(false);
    resetState();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  };

  const handleApply = async () => {
    if (!file || !currentOrganization) return;

    const avatarUrl = await uploadAvatar(file, "mailbox", currentOrganization.id);
    if (!avatarUrl) return;

    await bulkUpdateMailboxes.mutateAsync({
      ids: selectedIds,
      metadataUpdates: { avatar_url: avatarUrl },
    });

    // Kick off the M365 sync as a background job and close immediately —
    // no need to block the dialog on however many Graph calls the selection
    // needs. The parent tracks the job id and shows a progress banner.
    try {
      const { job_id } = await startAvatarSyncJob.mutateAsync({ mailboxIds: selectedIds });
      onJobStarted(job_id);
    } catch {
      // Non-fatal: the DB write already succeeded. The hook surfaces its own error toast.
    }

    handleClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Set Avatar</DialogTitle>
          <DialogDescription>
            Apply one image as the avatar for {selectedIds.length} selected mailbox
            {selectedIds.length !== 1 ? "es" : ""}. Microsoft 365 mailboxes will also get this
            as their profile photo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-4">
            <Avatar className="w-16 h-16 rounded-lg">
              {previewUrl ? <AvatarImage src={previewUrl} className="object-cover" /> : null}
              <AvatarFallback className="rounded-lg">
                <ImagePlus className="w-6 h-6 text-muted-foreground" />
              </AvatarFallback>
            </Avatar>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="hidden"
                onChange={handleFileChange}
                disabled={isApplying}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={isApplying}
              >
                {file ? "Choose different image" : "Choose image"}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">JPEG or PNG</p>
            </div>
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
          <Button variant="outline" onClick={handleClose} disabled={isApplying}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleApply} disabled={!file || isApplying}>
            {isApplying && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
