import { useEffect, useMemo, useRef, useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { format, isSameDay, isToday } from "date-fns";
import { AlertTriangle, Plus, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { multiScore, scoreLabel, type SchedulerPost } from "@/lib/scheduler";
import { PostCard } from "./PostCard";
import { PlatformStack } from "./PlatformGlyph";

export interface Projection {
  key: string;
  autopilotId: string;
  name: string;
  at: Date;
  platforms: string[];
  /** Why this run won't produce a post (the autopilot is stuck). */
  stalled?: string;
}

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const FIRST_VISIBLE_HOUR = 7;

function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

interface CellProps {
  day: Date;
  hour: number;
  now: Date;
  heat: number;
  posts: SchedulerPost[];
  projections: Projection[];
  onOpen: (post: SchedulerPost) => void;
  onCreate: (at: Date) => void;
  onOpenAutopilot: (id: string) => void;
  selectedKey?: string | null;
}

function HourCell({ day, hour, now, heat, posts, projections, onOpen, onCreate, onOpenAutopilot, selectedKey }: CellProps) {
  const at = useMemo(() => new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0), [day, hour]);
  const past = at.getTime() + 3600_000 <= now.getTime();
  const { setNodeRef, isOver } = useDroppable({ id: `slot:${at.toISOString()}`, data: { at, granularity: "hour" }, disabled: past });
  const isNowCell = isSameDay(day, now) && now.getHours() === hour;
  const label = scoreLabel(heat);

  return (
    <div
      ref={setNodeRef}
      role="gridcell"
      onClick={() => !past && onCreate(at)}
      className={cn(
        "group relative min-h-[56px] border-b border-l border-border/60 p-1 transition-colors",
        past ? "bg-muted/35" : "cursor-pointer hover:bg-accent/50",
        !past && heat >= 0.85 && "bg-[hsl(var(--status-success)/0.07)]",
        !past && heat >= 0.6 && heat < 0.85 && "bg-[hsl(var(--status-success)/0.035)]",
        isOver && "bg-primary/10 ring-2 ring-inset ring-primary/50",
      )}
      title={!past && label ? `${label === "Peak time" ? "One of the best times" : "A good time"} this week for your channels` : undefined}
    >
      {isNowCell && (
        <div className="pointer-events-none absolute inset-x-0 z-10" style={{ top: `${(now.getMinutes() / 60) * 100}%` }}>
          <div className="relative h-px bg-primary">
            <span className="absolute -left-1 -top-[3px] h-[7px] w-[7px] rounded-full bg-primary" />
          </div>
        </div>
      )}
      <div className="flex flex-col gap-1">
        {posts.map((p) => (
          <PostCard key={p.key} post={p} variant="week" onOpen={onOpen} selected={selectedKey === p.key} />
        ))}
        {projections.map((pr) => (
          <button
            key={pr.key}
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenAutopilot(pr.autopilotId);
            }}
            className={cn(
              "flex w-full min-w-0 flex-col gap-0.5 rounded-md border border-dashed px-1.5 py-1 text-left text-[10.5px] text-muted-foreground hover:text-foreground",
              pr.stalled
                ? "border-amber-500/50 bg-amber-500/[0.06] hover:border-amber-500"
                : "border-primary/30 bg-primary/[0.03] hover:border-primary/60",
            )}
            title={pr.stalled ? `${pr.name}: ${pr.stalled}. This run won't post.` : `${pr.name} will run here. Its post shows up once it's made.`}
          >
            <span className="flex items-center gap-1">
              {pr.stalled ? <AlertTriangle className="h-3 w-3 shrink-0 text-amber-600" /> : <Zap className="h-3 w-3 shrink-0 text-primary/70" />}
              <span className="tabular-nums">{format(pr.at, "HH:mm")}</span>
              <PlatformStack platforms={pr.platforms} max={2} className="ml-auto scale-90" />
            </span>
            <span className={cn("truncate", pr.stalled && "text-amber-700 dark:text-amber-400")}>{pr.stalled ? pr.stalled : pr.name.split(" · ")[0]}</span>
          </button>
        ))}
      </div>
      {!past && posts.length === 0 && projections.length === 0 && (
        <span className="pointer-events-none absolute inset-0 hidden items-center justify-center text-muted-foreground/70 group-hover:flex">
          <Plus className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

interface WeekViewProps {
  days: Date[];
  posts: SchedulerPost[];
  projections: Projection[];
  heatPlatforms: string[];
  onOpen: (post: SchedulerPost) => void;
  onCreate: (at: Date) => void;
  onOpenAutopilot: (id: string) => void;
  selectedKey?: string | null;
}

export function WeekView({ days, posts, projections, heatPlatforms, onOpen, onCreate, onOpenAutopilot, selectedKey }: WeekViewProps) {
  const now = useNow();
  const scrollRef = useRef<HTMLDivElement>(null);
  const firstRowRef = useRef<HTMLDivElement>(null);

  // Open on the working day, not midnight.
  useEffect(() => {
    if (scrollRef.current && firstRowRef.current) {
      scrollRef.current.scrollTop = firstRowRef.current.offsetTop - 44;
    }
  }, []);

  // Shade relative to this week's best hours: averaging several channels'
  // peaks flattens the raw score, so an absolute threshold tints almost nothing.
  const maxHeat = useMemo(() => {
    let max = 0;
    for (let d = 0; d < 7; d++) for (const h of HOURS) max = Math.max(max, multiScore(heatPlatforms, d, h));
    return max || 1;
  }, [heatPlatforms]);

  const byCell = useMemo(() => {
    const map = new Map<string, SchedulerPost[]>();
    for (const p of posts) {
      const k = `${format(p.at, "yyyy-MM-dd")}:${p.at.getHours()}`;
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [posts]);
  const projByCell = useMemo(() => {
    const map = new Map<string, Projection[]>();
    for (const p of projections) {
      const k = `${format(p.at, "yyyy-MM-dd")}:${p.at.getHours()}`;
      map.set(k, [...(map.get(k) ?? []), p]);
    }
    return map;
  }, [projections]);

  return (
    <div ref={scrollRef} className="relative h-full overflow-auto rounded-xl border bg-card" role="grid" aria-label="Week calendar">
      <div className="grid min-w-[760px] grid-cols-[56px_repeat(7,minmax(0,1fr))]">
        {/* Day header */}
        <div className="sticky top-0 z-20 border-b bg-card/95 backdrop-blur" />
        {days.map((d) => {
          const count = posts.filter((p) => isSameDay(p.at, d)).length;
          const today = isToday(d);
          return (
            <div key={d.toISOString()} className="sticky top-0 z-20 flex items-center justify-between gap-1 border-b border-l bg-card/95 px-2 py-2 backdrop-blur">
              <div className="flex items-baseline gap-1.5">
                <span className={cn("text-xs font-medium uppercase tracking-wide", today ? "text-primary" : "text-muted-foreground")}>{format(d, "EEE")}</span>
                <span
                  className={cn(
                    "grid h-7 min-w-7 place-items-center rounded-full px-1 text-sm font-semibold tabular-nums",
                    today && "bg-primary text-primary-foreground",
                  )}
                >
                  {format(d, "d")}
                </span>
              </div>
              {count > 0 && <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium tabular-nums text-muted-foreground">{count}</span>}
            </div>
          );
        })}

        {HOURS.map((h) => (
          <div key={h} className="contents">
            <div
              ref={h === FIRST_VISIBLE_HOUR ? firstRowRef : undefined}
              className="relative border-b border-border/60 pr-2 text-right text-[10.5px] tabular-nums text-muted-foreground"
            >
              <span className="relative -top-2">{h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}</span>
            </div>
            {days.map((d) => {
              const k = `${format(d, "yyyy-MM-dd")}:${h}`;
              return (
                <HourCell
                  key={k}
                  day={d}
                  hour={h}
                  now={now}
                  heat={multiScore(heatPlatforms, d.getDay(), h) / maxHeat}
                  posts={byCell.get(k) ?? []}
                  projections={projByCell.get(k) ?? []}
                  onOpen={onOpen}
                  onCreate={onCreate}
                  onOpenAutopilot={onOpenAutopilot}
                  selectedKey={selectedKey}
                />
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
