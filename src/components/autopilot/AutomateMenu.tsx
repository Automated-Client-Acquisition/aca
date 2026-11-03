import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, Loader2, Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAutopilots, useUpdateAutopilot } from "@/hooks/useAutopilots";
import { useConnectedAccounts } from "@/hooks/useConnectedAccounts";
import { getPlatformConfig } from "@/components/autopilot/PlatformBadge";
import { autopilotPath, autopilotsForBlueprint, newAutopilotPath } from "@/lib/blueprint-routes";
import { describeSchedule } from "@/lib/autopilot-schedule";
import { joinNames, plannedPerWeek } from "@/lib/autopilot-plan";
import { cn } from "@/lib/utils";
import type { Autopilot } from "@/types/autopilot";

/**
 * A blueprint's way onto autopilot: the autopilots already rotating it, the
 * others it can join, or a new one. Autopilots themselves are edited on
 * /autopilots/:id, so this never duplicates the editor.
 */
export function AutomateMenu({
  blueprint,
  canRun = true,
  size = "sm",
  variant,
  beforeNavigate,
}: {
  blueprint: { id: string; name: string };
  /** A blueprint that can't run can't be added anywhere, but its autopilots stay reachable. */
  canRun?: boolean;
  size?: "sm" | "default";
  /** Button style when the blueprint isn't on autopilot yet. */
  variant?: "cta" | "outline";
  /** Called before leaving the page (the Studio flushes its autosave). */
  beforeNavigate?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState<string | null>(null);
  const { data: autopilots } = useAutopilots();
  const update = useUpdateAutopilot();
  const { accounts } = useConnectedAccounts();
  const using = autopilotsForBlueprint(autopilots, blueprint.id);
  const others = (autopilots ?? []).filter((a) => a.status !== "archived" && !using.some((u) => u.id === a.id));
  const lead = using[0];

  const go = async (to: string) => {
    setOpen(false);
    await beforeNavigate?.();
    navigate(to);
  };

  const where = (a: Autopilot) => {
    const names = (a.destinations ?? [])
      .filter((d) => d.enabled)
      .map((d) => accounts.find((x) => x.id === d.account_id)?.name ?? getPlatformConfig(d.platform).label);
    return names.length ? joinNames([...new Set(names)].slice(0, 2)) + (names.length > 2 ? ` +${names.length - 2}` : "") : "Drafts";
  };

  const addTo = async (a: Autopilot) => {
    setAdding(a.id);
    try {
      // Join at an average share, whatever scale the existing weights use.
      const shown = (a.content_mix ?? []).filter((m) => m.enabled !== false && (m.weight || 0) > 0);
      const weight = shown.length ? Math.max(1, Math.round(shown.reduce((n, m) => n + m.weight, 0) / shown.length)) : 1;
      await update.mutateAsync({
        id: a.id,
        content_mix: [
          ...(a.content_mix ?? []),
          { blueprint_id: blueprint.id, weight, enabled: true, ...(a.ideas_source === "per_blueprint" ? { idea_tags: [] } : {}) },
        ],
      });
      await go(autopilotPath(a));
    } finally {
      setAdding(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {lead ? (
          <Button variant="outline" size={size} className={cn(size === "sm" && "h-8")}>
            <span className={cn("mr-1.5 h-2 w-2 rounded-full", lead.status === "active" ? "bg-emerald-500" : "bg-amber-500")} />
            {using.length > 1 ? `In ${using.length} autopilots` : lead.status === "active" ? "On autopilot" : "Autopilot paused"}
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        ) : (
          <Button variant={variant ?? "outline"} size={size} className={cn(size === "sm" && "h-8")} disabled={!canRun && others.length === 0}>
            <Zap className="mr-1.5 h-3.5 w-3.5" />
            Automate
            <ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] space-y-3 p-4" onClick={(e) => e.stopPropagation()}>
        <div>
          <p className="text-sm font-semibold">{blueprint.name} on autopilot</p>
          <p className="text-xs text-muted-foreground">An autopilot rotates blueprints on a schedule for your accounts.</p>
        </div>

        {using.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Already in</p>
            {using.map((a) => (
              <div key={a.id} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", a.status === "active" ? "bg-emerald-500" : "bg-amber-500")} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{where(a)} · {describeSchedule(a)}</span>
                </span>
                <Button variant="outline" size="sm" className="h-8" onClick={() => go(autopilotPath(a))}>Open</Button>
              </div>
            ))}
          </div>
        )}

        {canRun && others.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Add it to</p>
            <div className="max-h-56 space-y-1.5 overflow-y-auto">
              {others.map((a) => (
                <div key={a.id} className="flex items-center gap-2.5 rounded-lg border px-2.5 py-2">
                  <span className={cn("h-2 w-2 shrink-0 rounded-full", a.status === "active" ? "bg-emerald-500" : "bg-amber-500")} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{a.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {where(a)} · {plannedPerWeek(a)} a week · {(a.content_mix ?? []).filter((m) => m.enabled !== false).length} blueprint
                      {(a.content_mix ?? []).filter((m) => m.enabled !== false).length === 1 ? "" : "s"}
                    </span>
                  </span>
                  <Button variant="outline" size="sm" className="h-8" disabled={adding !== null} onClick={() => addTo(a)}>
                    {adding === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Add"}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {canRun ? (
          <Button variant="cta" className="w-full" onClick={() => go(newAutopilotPath({ blueprintId: blueprint.id }))}>
            <Plus className="mr-1.5 h-4 w-4" />
            New autopilot with this blueprint
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Fix this blueprint's setup before it can go on autopilot.</p>
        )}
        <p className="text-xs text-muted-foreground">
          All your autopilots are on <Link to="/autopilots" className="underline underline-offset-2" onClick={() => setOpen(false)}>Autopilots</Link>.
        </p>
      </PopoverContent>
    </Popover>
  );
}
