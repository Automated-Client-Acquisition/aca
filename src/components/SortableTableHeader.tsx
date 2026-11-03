import { ReactNode } from "react";
import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SortConfig } from "@/lib/tableUtils";

interface SortableTableHeaderProps {
  label: string;
  columnKey: string;
  sortConfig: SortConfig;
  onSort: (column: string) => void;
  sortable?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Optional resize handle element rendered inside the <th> */
  resizeHandle?: ReactNode;
}

export function SortableTableHeader({
  label,
  columnKey,
  sortConfig,
  onSort,
  sortable = false,
  className,
  style,
  resizeHandle,
}: SortableTableHeaderProps) {
  const isSorted = sortConfig.column === columnKey;
  const direction = isSorted ? sortConfig.direction : null;

  const handleClick = () => {
    if (sortable) {
      onSort(columnKey);
    }
  };

  return (
    <th
      className={cn(
        "px-4 py-4 text-left text-xs font-semibold uppercase tracking-wider text-muted-foreground whitespace-nowrap",
        sortable && "cursor-pointer select-none hover:bg-accent/10 transition-colors duration-200",
        isSorted && "text-primary",
        className
      )}
      style={style}
      onClick={handleClick}
    >
      <div className="flex items-center gap-2">
        <span>{label}</span>
        {sortable && (
          <span className={cn("transition-colors flex-shrink-0", isSorted ? "text-primary" : "text-muted-foreground/50")}>
            {!isSorted && <ArrowUpDown className="w-3.5 h-3.5" />}
            {isSorted && direction === 'asc' && <ArrowUp className="w-3.5 h-3.5" />}
            {isSorted && direction === 'desc' && <ArrowDown className="w-3.5 h-3.5" />}
          </span>
        )}
      </div>
      {resizeHandle}
    </th>
  );
}
