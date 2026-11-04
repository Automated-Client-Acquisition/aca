import { useMemo, useState } from "react";
import { format, isToday, isTomorrow, isYesterday } from "date-fns";
import { CheckCheck, Inbox, RotateCcw, Sparkles, Trash2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { ruleFor, shortError, statusLabel, type SchedulerPost } from "@/lib/scheduler";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import { StatsLine, StatusIcon } from "./PostCard";
import { AccountAvatar } from "./PlatformGlyph";

export type ListTab = "upcoming" | "approval" | "published" | "failed";

const TABS: Array<{ id: ListTab; label: string }> = [
  { id: "upcoming", label: "Upcoming" },
  { id: "approval", label: "Drafts & proposals" },
  { id: "published", label: "Published" },
  { id: "failed", label: "Failed" },
];

function dayLabel(d: Date) {
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE d MMMM");
}

interface ListViewProps {
  tab: ListTab;
  onTabChange: (tab: ListTab) => void;
  lists: Record<ListTab, SchedulerPost[]>;
  accountsById: Map<string, ConnectedAccount>;
  onOpen: (post: SchedulerPost) => void;
  onApprove: (posts: SchedulerPost[]) => void;
  onRetry: (posts: SchedulerPost[]) => void;
  onDelete: (posts: SchedulerPost[]) => void;
  busy?: boolean;
}

export function ListView({ tab, onTabChange, lists, accountsById, onOpen, onApprove, onRetry, onDelete, busy }: ListViewProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const posts = lists[tab];
  const ordered = tab === "published" || tab === "failed" ? [...posts].sort((a, b) => b.at.getTime() - a.at.getTime()) : posts;
  const groups = useMemo(() => {
    const out: Array<{ label: string; posts: SchedulerPost[] }> = [];
    for (const p of ordered) {
      const label = dayLabel(p.at);
      const last = out[out.length - 1];
      if (last?.label === label) last.posts.push(p);
      else out.push({ label, posts: [p] });
    }
    return out;
  }, [ordered]);
  const selectedPosts = ordered.filter((p) => selected.has(p.key));
  const toggle = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const clear = () => setSelected(new Set());

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border bg-card">
      <div className="flex flex-wrap items-center gap-1 border-b px-3 py-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              onTabChange(t.id);
              clear();
            }}
            className={cn(
              "flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm transition-colors",
              tab === t.id ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t.label}
            <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", tab === t.id ? "bg-background/20" : "bg-muted")}>{lists[t.id].length}</span>
          </button>
        ))}
        {selectedPosts.length > 0 && (
          <div className="ml-auto flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{selectedPosts.length} selected</span>
            {tab === "approval" && (
              <Button size="sm" variant="cta" disabled={busy} onClick={() => { onApprove(selectedPosts); clear(); }}>
                <CheckCheck className="mr-1.5 h-4 w-4" /> Approve
              </Button>
            )}
            {tab === "failed" && (
              <Button size="sm" variant="cta" disabled={busy} onClick={() => { onRetry(selectedPosts); clear(); }}>
                <RotateCcw className="mr-1.5 h-4 w-4" /> Retry
              </Button>
            )}
            {tab !== "published" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { onDelete(selectedPosts); clear(); }}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Remove
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto">
        {groups.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 py-20 text-center text-muted-foreground">
            <Inbox className="h-8 w-8" />
            <p className="text-sm">
              {tab === "upcoming" && "Nothing scheduled in this window."}
              {tab === "approval" && "No drafts or proposals. Ask the agent to plan your week."}
              {tab === "published" && "Nothing published in this window yet."}
              {tab === "failed" && "No failures in the last two weeks."}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.label}>
              <h3 className="sticky top-0 z-10 border-b bg-card/95 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur">
                {g.label}
              </h3>
              <ul className="divide-y">
                {g.posts.map((p) => {
                  const thumb = p.media.images[0];
                  return (
                    <li key={p.key} className={cn("group flex items-start gap-3 px-4 py-3 hover:bg-muted/40", selected.has(p.key) && "bg-primary/5")}>
                      {tab !== "published" && (
                        <Checkbox checked={selected.has(p.key)} onCheckedChange={() => toggle(p.key)} className="mt-1" aria-label="Select post" />
                      )}
                      <button type="button" onClick={() => onOpen(p)} className="flex min-w-0 flex-1 items-start gap-3 text-left">
                        <div className="w-12 shrink-0 pt-0.5 text-sm font-semibold tabular-nums">{format(p.at, "HH:mm")}</div>
                        <div className="flex shrink-0 -space-x-2 pt-0.5">
                          {p.rows.slice(0, 4).map((r) => {
                            const acc = accountsById.get(r.account_id);
                            return <AccountAvatar key={r.id} name={acc?.name ?? r.platform ?? "?"} avatarUrl={acc?.avatarUrl} platform={r.platform ?? ""} size={28} className="rounded-full ring-2 ring-card" />;
                          })}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="line-clamp-2 text-sm leading-snug">{p.caption || p.title}</p>
                          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            <span className="max-w-[320px] truncate">
                              To {p.rows.map((r) => accountsById.get(r.account_id)?.name ?? ruleFor(r.platform).label).join(", ")}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <StatusIcon post={p} />
                              {statusLabel(p)}
                            </span>
                            {p.origin === "autopilot" && (
                              <span className="inline-flex items-center gap-1"><Zap className="h-3 w-3 text-primary" />{p.autopilotName ?? "Autopilot"}</span>
                            )}
                            {p.origin === "agent" && (
                              <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3 text-[hsl(var(--status-purple))]" />Agent</span>
                            )}
                            {p.error && <span className="text-[hsl(var(--status-error))]">{shortError(p.error)}</span>}
                          </div>
                          <StatsLine post={p} withReach className="mt-1 text-xs [&_svg]:h-3 [&_svg]:w-3" />
                        </div>
                        {thumb && <img src={thumb} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-md object-cover" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
      </div>
    </div>
  );
}
