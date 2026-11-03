import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import {
  useCannedResponses,
  useDeleteCannedResponse,
  type CannedResponse,
} from "@/hooks/crm/useCannedResponses";
import { QuickReplyFormDialog } from "./QuickReplyFormDialog";
import { snippetToPlainText } from "@/lib/snippet-utils";

interface ManageSnippetsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ManageSnippetsDialog({ open, onOpenChange }: ManageSnippetsDialogProps) {
  const { data: snippets = [], isLoading } = useCannedResponses();
  const deleteMutation = useDeleteCannedResponse();
  const [search, setSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CannedResponse | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const q = search.toLowerCase();
  const filtered = snippets.filter(
    (s) =>
      !q ||
      s.title.toLowerCase().includes(q) ||
      s.content.toLowerCase().includes(q) ||
      s.shortcut?.toLowerCase().includes(q)
  );

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Manage snippets</DialogTitle>
          </DialogHeader>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search snippets..."
                className="pl-8"
              />
            </div>
            <Button
              variant="cta"
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              New snippet
            </Button>
          </div>

          <div className="max-h-[420px] overflow-y-auto divide-y rounded-md border">
            {isLoading ? (
              <p className="p-6 text-center text-sm text-muted-foreground">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                {snippets.length === 0
                  ? "No snippets yet. Create one to reuse it in any reply."
                  : "No matching snippets"}
              </p>
            ) : (
              filtered.map((s) => (
                <div key={s.id} className="flex items-start gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{s.title}</span>
                      {s.shortcut && (
                        <span className="text-[10px] font-mono text-muted-foreground">/{s.shortcut}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground ml-auto whitespace-nowrap">
                        used {s.usage_count}x
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5 whitespace-pre-line">
                      {snippetToPlainText(s.content)}
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      setEditing(s);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={confirmId === s.id ? "destructive" : "ghost"}
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => {
                      if (confirmId === s.id) {
                        deleteMutation.mutate(s.id, { onSettled: () => setConfirmId(null) });
                      } else {
                        setConfirmId(s.id);
                        setTimeout(() => setConfirmId((p) => (p === s.id ? null : p)), 3000);
                      }
                    }}
                    title={confirmId === s.id ? "Click again to confirm" : "Delete"}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      <QuickReplyFormDialog open={formOpen} onOpenChange={setFormOpen} editingResponse={editing} />
    </>
  );
}
