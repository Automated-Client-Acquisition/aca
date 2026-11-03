import {
  CheckCircle2,
  ChevronRight,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { ContentIdea } from "@/hooks/useIdeas";
import { parseAnalysis, readGuidelines } from "@/lib/idea-guidelines";
import { cn } from "@/lib/utils";

export interface IdeaLibraryCardProps {
  idea: ContentIdea;
  selected: boolean;
  onSelect: (selected: boolean) => void;
  onOpen: () => void;
  onCreate: () => void;
  onAssign: () => void;
  onRemove: () => void;
  onResetGeneration: () => void;
  usedCount: number | null;
  approved: boolean;
  sourceLabel?: string | null;
  duplicate?: boolean;
  autopilots: Array<{ id: string; name: string; paused?: boolean }>;
  feedsLoading?: boolean;
  picking?: boolean;
}

export function IdeaLibraryCard({
  idea,
  selected,
  onSelect,
  onOpen,
  onCreate,
  onAssign,
  onRemove,
  onResetGeneration,
  usedCount,
  approved,
  sourceLabel,
  duplicate,
  autopilots,
  feedsLoading,
  picking,
}: IdeaLibraryCardProps) {
  const title = idea.title?.trim() || "Untitled idea";
  const preview =
    readGuidelines(parseAnalysis(idea.ai_analysis))
      .points.find((point) => point.trim())
      ?.trim() || idea.free_text?.trim();
  const chips = [
    ...new Set(
      [
        ...(idea.tags ?? []).map((tag) => tag.name),
        ...(idea.keywords ?? []),
      ].filter(Boolean),
    ),
  ].slice(0, 3);
  const createdAt = new Date(idea.created_at);
  const date = Number.isNaN(createdAt.getTime())
    ? null
    : createdAt.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  const enriching = !!idea.generation_in_progress;
  const stale =
    enriching &&
    Date.now() - new Date(idea.updated_at).getTime() > 30 * 60 * 1000;

  return (
    <article
      aria-label={title}
      className={cn(
        "flex min-w-0 flex-col rounded-xl border bg-card transition-colors",
        selected
          ? "border-amber-400 ring-1 ring-amber-400/30"
          : "border-border hover:border-muted-foreground/40",
      )}
    >
      <div className="flex min-w-0 items-start gap-3 px-5 pt-4">
        <Checkbox
          checked={selected}
          onCheckedChange={(checked) => onSelect(checked === true)}
          aria-label={`Select idea: ${title}`}
          className="mt-1 shrink-0"
        />
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
          {date && <time dateTime={idea.created_at}>{date}</time>}
          {date && sourceLabel && <span aria-hidden="true">·</span>}
          {sourceLabel && (
            <span className="min-w-0 break-words">{sourceLabel}</span>
          )}
          {duplicate && (
            <span className="rounded bg-muted px-1.5 py-0.5">
              Duplicate title
            </span>
          )}
        </div>
        {!picking && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="-mr-2 -mt-2 h-8 w-8 shrink-0"
                aria-label={`More actions for ${title}`}
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="end"
              className="max-w-[calc(100vw-2rem)]"
            >
              <DropdownMenuItem onSelect={onOpen}>Open idea</DropdownMenuItem>
              <DropdownMenuItem onSelect={onAssign} disabled={feedsLoading}>
                Assign to autopilot
              </DropdownMenuItem>
              {autopilots.length > 0 && (
                <DropdownMenuItem onSelect={onRemove}>
                  Remove from autopilot
                </DropdownMenuItem>
              )}
              {stale && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={onResetGeneration}>
                    <RotateCcw className="mr-2 h-4 w-4" />
                    Reset enrichment
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="min-w-0 flex-1 px-5 pb-4 pt-3">
        <h3 className="text-base font-semibold leading-snug">
          <button
            type="button"
            onClick={onOpen}
            className="w-full rounded-sm text-left [overflow-wrap:anywhere] hover:text-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:hover:text-amber-400"
          >
            {title}
          </button>
        </h3>
        {preview && (
          <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            {preview}
          </p>
        )}
        {chips.length > 0 && (
          <div
            className="mt-3 flex min-w-0 flex-wrap gap-1.5"
            aria-label="Idea topics"
          >
            {chips.map((chip) => (
              <span
                key={chip}
                className="max-w-full rounded-md bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]"
              >
                {chip}
              </span>
            ))}
          </div>
        )}
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-xs">
          <span className="text-muted-foreground">
            {usedCount === null
              ? "Usage not loaded"
              : usedCount === 0
                ? "Not used yet"
                : `Created ${usedCount} ${usedCount === 1 ? "time" : "times"}`}
          </span>
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              approved
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-muted-foreground",
            )}
          >
            {approved && <CheckCircle2 className="h-3.5 w-3.5" />}
            {approved ? "Guidelines approved" : "Review guidelines"}
          </button>
        </div>
        {!picking && autopilots.length > 0 && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
            Available to:{" "}
            {autopilots
              .slice(0, 2)
              .map(
                (autopilot) =>
                  `${autopilot.name}${autopilot.paused ? " (paused)" : ""}`,
              )
              .join(", ")}
            {autopilots.length > 2 && ` +${autopilots.length - 2} more`}
          </p>
        )}
        {enriching && (
          <div
            className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
            role="status"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Enriching idea
            {stale && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={onResetGeneration}
              >
                Reset enrichment
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-5 py-3">
        {picking ? (
          <p
            className={cn(
              "text-sm",
              selected
                ? "font-medium text-amber-700 dark:text-amber-400"
                : "text-muted-foreground",
            )}
          >
            {selected ? "Selected for this autopilot" : "Select this idea to assign it"}
          </p>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={onOpen}>
              Open idea
              <ChevronRight />
            </Button>
            <Button
              variant="cta"
              size="sm"
              onClick={onCreate}
              disabled={enriching}
            >
              <Sparkles />
              Create content
            </Button>
          </>
        )}
      </div>
    </article>
  );
}
