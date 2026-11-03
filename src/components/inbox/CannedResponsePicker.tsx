import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Zap, Plus, Pencil, Trash2 } from "lucide-react";
import {
  useCannedResponses,
  useIncrementCannedResponseUsage,
  useDeleteCannedResponse,
  type CannedResponse,
} from "@/hooks/crm/useCannedResponses";
import { QuickReplyFormDialog } from "./QuickReplyFormDialog";
import { snippetToPlainText } from "@/lib/snippet-utils";

interface CannedResponsePickerProps {
  /** The current search query (text after the `/`) */
  query: string;
  /** Whether the picker should be visible */
  open: boolean;
  /** Called when a canned response is selected */
  onSelect: (content: string, responseId: string) => void;
  /** Called when the picker should close */
  onClose: () => void;
}

export function CannedResponsePicker({
  query,
  open,
  onSelect,
  onClose,
}: CannedResponsePickerProps) {
  const { data: responses } = useCannedResponses();
  const incrementUsage = useIncrementCannedResponseUsage();
  const deleteMutation = useDeleteCannedResponse();
  const [selectedIndex, setSelectedIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  // Form dialog state
  const [formOpen, setFormOpen] = useState(false);
  const [editingResponse, setEditingResponse] = useState<CannedResponse | null>(null);

  // Delete confirmation state
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Filter responses by query (match title, shortcut, or content)
  const filtered = (responses || []).filter((r) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      r.title.toLowerCase().includes(q) ||
      (r.shortcut && r.shortcut.toLowerCase().includes(q)) ||
      r.content.toLowerCase().includes(q)
    );
  });

  // Reset selection when query or filtered list changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, filtered.length]);

  // Keyboard navigation
  useEffect(() => {
    if (!open || formOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => Math.min(prev + 1, filtered.length - 1));
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => Math.max(prev - 1, 0));
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          if (filtered[selectedIndex]) {
            handleSelect(filtered[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [open, formOpen, selectedIndex, filtered]);

  const handleSelect = (response: CannedResponse) => {
    onSelect(response.content, response.id);
    incrementUsage.mutate(response.id);
  };

  const handleEdit = (e: React.MouseEvent, response: CannedResponse) => {
    e.stopPropagation();
    setEditingResponse(response);
    setFormOpen(true);
  };

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (deletingId === id) {
      // Second click = confirm
      deleteMutation.mutate(id, {
        onSuccess: () => setDeletingId(null),
      });
    } else {
      setDeletingId(id);
      // Auto-reset confirmation after 3s
      setTimeout(() => setDeletingId((prev) => (prev === id ? null : prev)), 3000);
    }
  };

  const handleCreate = () => {
    setEditingResponse(null);
    setFormOpen(true);
  };

  if (!open) return null;

  return (
    <>
      <div className="absolute bottom-full left-0 right-0 mb-1 z-50">
        <div className="mx-2 rounded-lg border bg-popover shadow-lg overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Zap className="h-3.5 w-3.5" />
              Quick Replies
            </div>
            {query && (
              <span className="text-[10px] text-muted-foreground">
                {filtered.length} result{filtered.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {/* List */}
          <ScrollArea className="max-h-[200px]" ref={listRef}>
            {filtered.length > 0 ? (
              filtered.map((response, index) => (
                <div
                  key={response.id}
                  className={cn(
                    "group relative w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors cursor-pointer",
                    index === selectedIndex && "bg-accent"
                  )}
                  onClick={() => handleSelect(response)}
                  onMouseEnter={() => setSelectedIndex(index)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{response.title}</span>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {response.shortcut && (
                        <span className="text-[10px] text-muted-foreground font-mono group-hover:hidden">
                          /{response.shortcut}
                        </span>
                      )}
                      {/* Edit/Delete — visible on hover */}
                      <div className="hidden group-hover:flex items-center gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 text-muted-foreground hover:text-foreground"
                          onClick={(e) => handleEdit(e, response)}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-6 w-6",
                            deletingId === response.id
                              ? "text-destructive hover:text-destructive"
                              : "text-muted-foreground hover:text-destructive"
                          )}
                          onClick={(e) => handleDelete(e, response.id)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                        {deletingId === response.id && (
                          <span className="text-[10px] text-destructive font-medium whitespace-nowrap">
                            Click to confirm
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {snippetToPlainText(response.content)}
                  </p>
                </div>
              ))
            ) : (
              <div className="px-3 py-4 text-center">
                <p className="text-xs text-muted-foreground">
                  {query ? "No matching quick replies" : "No quick replies yet"}
                </p>
              </div>
            )}
          </ScrollArea>

          {/* Footer — create new */}
          <button
            className="w-full flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors border-t"
            onClick={handleCreate}
          >
            <Plus className="h-3.5 w-3.5" />
            Create new quick reply
          </button>
        </div>
      </div>

      {/* Create / Edit Dialog */}
      <QuickReplyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editingResponse={editingResponse}
      />
    </>
  );
}
