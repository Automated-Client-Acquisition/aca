import { Plus, X } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { WEEKDAYS, parseTime } from "@/lib/autopilot-schedule";
import { TIME_OPTIONS } from "@/lib/autopilot-plan";
import type { ScheduleSlot } from "@/types/autopilot";

const ROTATE = "__rotate__";

export interface PlannerBlueprint {
  blueprint_id: string;
  name: string;
  color: string;
}

/** A free time on `day` near 09:00, after the day's last slot. */
function nextFreeTime(slots: ScheduleSlot[], day: number): string {
  const taken = new Set(slots.filter((s) => s.day === day).map((s) => s.time));
  const last = Math.max(...slots.filter((s) => s.day === day).map((s) => parseTime(s.time) ?? 0), -1);
  const start = last < 0 ? 9 * 60 : Math.min(last + 4 * 60, 21 * 60);
  for (let m = start; m < 24 * 60; m += 30) {
    const t = `${String(Math.floor(m / 60)).padStart(2, "0")}:${m % 60 ? "30" : "00"}`;
    if (!taken.has(t)) return t;
  }
  return TIME_OPTIONS.find((t) => !taken.has(t)) ?? "09:00";
}

/**
 * "Plan each day": a row of slots per weekday. Each slot either takes
 * the next blueprint in the rotation or is pinned to one.
 */
export function WeekPlanner({
  slots,
  onChange,
  blueprints,
}: {
  slots: ScheduleSlot[];
  onChange: (next: ScheduleSlot[]) => void;
  blueprints: PlannerBlueprint[];
}) {
  const update = (index: number, patch: Partial<ScheduleSlot>) => onChange(slots.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  const remove = (index: number) => onChange(slots.filter((_, i) => i !== index));
  const add = (day: number) => onChange([...slots, { day, time: nextFreeTime(slots, day), blueprint_id: null }]);

  return (
    <div className="divide-y rounded-lg border">
      {WEEKDAYS.map((d) => {
        const daySlots = slots
          .map((s, index) => ({ s, index }))
          .filter(({ s }) => s.day === d.id)
          .sort((a, b) => (parseTime(a.s.time) ?? 0) - (parseTime(b.s.time) ?? 0));
        return (
          <div key={d.id} className="flex items-start gap-3 px-2.5 py-2">
            <span className={cn("w-9 shrink-0 pt-1.5 text-xs font-semibold", daySlots.length === 0 && "text-muted-foreground")}>{d.short}</span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
              {daySlots.map(({ s, index }) => {
                const pinned = blueprints.find((b) => b.blueprint_id === s.blueprint_id);
                return (
                  <div key={index} className="flex items-center rounded-md border bg-background">
                    <Select value={s.time} onValueChange={(v) => update(index, { time: v })}>
                      <SelectTrigger className="h-8 w-[4.5rem] rounded-none rounded-l-md border-0 px-2 text-xs tabular-nums shadow-none" aria-label={`${d.long} time`}>
                        {s.time}
                      </SelectTrigger>
                      <SelectContent className="max-h-64">
                        {TIME_OPTIONS.map((t) => (
                          <SelectItem key={t} value={t} className="text-xs tabular-nums">{t}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={pinned ? pinned.blueprint_id : ROTATE} onValueChange={(v) => update(index, { blueprint_id: v === ROTATE ? null : v })}>
                      <SelectTrigger className="h-8 max-w-[13rem] rounded-none border-0 border-l px-2 text-xs shadow-none" aria-label={`What ${d.long} ${s.time} posts`} title={pinned ? `Always ${pinned.name}` : "Next blueprint in the mix"}>
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: pinned?.color ?? "hsl(var(--muted-foreground) / 0.35)" }} />
                          <span className="truncate">{pinned ? pinned.name : "Rotate"}</span>
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ROTATE} className="text-xs">Rotate (next in the mix)</SelectItem>
                        {blueprints.map((b) => (
                          <SelectItem key={b.blueprint_id} value={b.blueprint_id} className="text-xs">
                            <span className="flex items-center gap-1.5">
                              <span className="h-2 w-2 rounded-sm" style={{ background: b.color }} />
                              Always {b.name}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <button
                      type="button"
                      onClick={() => remove(index)}
                      aria-label={`Remove ${d.long} ${s.time}`}
                      className="flex h-8 w-7 items-center justify-center border-l text-muted-foreground hover:bg-muted hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() => add(d.id)}
                aria-label={`Add a time on ${d.long}`}
                className="inline-flex h-8 items-center gap-1 rounded-md border border-dashed px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3 w-3" /> {daySlots.length ? "Time" : "Add a time"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
