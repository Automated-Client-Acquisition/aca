import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Columns3, Search } from "lucide-react";

export interface ColumnConfig {
  key: string;
  label: string;
  alwaysVisible?: boolean;
  group?: string;
}

interface ColumnSelectorProps {
  columns: ColumnConfig[];
  visibleColumns: string[];
  onVisibilityChange: (columns: string[]) => void;
  defaultVisibleColumns?: string[];
  trigger?: ReactNode;
}

export function ColumnSelector({ columns, visibleColumns, onVisibilityChange, defaultVisibleColumns, trigger }: ColumnSelectorProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const handleToggle = (columnKey: string) => {
    if (visibleColumns.includes(columnKey)) {
      onVisibilityChange(visibleColumns.filter(k => k !== columnKey));
    } else {
      onVisibilityChange([...visibleColumns, columnKey]);
    }
  };

  const handleShowAll = () => {
    onVisibilityChange(columns.map(c => c.key));
  };

  const handleReset = () => {
    const configuredDefaults = new Set(defaultVisibleColumns || []);
    const defaults = columns
      .filter(c => c.alwaysVisible || configuredDefaults.has(c.key))
      .map(c => c.key);
    onVisibilityChange(defaults);
  };

  const groups = columns.reduce<Record<string, ColumnConfig[]>>((acc, column) => {
    if (!column.label.toLowerCase().includes(search.toLowerCase())) return acc;
    const group = column.group || "Contact details";
    (acc[group] ||= []).push(column);
    return acc;
  }, {});

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="gap-2">
            <Columns3 className="w-4 h-4" />
            Columns
            <span className="text-xs text-muted-foreground">{visibleColumns.length}</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]" onCloseAutoFocus={() => setSearch("")}>
        <DropdownMenuLabel className="flex items-center justify-between">
          <span>Table columns</span>
          <span className="text-xs font-normal text-muted-foreground">{visibleColumns.length} shown</span>
        </DropdownMenuLabel>
        <div className="relative px-2 pb-2">
          <Search className="absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Find a column…"
            className="h-9 pl-9"
          />
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-[360px] overflow-y-auto py-1">
          {Object.entries(groups).map(([group, groupColumns]) => (
            <div key={group}>
              <DropdownMenuLabel className="px-3 pb-1 pt-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                {group}
              </DropdownMenuLabel>
              {groupColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.key}
                  checked={visibleColumns.includes(column.key)}
                  onCheckedChange={() => handleToggle(column.key)}
                  disabled={column.alwaysVisible}
                  className="cursor-pointer"
                >
                  {column.label}
                </DropdownMenuCheckboxItem>
              ))}
            </div>
          ))}
          {Object.keys(groups).length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">No columns found</p>
          )}
        </div>
        <DropdownMenuSeparator />
        <div className="flex gap-2 p-1">
          <Button variant="ghost" size="sm" onClick={handleShowAll} className="flex-1 h-8">
            Show All
          </Button>
          <Button variant="ghost" size="sm" onClick={handleReset} className="flex-1 h-8">
            Reset
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
