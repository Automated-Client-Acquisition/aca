import { Columns3, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SignalColumn } from "@/components/signals/signal-columns";

/**
 * Per-table column visibility menu. The choice is remembered per table (see
 * useColumnVisibility), so a user who works by revenue keeps that view.
 *
 * The last visible column can't be unchecked — an empty table is never what
 * someone meant.
 */
export function ColumnPicker<Row>({
  columns,
  visibleIds,
  onToggle,
  onReset,
}: {
  columns: Array<SignalColumn<Row>>;
  visibleIds: Set<string>;
  onToggle: (id: string, checked: boolean) => void;
  onReset: () => void;
}) {
  const lastRemaining = visibleIds.size <= 1;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Columns3 className="mr-1.5 h-4 w-4" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-56 overflow-y-auto">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {columns.map((column) => {
          const checked = visibleIds.has(column.id);
          return (
            <DropdownMenuCheckboxItem
              key={column.id}
              checked={checked}
              disabled={checked && lastRemaining}
              onCheckedChange={(next) => onToggle(column.id, next === true)}
              onSelect={(event) => event.preventDefault()}
            >
              {column.label}
            </DropdownMenuCheckboxItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onReset}>
          <RotateCcw className="mr-2 h-3.5 w-3.5" /> Reset to defaults
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
