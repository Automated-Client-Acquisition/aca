import { useEffect, useRef, useState } from "react";
import { Check } from "lucide-react";
import { STATE_LABEL, type Piece, type PieceState } from "@/lib/piece";
import { cn } from "@/lib/utils";

export type FilmFilter = "all" | PieceState;

export interface FilmItem {
  id: string;
  piece: Piece;
}

const DOT: Record<PieceState, string> = {
  generating: "bg-blue-500 animate-pulse",
  waiting: "bg-amber-500",
  failed: "bg-destructive",
  ready: "bg-emerald-500",
  done: "bg-emerald-500",
  discarded: "bg-muted-foreground/40",
};

const FILTER_ORDER: FilmFilter[] = ["all", "waiting", "ready", "failed", "generating", "done", "discarded"];

interface FilmstripProps {
  items: FilmItem[];
  allItems: FilmItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  filter: FilmFilter;
  onFilter: (f: FilmFilter) => void;
  checked: string[];
  onToggleCheck: (id: string) => void;
}

function Thumb({ src }: { src: string }) {
  const [loaded, setLoaded] = useState(false);
  return (
    <>
      {!loaded && <span className="absolute inset-0 animate-pulse bg-muted-foreground/10" />}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        onLoad={() => setLoaded(true)}
        className={cn("h-full w-full object-cover transition-opacity", loaded ? "opacity-100" : "opacity-0")}
      />
    </>
  );
}

/** Every piece of a multi-piece run, as thumbnails. */
export function Filmstrip({ items, allItems, selectedId, onSelect, filter, onFilter, checked, onToggleCheck }: FilmstripProps) {
  const selectedRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
  }, [selectedId]);

  const counts = FILTER_ORDER.reduce<Record<string, number>>((acc, f) => {
    acc[f] = f === "all" ? allItems.length : allItems.filter((i) => i.piece.state === f).length;
    return acc;
  }, {});

  return (
    <div className="border-b bg-muted/20">
      <div className="flex flex-wrap items-center gap-1.5 px-4 pt-3 sm:px-6" role="tablist" aria-label="Filter pieces">
        {FILTER_ORDER.filter((f) => f === "all" || counts[f] > 0).map((f) => (
          <button
            key={f}
            role="tab"
            aria-selected={filter === f}
            onClick={() => onFilter(f)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              filter === f ? "border-foreground bg-foreground text-background" : "bg-background text-muted-foreground hover:text-foreground",
            )}
          >
            {f !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", DOT[f as PieceState])} />}
            {f === "all" ? "All" : f === "waiting" ? "Needs you" : STATE_LABEL[f as PieceState]}
            <span className="tabular-nums opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>
      <div className="flex gap-2.5 overflow-x-auto px-4 py-3 sm:px-6">
        {items.length === 0 && <p className="py-6 text-sm text-muted-foreground">Nothing here.</p>}
        {items.map(({ id, piece }, i) => {
          const selected = id === selectedId;
          const isChecked = checked.includes(id);
          return (
            <div key={id} className="group relative shrink-0">
              <button
                ref={selected ? selectedRef : undefined}
                onClick={() => onSelect(id)}
                aria-current={selected}
                aria-label={`Piece ${i + 1}: ${piece.title}`}
                className={cn(
                  "flex h-[124px] w-[168px] flex-col overflow-hidden rounded-lg border bg-card text-left transition-all",
                  selected ? "border-foreground ring-2 ring-foreground/20" : "hover:border-foreground/40",
                  piece.state === "discarded" && "opacity-50",
                )}
              >
                <div className="relative h-[76px] w-full overflow-hidden bg-muted">
                  {piece.image ? (
                    <Thumb src={piece.image} />
                  ) : (
                    <p className="line-clamp-4 p-2 text-[10px] leading-snug text-muted-foreground">{piece.text || "…"}</p>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2">
                  <span className="truncate text-[11px] font-medium">{piece.title}</span>
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <span className={cn("h-1.5 w-1.5 rounded-full", DOT[piece.state])} />
                    {piece.state === "waiting" ? "Needs you" : STATE_LABEL[piece.state]}
                  </span>
                </div>
              </button>
              <button
                type="button"
                role="checkbox"
                aria-checked={isChecked}
                aria-label="Select for bulk actions"
                onClick={() => onToggleCheck(id)}
                className={cn(
                  "absolute left-1.5 top-1.5 grid h-5 w-5 place-items-center rounded border bg-background/90 shadow-sm transition-opacity",
                  isChecked ? "border-foreground opacity-100" : "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
                  checked.length > 0 && "opacity-100",
                )}
              >
                {isChecked && <Check className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
