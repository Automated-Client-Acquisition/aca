import { useState, useEffect } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { LeadList } from "@/hooks/useLeadLists";

interface EditListDialogProps {
  list: LeadList | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: { id: string; name?: string; description?: string }) => void;
  isLoading?: boolean;
}

export function EditListDialog({
  list,
  open,
  onOpenChange,
  onSubmit,
  isLoading,
}: EditListDialogProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (list) {
      setName(list.name);
      setDescription(list.description || "");
    }
  }, [list]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!list || !name.trim()) return;
    onSubmit({
      id: list.id,
      name: name.trim(),
      description: description.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Edit Lead List</DialogTitle>
            <DialogDescription>
              Update the name and description of this list.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">List Name</Label>
              <Input
                id="edit-name"
                placeholder="e.g., Q1 Prospects"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description (optional)</Label>
              <Textarea
                id="edit-description"
                placeholder="Add a description for this list..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="cta" type="submit" disabled={!name.trim() || isLoading}>
              {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
