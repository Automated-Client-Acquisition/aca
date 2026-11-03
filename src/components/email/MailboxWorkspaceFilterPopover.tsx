import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Building2, Search } from "lucide-react";

interface MailboxWorkspaceFilterPopoverProps {
  selectedWorkspaces: string[];
  onSelectedWorkspacesChange: (workspaces: string[]) => void;
  workspaceOptions: string[];
  workspaceMailboxCounts?: Map<string, number>;
}

export function MailboxWorkspaceFilterPopover({
  selectedWorkspaces,
  onSelectedWorkspacesChange,
  workspaceOptions,
  workspaceMailboxCounts,
}: MailboxWorkspaceFilterPopoverProps) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return workspaceOptions;
    const q = search.toLowerCase();
    return workspaceOptions.filter((w) => w.toLowerCase().includes(q));
  }, [workspaceOptions, search]);

  const toggleWorkspace = (name: string) => {
    const updated = selectedWorkspaces.includes(name)
      ? selectedWorkspaces.filter((w) => w !== name)
      : [...selectedWorkspaces, name];
    onSelectedWorkspacesChange(updated);
  };

  const clearAll = () => onSelectedWorkspacesChange([]);

  if (workspaceOptions.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="default" className="gap-2">
          <Building2 className="h-4 w-4" />
          Workspaces
          {selectedWorkspaces.length > 0 && (
            <Badge
              variant="secondary"
              className="ml-1 h-5 min-w-5 rounded-full px-1.5 text-xs"
            >
              {selectedWorkspaces.length}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px]" align="start">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Filter by workspace</h4>
            {selectedWorkspaces.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="h-auto p-1 text-xs"
              >
                Clear all
              </Button>
            )}
          </div>

          {workspaceOptions.length > 8 && (
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Search workspaces..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 h-8 text-sm"
              />
            </div>
          )}

          <div className="space-y-1 max-h-[300px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-3">
                No workspaces match &ldquo;{search}&rdquo;
              </p>
            ) : (
              filtered.map((name) => (
                <div
                  key={name}
                  role="button"
                  tabIndex={0}
                  className="flex items-center space-x-2 cursor-pointer hover:bg-muted/50 p-1.5 rounded"
                  onClick={() => toggleWorkspace(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      toggleWorkspace(name);
                    }
                  }}
                >
                  <Checkbox
                    checked={selectedWorkspaces.includes(name)}
                    onCheckedChange={() => toggleWorkspace(name)}
                  />
                  <Label className="flex-1 cursor-pointer text-sm font-normal truncate">
                    {name}
                  </Label>
                  {workspaceMailboxCounts && (
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {workspaceMailboxCounts.get(name) || 0}
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          {search && filtered.length !== workspaceOptions.length && (
            <p className="text-[11px] text-muted-foreground text-center">
              {filtered.length} of {workspaceOptions.length} workspaces
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
