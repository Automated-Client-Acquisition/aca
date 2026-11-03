import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

/**
 * Sortable table header. The arrow stays hidden until the column is active or
 * hovered, so a table with many sortable columns doesn't turn into a wall of
 * icons.
 */
export function SortableHeader<K extends string>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  className,
}: {
  label: string;
  sortKey: K;
  activeKey: K;
  dir: SortDir;
  onSort: (key: K) => void;
  className?: string;
}) {
  const isActive = activeKey === sortKey;
  const Icon = !isActive ? ChevronsUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      className={cn("px-3 py-2.5 font-medium", className)}
      aria-sort={isActive ? (dir === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className="group inline-flex select-none items-center gap-1 uppercase tracking-wide transition-colors hover:text-foreground"
      >
        {label}
        <Icon
          className={cn(
            "h-3 w-3 transition-opacity",
            isActive ? "opacity-100" : "opacity-0 group-hover:opacity-60",
          )}
        />
      </button>
    </th>
  );
}

/**
 * Shared click behaviour: re-clicking the active column flips direction,
 * a new column adopts its natural default (dates newest-first, text A→Z).
 */
export function nextSortState<K extends string>(
  clicked: K,
  activeKey: K,
  dir: SortDir,
  defaultDirFor: (key: K) => SortDir,
): { key: K; dir: SortDir } {
  if (clicked === activeKey) return { key: clicked, dir: dir === "asc" ? "desc" : "asc" };
  return { key: clicked, dir: defaultDirFor(clicked) };
}
