import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MessageSquareText, Plus, Search, Settings2 } from "lucide-react";
import {
  useCannedResponses,
  useIncrementCannedResponseUsage,
  type CannedResponse,
} from "@/hooks/crm/useCannedResponses";
import { QuickReplyFormDialog } from "./QuickReplyFormDialog";
import { snippetToPlainText } from "@/lib/snippet-utils";
import { ManageSnippetsDialog } from "./ManageSnippetsDialog";

interface SnippetsMenuProps {
  disabled?: boolean;
  /** Receives the raw snippet content; the composer resolves variables and inserts it. */
  onInsert: (content: string) => void;
}

export function SnippetsMenu({ disabled, onInsert }: SnippetsMenuProps) {
  const { data: snippets = [] } = useCannedResponses();
  const incrementUsage = useIncrementCannedResponseUsage();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);

  const q = search.toLowerCase();
  const filtered = snippets.filter(
    (s) =>
      !q ||
      s.title.toLowerCase().includes(q) ||
      s.content.toLowerCase().includes(q) ||
      s.shortcut?.toLowerCase().includes(q)
  );

  const pick = (s: CannedResponse) => {
    onInsert(s.content);
    incrementUsage.mutate(s.id);
    setOpen(false);
    setSearch("");
  };

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 flex-shrink-0" disabled={disabled}>
                <MessageSquareText className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Snippets</TooltipContent>
        </Tooltip>
        <PopoverContent align="start" side="top" className="w-80 p-0">
          <div className="relative border-b">
            <Search className="absolute left-3 top-3 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search snippets..."
              className="border-0 shadow-none focus-visible:ring-0 pl-8"
            />
          </div>
          <div className="max-h-[260px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-muted-foreground">
                {snippets.length === 0 ? "No snippets yet" : "No matching snippets"}
              </p>
            ) : (
              filtered.map((s) => (
                <button
                  key={s.id}
                  className="w-full text-left px-3 py-2 hover:bg-accent transition-colors"
                  onClick={() => pick(s)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium truncate">{s.title}</span>
                    {s.shortcut && (
                      <span className="text-[10px] font-mono text-muted-foreground">/{s.shortcut}</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{snippetToPlainText(s.content)}</p>
                </button>
              ))
            )}
          </div>
          <div className="flex border-t">
            <button
              className="flex-1 flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-3.5 w-3.5" /> New
            </button>
            <button
              className="flex-1 flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:bg-accent hover:text-foreground border-l"
              onClick={() => {
                setOpen(false);
                setManageOpen(true);
              }}
            >
              <Settings2 className="h-3.5 w-3.5" /> Manage
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <QuickReplyFormDialog open={createOpen} onOpenChange={setCreateOpen} editingResponse={null} />
      <ManageSnippetsDialog open={manageOpen} onOpenChange={setManageOpen} />
    </>
  );
}
