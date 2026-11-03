import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, Minus, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { formatLabelForBlueprint } from "@/components/blueprints/BlueprintCard";
import { getPlatformConfig } from "@/components/autopilot/PlatformBadge";
import { type PlanLike, type Posting, type Topics, isShown, joinNames, kindOf, routeFor } from "@/lib/autopilot-plan";
import type { ConnectedAccount } from "@/hooks/useConnectedAccounts";
import type { Blueprint } from "@/types/blueprint";
import type { ContentMixItem } from "@/types/autopilot";

const num = (n: number) => String(Math.round(n * 10) / 10);

interface MixEditorProps {
  mix: ContentMixItem[];
  onChange: (mix: ContentMixItem[]) => void;
  /** Remove a mix entry (the parent also clears slots pinned to it). */
  onRemove: (index: number) => void;
  blueprints: Blueprint[];
  colorOf: (index: number) => string;
  shareInfo: Map<number, { share: number; pinned: number }>;
  /** Weekly slots the rotation fills. */
  rotatingPerWeek: number;
  hasPins: boolean;
  plan: PlanLike;
  posting: Posting;
  accounts: ConnectedAccount[];
  topics: Topics;
  tags: string[];
  tagCounts: Record<string, number>;
}

export function MixEditor({
  mix,
  onChange,
  onRemove,
  blueprints,
  colorOf,
  shareInfo,
  rotatingPerWeek,
  hasPins,
  plan,
  posting,
  accounts,
  topics,
  tags,
  tagCounts,
}: MixEditorProps) {
  const [adding, setAdding] = useState(false);
  const rows = mix.map((m, index) => ({ m, index })).filter(({ m }) => isShown(m));
  const rotatingParts = rows.reduce((n, { m }) => n + Math.max(0, m.weight || 0), 0);
  const enabledDestinations = posting === "publish" ? plan.destinations.filter((d) => d.enabled) : [];
  const nameOnly = (id: string) => {
    const acc = accounts.find((a) => a.id === id);
    return acc ? acc.name || acc.username || getPlatformConfig(acc.platform).label : "Unknown account";
  };
  // Two accounts can share a name (an Instagram and a TikTok handle): add the platform then.
  const accountName = (id: string) => {
    const name = nameOnly(id);
    const twin = enabledDestinations.some((d) => d.account_id !== id && nameOnly(d.account_id) === name);
    const acc = accounts.find((a) => a.id === id);
    return twin && acc ? `${name} (${getPlatformConfig(acc.platform).label})` : name;
  };
  const patch = (index: number, next: Partial<ContentMixItem>) => onChange(mix.map((m, i) => (i === index ? { ...m, ...next } : m)));
  const inMix = new Set(rows.map(({ m }) => m.blueprint_id));
  const addable = blueprints.filter((b) => !inMix.has(b.id));

  const add = (blueprint: Blueprint) => {
    onChange([...mix, { blueprint_id: blueprint.id, weight: 1, enabled: true, ...(topics === "per" ? { idea_tags: [] } : {}) }]);
    setAdding(false);
  };

  return (
    <div className="space-y-3">
      {rows.length > 1 && (
        <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
          {rows.map(({ m, index }, pos) => {
            const info = shareInfo.get(index);
            const grow = Math.max(info?.share ?? 0, 0) * 100 + (info?.pinned ?? 0) * 4;
            return <span key={index} style={{ flexGrow: grow || 1, background: colorOf(pos) }} />;
          })}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
          Add the blueprints this autopilot takes turns on. Each post uses one of them.
        </p>
      ) : (
        <ul className="divide-y rounded-lg border">
          {rows.map(({ m, index }, pos) => {
            const bp = blueprints.find((b) => b.id === m.blueprint_id);
            const info = shareInfo.get(index) ?? { share: 0, pinned: 0 };
            const weight = Math.max(0, m.weight || 0);
            const min = info.pinned > 0 ? 0 : 1;
            const kind = kindOf(bp, m);
            const route = routeFor(plan, m, kind);
            const subset = m.destination_account_ids ?? [];
            const rowTags = m.idea_tags ?? [];

            let shareText: string;
            if (weight === 0) {
              shareText = `Only in its pinned slot${info.pinned === 1 ? "" : "s"}, ${info.pinned} a week`;
            } else {
              const rotating = rows.filter(({ m: x }) => (x.weight || 0) > 0).length;
              const of = rotating === 1 ? `Every ${hasPins ? "rotating " : ""}post` : `${weight} of every ${rotatingParts} ${hasPins ? "rotating " : ""}posts`;
              const weekly = rotatingPerWeek > 0 ? `, about ${num((rotatingPerWeek * weight) / Math.max(rotatingParts, 1))} a week` : "";
              const pinned = info.pinned > 0 ? `, plus ${info.pinned} pinned` : "";
              shareText = `${of}${weekly}${pinned}`;
            }

            return (
              <li key={index} className="space-y-2 p-3">
                <div className="flex items-center gap-3">
                  <span className="h-3 w-3 shrink-0 rounded-[3px]" style={{ background: colorOf(pos) }} aria-hidden />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {bp ? (
                        <Link to={`/blueprints/${bp.id}`} className="truncate text-sm font-semibold hover:underline">{bp.name}</Link>
                      ) : (
                        <span className="text-sm font-semibold text-muted-foreground">Deleted blueprint</span>
                      )}
                      {bp && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{formatLabelForBlueprint(bp.pipeline)}</span>}
                    </div>
                    <p className="text-xs tabular-nums text-muted-foreground">{shareText}</p>
                  </div>
                  <div className="flex items-center rounded-lg border" role="group" aria-label={`How often ${bp?.name ?? "this blueprint"} posts`}>
                    <button
                      type="button"
                      disabled={weight <= min}
                      onClick={() => patch(index, { weight: Math.max(min, weight - 1) })}
                      aria-label={`Post ${bp?.name ?? "this blueprint"} less often`}
                      className="flex h-8 w-8 items-center justify-center rounded-l-lg hover:bg-muted disabled:opacity-30"
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-6 text-center text-sm font-semibold tabular-nums">{weight}</span>
                    <button
                      type="button"
                      disabled={weight >= 9}
                      onClick={() => patch(index, { weight: Math.min(9, weight + 1) })}
                      aria-label={`Post ${bp?.name ?? "this blueprint"} more often`}
                      className="flex h-8 w-8 items-center justify-center rounded-r-lg hover:bg-muted disabled:opacity-30"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => onRemove(index)}
                    disabled={rows.length <= 1}
                    aria-label={`Remove ${bp?.name ?? "this blueprint"} from this autopilot`}
                    className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive disabled:pointer-events-none disabled:opacity-30"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                {(enabledDestinations.length > 1 || topics === "per") && (
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pl-6 text-xs">
                    {enabledDestinations.length > 1 && (
                      <span className="flex items-center gap-1.5">
                        <span className="text-muted-foreground">Posts to</span>
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="inline-flex max-w-[16rem] items-center gap-1 rounded-md border px-2 py-1 font-medium hover:bg-muted">
                              <span className="truncate">{subset.length ? joinNames(subset.map(accountName)) : "All its accounts"}</span>
                              <ChevronDown className="h-3 w-3 shrink-0" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="w-64 p-2">
                            <p className="px-1 pb-2 text-xs text-muted-foreground">Which accounts get {bp?.name ?? "this blueprint"}</p>
                            {enabledDestinations.map((d) => {
                              const on = subset.length === 0 || subset.includes(d.account_id);
                              return (
                                <label key={d.account_id} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted">
                                  <Checkbox
                                    checked={on}
                                    onCheckedChange={() => {
                                      const current = subset.length ? subset : enabledDestinations.map((x) => x.account_id);
                                      const next = on ? current.filter((x) => x !== d.account_id) : [...current, d.account_id];
                                      if (next.length === 0) return;
                                      const all = enabledDestinations.every((x) => next.includes(x.account_id));
                                      patch(index, { destination_account_ids: all ? undefined : next });
                                    }}
                                  />
                                  <span className="min-w-0 flex-1 truncate">{accountName(d.account_id)}</span>
                                  <span className="text-[11px] text-muted-foreground">{getPlatformConfig(d.platform).label}</span>
                                </label>
                              );
                            })}
                          </PopoverContent>
                        </Popover>
                      </span>
                    )}
                    {topics === "per" && (
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-muted-foreground">Topics</span>
                        {rowTags.length === 0 && <span className="text-muted-foreground">any idea</span>}
                        {rowTags.map((t) => (
                          <span key={t} className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">{t}</span>
                        ))}
                        <Popover>
                          <PopoverTrigger asChild>
                            <button type="button" className="rounded-full border border-dashed px-2 py-0.5 text-[11px] font-medium hover:bg-muted">Change</button>
                          </PopoverTrigger>
                          <PopoverContent align="start" className="max-h-72 w-60 overflow-y-auto p-2">
                            {tags.length === 0 && (
                              <p className="p-1 text-xs text-muted-foreground">
                                No idea tags yet. <Link to="/ideas" className="underline">Tag some ideas</Link>.
                              </p>
                            )}
                            {[...tags, ...rowTags.filter((t) => !tags.includes(t))].map((t) => {
                              const on = rowTags.includes(t);
                              return (
                                <label key={t} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 text-sm hover:bg-muted">
                                  <Checkbox checked={on} onCheckedChange={() => patch(index, { idea_tags: on ? rowTags.filter((x) => x !== t) : [...rowTags, t] })} />
                                  <span className="flex-1 truncate">{t}</span>
                                  <span className="text-[11px] tabular-nums text-muted-foreground">{tagCounts[t] ?? 0}</span>
                                </label>
                              );
                            })}
                          </PopoverContent>
                        </Popover>
                      </span>
                    )}
                  </div>
                )}

                {posting === "publish" && route.skipped.length > 0 && (
                  <p className="ml-6 flex items-start gap-1.5 rounded-md bg-amber-500/10 px-2.5 py-1.5 text-xs text-amber-800 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                    <span>
                      Skips {joinNames(route.skipped.map((s) => accountName(s.destination.account_id)))}. {[...new Set(route.skipped.map((s) => s.reason))].join(". ")}.
                    </span>
                  </p>
                )}
                {posting === "publish" && enabledDestinations.length > 0 && route.to.length === 0 && (
                  <p className="ml-6 text-xs font-medium text-destructive">None of its accounts can post this, so its pieces stay in Content.</p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Popover open={adding} onOpenChange={setAdding}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="border-dashed">
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add a blueprint
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[26rem] max-w-[calc(100vw-2rem)] p-0">
          <Command>
            <CommandInput placeholder="Search blueprints" />
            <CommandList className="max-h-72">
              <CommandEmpty>
                <span className="text-sm">No blueprint found.</span>{" "}
                <Link to="/blueprints" className="text-sm underline">Make one</Link>
              </CommandEmpty>
              <CommandGroup>
                {addable.map((b) => {
                  const kind = kindOf(b);
                  const wouldSkip = routeFor(plan, undefined, kind).skipped;
                  return (
                    <CommandItem key={b.id} value={`${b.name} ${b.id}`} onSelect={() => add(b)} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-3.5 w-3.5 opacity-0" />
                      <span className="flex min-w-0 flex-col">
                        <span className="line-clamp-2 text-sm font-medium">{b.name}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {formatLabelForBlueprint(b.pipeline)}
                          {posting === "publish" && wouldSkip.length > 0 && ` · skips ${joinNames(wouldSkip.map((s) => getPlatformConfig(s.destination.platform).label))}`}
                        </span>
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
