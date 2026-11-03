import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmailRichTextEditor } from "@/components/email/EmailRichTextEditor";
import { Label } from "@/components/ui/label";
import { SNIPPET_VARIABLES } from "@/lib/snippet-utils";
import {
  useCreateCannedResponse,
  useUpdateCannedResponse,
  type CannedResponse,
} from "@/hooks/crm/useCannedResponses";

interface QuickReplyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If provided, dialog is in edit mode */
  editingResponse?: CannedResponse | null;
}

export function QuickReplyFormDialog({
  open,
  onOpenChange,
  editingResponse,
}: QuickReplyFormDialogProps) {
  const [title, setTitle] = useState("");
  const [shortcut, setShortcut] = useState("");
  const [content, setContent] = useState("");

  const createMutation = useCreateCannedResponse();
  const updateMutation = useUpdateCannedResponse();

  const isEditing = !!editingResponse;
  const isPending = createMutation.isPending || updateMutation.isPending;

  // Pre-fill when editing
  useEffect(() => {
    if (editingResponse) {
      setTitle(editingResponse.title);
      setShortcut(editingResponse.shortcut || "");
      setContent(editingResponse.content);
    } else {
      setTitle("");
      setShortcut("");
      setContent("");
    }
  }, [editingResponse, open]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !content.replace(/<[^>]*>/g, "").trim()) return;

    const payload = {
      title: title.trim(),
      content: content.trim(),
      shortcut: shortcut.trim() || undefined,
    };

    if (isEditing) {
      updateMutation.mutate(
        { id: editingResponse.id, ...payload },
        { onSuccess: () => onOpenChange(false) }
      );
    } else {
      createMutation.mutate(payload, {
        onSuccess: () => onOpenChange(false),
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Snippet" : "New Snippet"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="qr-title">Title</Label>
            <Input
              id="qr-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Meeting follow-up"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="qr-shortcut">
              Shortcut{" "}
              <span className="text-muted-foreground font-normal">
                (optional)
              </span>
            </Label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-muted-foreground">/</span>
              <Input
                id="qr-shortcut"
                value={shortcut}
                onChange={(e) =>
                  setShortcut(e.target.value.replace(/\s/g, "").toLowerCase())
                }
                placeholder="meeting"
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="qr-content">Content</Label>
            <div className="rounded-md border bg-white text-gray-900">
              <EmailRichTextEditor
                key={`${editingResponse?.id ?? "new"}-${open}`}
                value={content}
                bodyFormat="text"
                onChange={(html) => setContent(html)}
                placeholder="The message text that will be inserted..."
                minHeight={140}
                maxHeight={280}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Plain text on LinkedIn/WhatsApp, formatted on email. Variables filled in on insert:{" "}
              {SNIPPET_VARIABLES.map((v) => (
                <code key={v.token} className="mr-1.5">{v.token}</code>
              ))}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="cta"
              disabled={isPending || !title.trim() || !content.replace(/<[^>]*>/g, "").trim()}
            >
              {isPending
                ? "Saving..."
                : isEditing
                ? "Save Changes"
                : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
