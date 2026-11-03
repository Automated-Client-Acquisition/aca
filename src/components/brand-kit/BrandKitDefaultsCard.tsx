import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Megaphone, Target, Package, UserRound, Plus, ArrowDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrandKit, useSetBrandKitDefault } from "@/hooks/useBrandKit";
import { KIND_ASSETS_TAB, LIBRARY_KINDS, type LibraryKind } from "@/lib/blueprint-context";

const KIND_ICON: Record<LibraryKind, React.ElementType> = {
  brand: Megaphone,
  audience: Target,
  product: Package,
  person: UserRound,
};

/** Card titles and what each one is, in the user's terms. Kept to one line so the pickers line up. */
const KIND_CARD: Record<LibraryKind, { title: string; what: string; add: string }> = {
  brand: { title: "Brand voice", what: "Tone, style rules and banned words", add: "Add a brand voice" },
  audience: { title: "Audience", what: "Their pains, goals and words", add: "Add an audience" },
  product: { title: "Product", what: "What you sell and why it's worth it", add: "Add a product" },
  person: { title: "Person", what: "A face and voice for visuals", add: "Add a person" },
};

const NONE = "__none__";

interface BrandKitDefaultsCardProps {
  /** The tab below that's open, to highlight its card. */
  activeTab?: string;
  /** Switch the page to the tab where elements of this kind live. */
  onOpenTab: (tab: string) => void;
  /** Open the add dialog for the tab where elements of this kind live. */
  onAdd: (tab: string) => void;
}

/**
 * The four things every blueprint run, autopilot and AI idea writes with, and
 * which one is the default. A blueprint or a single run can still pick another.
 */
export function BrandKitDefaultsCard({ activeTab, onOpenTab, onAdd }: BrandKitDefaultsCardProps) {
  const { lists, defaults, resolve, isLoading } = useBrandKit();
  const setDefault = useSetBrandKitDefault();

  return (
    <section aria-label="Used in everything you make" className="mb-8 space-y-3">
      <div>
        <h2 className="text-lg font-semibold">Used in everything you make</h2>
        <p className="text-sm text-muted-foreground">
          Blueprint runs, autopilots and AI-generated ideas use these defaults unless a blueprint or a single run picks something else.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {LIBRARY_KINDS.map((kind) => {
          const Icon = KIND_ICON[kind];
          const card = KIND_CARD[kind];
          const list = lists[kind];
          const resolved = resolve(kind);
          const value = defaults[kind] && list.some((e) => e.id === defaults[kind]) ? defaults[kind]! : NONE;
          const tab = KIND_ASSETS_TAB[kind];
          const open = activeTab === tab;

          return (
            <div
              key={kind}
              className={cn(
                "flex min-w-0 flex-col rounded-xl border bg-card p-4 transition-colors",
                open && "border-foreground/40 ring-1 ring-foreground/10",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="truncate text-sm font-semibold">{card.title}</span>
                </div>
                {list.length > 0 && (
                  <button
                    type="button"
                    onClick={() => onOpenTab(tab)}
                    className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    aria-pressed={open}
                  >
                    {list.length} saved
                    <ArrowDown className="h-3 w-3" />
                  </button>
                )}
              </div>
              <p className="mt-1 truncate text-xs text-muted-foreground" title={card.what}>
                {card.what}
              </p>

              <div className="mt-3">
                {isLoading ? (
                  <Skeleton className="h-9 w-full" />
                ) : list.length === 0 ? (
                  <Button variant="outline" className="w-full justify-start" onClick={() => onAdd(tab)}>
                    <Plus className="mr-2 h-4 w-4" />
                    {card.add}
                  </Button>
                ) : (
                  <Select
                    value={value}
                    onValueChange={(v) => setDefault.mutate({ kind, elementId: v === NONE ? null : v })}
                    disabled={setDefault.isPending}
                  >
                    <SelectTrigger aria-label={`Default ${card.title.toLowerCase()}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>No default</SelectItem>
                      {list.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {!isLoading && list.length > 0 && value === NONE && resolved && (
                <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                  No default set, so runs use {resolved.element.name}, the most recently edited.
                </p>
              )}
              {!isLoading && list.length === 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {kind === "person" ? "Optional. Only needed if you want a face in your visuals." : "Nothing yet, so content is written without it."}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
