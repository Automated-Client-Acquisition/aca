import { forwardRef, useMemo, useState } from "react";
import { addDays, format, nextMonday, startOfDay } from "date-fns";
import { ArrowUp, CheckCheck, ChevronDown, Eye, Loader2, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import { normPlatform, type SchedulerPost } from "@/lib/scheduler";
import { AccountPickerList } from "./AccountPickerList";
import { PlatformStack } from "./PlatformGlyph";

export interface PlanCommand {
  instruction: string;
  rangeStart: Date;
  rangeEnd: Date;
  accounts: ConnectedAccount[];
}

interface Preset {
  label: string;
  instruction: string;
  range: () => [Date, Date];
}

const nextWeek = (): [Date, Date] => {
  const start = nextMonday(new Date());
  return [start, addDays(start, 7)];
};

const comingDays = (n: number) => (): [Date, Date] => [new Date(), addDays(startOfDay(new Date()), n + 1)];

const PRESETS: Preset[] = [
  { label: "Plan next week", instruction: "Plan next week: one strong post per weekday per channel, mixing formats (how-to, story, opinion, behind the scenes) around what we sell.", range: nextWeek },
  { label: "Fill this week's gaps", instruction: "Fill the empty weekdays this week so every weekday has at least one post. Don't touch days that already have posts.", range: comingDays(7) },
  { label: "Launch series", instruction: "Write a 4-post launch series over the next 10 days: teaser, announcement, proof and objections, last call. Ask me nothing, use what you know about our product.", range: comingDays(10) },
  { label: "Weekly tips", instruction: "Plan 3 practical tip posts for the next 7 days that our audience can apply the same day.", range: comingDays(7) },
  { label: "Repurpose ideas", instruction: "Turn the strongest ideas from the idea bank into 5 posts for the next two weeks.", range: comingDays(14) },
];

interface AgentBarProps {
  accounts: ConnectedAccount[];
  defaultRange: [Date, Date];
  running: boolean;
  onPlan: (cmd: PlanCommand) => void;
  proposals: SchedulerPost[];
  summary: string | null;
  onDismissSummary: () => void;
  onApproveAll: () => void;
  onDiscardAll: () => void;
  onReview: () => void;
  approving?: boolean;
  value: string;
  onValueChange: (v: string) => void;
}

export const AgentBar = forwardRef<HTMLTextAreaElement, AgentBarProps>(function AgentBar(
  { accounts, defaultRange, running, onPlan, proposals, summary, onDismissSummary, onApproveAll, onDiscardAll, onReview, approving, value, onValueChange },
  ref,
) {
  const usable = useMemo(() => accounts.filter((a) => a.isActive), [accounts]);
  const [scope, setScope] = useState<string[] | null>(null); // null = every account
  const scoped = scope ? usable.filter((a) => scope.includes(a.id)) : usable;
  const scopedPlatforms = [...new Set(scoped.map((a) => normPlatform(a.platform)).filter(Boolean))];
  const scopeLabel = !scope
    ? "All accounts"
    : scoped.length === 0
      ? "No accounts"
      : scoped.length === 1
        ? <span className="max-w-[140px] truncate">{scoped[0].name}</span>
        : `${scoped.length} accounts`;

  const run = (instruction: string, range: [Date, Date] = defaultRange) => {
    if (!instruction.trim() || running) return;
    onPlan({ instruction: instruction.trim(), rangeStart: range[0], rangeEnd: range[1], accounts: scoped });
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow focus-within:shadow-md",
          running && "border-[hsl(var(--status-purple))]/50",
        )}
      >
        {running && <div className="absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r from-transparent via-[hsl(var(--status-purple))] to-transparent" />}
        <div className="flex items-start gap-3 px-4 pt-3">
          <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-[hsl(var(--status-purple))] to-primary text-white shadow-sm">
            <Sparkles className="h-4 w-4" />
          </span>
          <textarea
            ref={ref}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                run(value);
              }
            }}
            rows={1}
            disabled={running}
            placeholder="Ask the agent: “Plan 5 LinkedIn posts for next week about our new feature, best times only”"
            className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-1.5 text-[15px] outline-none placeholder:text-muted-foreground/80"
            aria-label="Ask the scheduling agent"
          />
          <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-8 gap-2 rounded-lg px-2.5 text-xs text-muted-foreground", scoped.length === 0 && usable.length > 0 && "text-destructive")}
                  disabled={running}
                >
                  {scopedPlatforms.length > 0 && <PlatformStack platforms={scopedPlatforms} max={4} />}
                  {scopeLabel}
                  <ChevronDown className="h-3 w-3" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 p-0">
                {usable.length === 0 ? (
                  <p className="px-3 py-4 text-sm text-muted-foreground">No connected social accounts.</p>
                ) : (
                  <AccountPickerList
                    title="Plan for"
                    accounts={usable}
                    selected={scoped.map((a) => a.id)}
                    onChange={(ids) => setScope(ids.length === usable.length ? null : ids)}
                  />
                )}
              </PopoverContent>
            </Popover>
            <Button
              size="icon"
              className="h-8 w-8 rounded-lg"
              variant="cta"
              disabled={!value.trim() || running || scoped.length === 0}
              onClick={() => run(value)}
              aria-label="Plan"
              title="Plan (Enter)"
            >
              {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3 pt-2">
          {running ? (
            <span className="text-xs text-muted-foreground">
              Reading your calendar, brand voice and idea bank, picking free peak slots and writing the posts. This takes up to a minute.
            </span>
          ) : (
            PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                disabled={scoped.length === 0}
                onClick={() => {
                  onValueChange(p.instruction);
                  run(p.instruction, p.range());
                }}
                className="rounded-full border bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-[hsl(var(--status-purple))]/50 hover:text-foreground disabled:opacity-50"
              >
                {p.label}
              </button>
            ))
          )}
        </div>
      </div>

      {(summary || proposals.length > 0) && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[hsl(var(--status-purple))]/30 bg-[hsl(var(--status-purple-bg))] px-4 py-2.5 dark:bg-violet-950/40">
          <Sparkles className="h-4 w-4 shrink-0 text-[hsl(var(--status-purple))]" />
          <div className="min-w-0 flex-1 text-sm">
            {summary && <p className="line-clamp-2">{summary}</p>}
            {proposals.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {proposals.length} proposal{proposals.length === 1 ? "" : "s"} on your calendar
                {proposals[0] && ` from ${format(proposals[0].at, "EEE d MMM")}`}. Nothing goes out until you approve.
              </p>
            )}
          </div>
          {proposals.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={onReview}>
                <Eye className="mr-1.5 h-4 w-4" /> Review
              </Button>
              <Button size="sm" variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={onDiscardAll}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Discard
              </Button>
              <Button size="sm" variant="cta" onClick={onApproveAll} disabled={approving}>
                {approving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <CheckCheck className="mr-1.5 h-4 w-4" />}
                Approve all
              </Button>
            </div>
          )}
          {summary && (
            <button type="button" onClick={onDismissSummary} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});
