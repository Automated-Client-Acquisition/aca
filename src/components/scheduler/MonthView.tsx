import { useMemo } from "react";
import { useDroppable } from "@dnd-kit/core";
import { endOfDay, format, isSameDay, isSameMonth, isToday } from "date-fns";
import { Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SchedulerPost } from "@/lib/scheduler";
import { PostCard } from "./PostCard";
import type { Projection } from "./WeekView";

const MAX_VISIBLE = 4;

function DayCell({
  day,
  month,
  posts,
  projections,
  onOpen,
  onCreateOnDay,
  onShowDay,
  selectedKey,
}: {
  day: Date;
  month: Date;
  posts: SchedulerPost[];
  projections: Projection[];
  onOpen: (p: SchedulerPost) => void;
  onCreateOnDay: (day: Date) => void;
  onShowDay: (day: Date) => void;
  selectedKey?: string | null;
}) {
  const past = endOfDay(day).getTime() < Date.now();
  const { setNodeRef, isOver } = useDroppable({ id: `day:${day.toISOString()}`, data: { at: day, granularity: "day" }, disabled: past });
  const hidden = Math.max(0, posts.length - MAX_VISIBLE);
  return (
    <div
      ref={setNodeRef}
      onClick={() => !past && onCreateOnDay(day)}
      className={cn(
        "group relative flex min-h-[124px] flex-col gap-1 border-b border-l p-1.5 transition-colors",
        !isSameMonth(day, month) && "bg-muted/30 text-muted-foreground",
        past ? "bg-muted/35" : "cursor-pointer hover:bg-accent/40",
        isOver && "bg-primary/10 ring-2 ring-inset ring-primary/50",
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "grid h-6 min-w-6 place-items-center rounded-full px-1 text-xs font-semibold tabular-nums",
            isToday(day) && "bg-primary text-primary-foreground",
          )}
        >
          {format(day, "d")}
        </span>
        {!past && <Plus className="h-3.5 w-3.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />}
      </div>
      {posts.slice(0, MAX_VISIBLE).map((p) => (
        <PostCard key={p.key} post={p} variant="month" onOpen={onOpen} selected={selectedKey === p.key} />
      ))}
      {hidden > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onShowDay(day);
          }}
          className="self-start rounded px-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          +{hidden} more
        </button>
      )}
      {projections.length > 0 && (
        <span className="mt-auto flex items-center gap-1 text-[10.5px] text-muted-foreground" title={projections.map((p) => `${format(p.at, "HH:mm")} ${p.name}`).join("\n")}>
          <Zap className="h-3 w-3 text-primary/70" />
          {projections.length} autopilot {projections.length === 1 ? "run" : "runs"}
          {projections.some((p) => p.stalled) && <span className="text-amber-600">· stuck</span>}
        </span>
      )}
    </div>
  );
}

interface MonthViewProps {
  month: Date;
  days: Date[];
  posts: SchedulerPost[];
  projections: Projection[];
  onOpen: (p: SchedulerPost) => void;
  onCreateOnDay: (day: Date) => void;
  onShowDay: (day: Date) => void;
  selectedKey?: string | null;
}

export function MonthView({ month, days, posts, projections, onOpen, onCreateOnDay, onShowDay, selectedKey }: MonthViewProps) {
  const byDay = useMemo(() => {
    const map = new Map<string, SchedulerPost[]>();
    for (const p of posts) {
      const k = format(p.at, "yyyy-MM-dd");
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [posts]);

  return (
    <div className="h-full overflow-auto rounded-xl border bg-card">
      <div className="grid min-w-[760px] grid-cols-7">
        {days.slice(0, 7).map((d) => (
          <div key={`h-${d.toISOString()}`} className="sticky top-0 z-10 border-b border-l bg-card/95 px-2 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
            {format(d, "EEE")}
          </div>
        ))}
        {days.map((d) => (
          <DayCell
            key={d.toISOString()}
            day={d}
            month={month}
            posts={byDay.get(format(d, "yyyy-MM-dd")) ?? []}
            projections={projections.filter((p) => isSameDay(p.at, d))}
            onOpen={onOpen}
            onCreateOnDay={onCreateOnDay}
            onShowDay={onShowDay}
            selectedKey={selectedKey}
          />
        ))}
      </div>
    </div>
  );
}
