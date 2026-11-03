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
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Loader2, Merge } from "lucide-react";
import { ListSelector } from "@/components/lead-import/ListSelector";
import {
  LeadList,
  useCreateLeadList,
  useMergeLeadLists,
} from "@/hooks/useLeadLists";

interface MergeListsDialogProps {
  lists: LeadList[];
  allLists: LeadList[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: (targetListId: string) => void;
}

export function MergeListsDialog({
  lists,
  allLists,
  open,
  onOpenChange,
  onMerged,
}: MergeListsDialogProps) {
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [newListName, setNewListName] = useState("");
  const [archiveSourceLists, setArchiveSourceLists] = useState(false);

  const createMutation = useCreateLeadList();
  const mergeMutation = useMergeLeadLists();
  const isLoading = createMutation.isPending || mergeMutation.isPending;

  const sourceIds = new Set(lists.map((l) => l.id));
  // Smart lists have their membership recomputed from filter_criteria on a
  // schedule, so merging contacts into one would just get discarded — they
  // stay valid as a merge *source*, but not as a target.
  const targetCandidates = allLists.filter((l) => !l.is_smart && !sourceIds.has(l.id));

  const totalBeforeDedup = lists.reduce((sum, l) => sum + l.lead_count, 0);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setSelectedListId(null);
      setNewListName("");
      setArchiveSourceLists(false);
    }
    onOpenChange(nextOpen);
  };

  const handleMerge = async () => {
    let targetListId = selectedListId;

    if (!targetListId) {
      if (!newListName.trim()) return;
      const created = await createMutation.mutateAsync({ name: newListName.trim() });
      targetListId = created.id;
    }

    await mergeMutation.mutateAsync({
      sourceListIds: lists.map((l) => l.id),
      targetListId,
      archiveSourceLists,
    });

    onMerged(targetListId);
    handleOpenChange(false);
  };

  const canSubmit = !!selectedListId || newListName.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-0 shrink-0">
          <DialogTitle>Merge Lists</DialogTitle>
          <DialogDescription>
            Combine {lists.length} lists into one. Contacts that appear in more than one list
            (matched by contact and by email) are only added once.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 p-6 overflow-y-auto">
          <div>
            <Label className="text-sm font-medium">Merging</Label>
            <div className="flex flex-wrap gap-2 mt-2">
              {lists.map((list) => (
                <Badge key={list.id} variant="secondary" className="font-normal">
                  {list.name} · {list.lead_count.toLocaleString()}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              {totalBeforeDedup.toLocaleString()} contacts combined before deduplication
            </p>
          </div>

          <ListSelector
            lists={targetCandidates}
            selectedListId={selectedListId}
            newListName={newListName}
            onSelectList={setSelectedListId}
            onNewListNameChange={setNewListName}
          />

          <div className="flex items-center space-x-2">
            <Checkbox
              id="archive-source-lists"
              checked={archiveSourceLists}
              onCheckedChange={(checked) => setArchiveSourceLists(checked === true)}
            />
            <Label htmlFor="archive-source-lists" className="font-normal cursor-pointer">
              Archive source lists after merging
            </Label>
          </div>
        </div>

        <DialogFooter className="p-6 pt-4 border-t shrink-0">
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="cta" onClick={handleMerge} disabled={!canSubmit || isLoading}>
            {isLoading ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Merge className="h-4 w-4 mr-2" />
            )}
            Merge {lists.length} Lists
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
