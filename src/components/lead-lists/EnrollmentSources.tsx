import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ChevronsUpDown, ExternalLink, Filter, Plus, Users, Workflow, X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { LeadList } from "@/hooks/useLeadLists";
import type { PipelineInflow } from "@/hooks/useEnrollmentInflows";

export function EnrollmentSources({
  destination,
  availableLists,
  attachedListIds,
  inflows,
  onAttach,
  onDetach,
  pipelineOwnedListIds,
  autoEnroll,
  isLoading,
  invalid,
  pickerFooter,
  className,
}: {
  destination: "sequence" | "campaign";
  availableLists: LeadList[];
  attachedListIds: string[];
  inflows: PipelineInflow[];
  onAttach: (listId: string) => void;
  onDetach: (listId: string) => void;
  pipelineOwnedListIds: Set<string>;
  /** The destination's mode; omit while it is unknown. */
  autoEnroll?: boolean;
  isLoading?: boolean;
  invalid?: boolean;
  pickerFooter?: React.ReactNode;
  className?: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const attachable = availableLists.filter((list) => list.status === "active" && !attachedListIds.includes(list.id));
  const hasAnySource = attachedListIds.length > 0 || inflows.length > 0;
  const pipelineOnly = attachedListIds.length === 0 && inflows.some((inflow) => inflow.enabled);

  return (
    <div className={cn("space-y-3", className)}>
      {!hasAnySource && (
        <div className="rounded-lg border border-dashed bg-muted/20 p-4">
          <p className="text-sm font-medium">Choose an audience source</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Use a smart segment for members who match saved rules, or a list for contacts you add. You can also receive approved members from a source’s processing workflow.
          </p>
        </div>
      )}

      {attachedListIds.map((listId) => {
        const list = availableLists.find((item) => item.id === listId);
        const conflict = inflows.find((inflow) => inflow.list_id === listId && inflow.enabled);
        return (
          <div key={listId} className={cn(
            "rounded-lg border p-3 text-sm",
            conflict ? "border-amber-400/60 bg-amber-500/5" : "bg-muted/20",
          )}>
            <div className="flex items-start gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background">
                {list?.is_smart ? <Filter className="h-4 w-4 text-amber-600 dark:text-amber-400" /> : <Users className="h-4 w-4 text-muted-foreground" />}
              </span>
              <div className="min-w-0 flex-1">
                <Link to={`/leads/lists/${listId}`} className="font-medium hover:underline" title={list?.name ?? "Unavailable source"}>
                  {list?.name ?? "Unavailable source"}
                </Link>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span>{list?.is_smart ? "Smart segment" : "List"}</span>
                  <span aria-hidden>·</span>
                  <span>Direct source</span>
                  {list && <><span aria-hidden>·</span><span className="tabular-nums">{list.lead_count.toLocaleString()} {list.is_smart ? "matching now" : "members"}</span></>}
                  {list?.status === "archived" && <Badge variant="outline" className="py-0 text-[10px]">Archived</Badge>}
                </div>
              </div>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
                <Link to={`/leads/lists/${listId}`} aria-label={`Open ${list?.name ?? "source"}`}>
                  <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              </Button>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onDetach(listId)} aria-label={`Remove ${list?.name ?? "source"}`}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
              {autoEnroll === true
                ? "Current members and future additions are checked for enrollment while this outreach is active."
                : autoEnroll === false
                  ? "Current members form the one-time audience. Future additions are not enrolled automatically."
                  : "Members are checked against this destination’s enrollment rules."}
            </p>
            {conflict && (
              <ConflictNote unapproved={conflict.awaiting + conflict.rejected} onResolve={() => onDetach(listId)} />
            )}
          </div>
        );
      })}

      {inflows.filter((inflow) => !attachedListIds.includes(inflow.list_id)).map((inflow) => (
        <div key={inflow.list_id} className="rounded-lg border bg-muted/20 p-3 text-sm">
          <div className="flex items-start gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-background"><Workflow className="h-4 w-4 text-muted-foreground" /></span>
            <div className="min-w-0 flex-1">
              <Link to={`/leads/lists/${inflow.list_id}`} className="font-medium hover:underline">{inflow.list_name}</Link>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>After processing</span>
                <Badge variant="outline" className={cn("py-0 text-[10px]", inflow.enabled && "border-emerald-500/30 text-emerald-700 dark:text-emerald-400")}>{inflow.enabled ? "Auto run on" : "Auto run off"}</Badge>
              </div>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
              <Link to={`/leads/lists/${inflow.list_id}`} aria-label={`Manage processing on ${inflow.list_name}`}><ExternalLink className="h-3.5 w-3.5" /></Link>
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            Members enter after passing this source’s processing rules.
            {inflow.enabled
              ? ` ${inflow.approved.toLocaleString()} completed processing · ${inflow.awaiting.toLocaleString()} awaiting processing${inflow.rejected > 0 ? ` · ${inflow.rejected.toLocaleString()} rejected` : ""}.`
              : " Automatic processing is off; manage the workflow on the source."}
          </p>
        </div>
      ))}

      <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" aria-expanded={pickerOpen} aria-label="Add an audience source" className={cn("h-10 w-full justify-between", invalid && "border-destructive")}>
            <span className="flex items-center gap-2"><Plus className="h-4 w-4" />{hasAnySource ? "Add another source" : "Add a smart segment or list"}</span>
            <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0">
          <Command>
            <CommandInput placeholder="Search segments and lists…" />
            <CommandList>
              <CommandEmpty>{isLoading ? "Loading sources…" : "No available sources match."}</CommandEmpty>
              {[true, false].map((isSmart) => {
                const lists = attachable.filter((list) => list.is_smart === isSmart);
                if (lists.length === 0) return null;
                return (
                  <CommandGroup key={String(isSmart)} heading={isSmart ? "Smart segments · live rules" : "Lists · added contacts"}>
                    {lists.map((list) => {
                      const owned = pipelineOwnedListIds.has(list.id);
                      return (
                        <CommandItem
                          key={list.id}
                          value={`${list.name} ${list.id}`}
                          disabled={owned}
                          onSelect={() => {
                            if (owned) return;
                            onAttach(list.id);
                            setPickerOpen(false);
                          }}
                          className="items-start gap-2 py-2.5"
                        >
                          {isSmart ? <Filter className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" /> : <Users className="mt-0.5 h-4 w-4 shrink-0" />}
                          <div className="min-w-0 flex-1">
                            <span className="block truncate font-medium">{list.name}</span>
                            <span className="text-xs text-muted-foreground">{owned ? `Already feeds this ${destination} after processing` : `${list.lead_count.toLocaleString()} ${isSmart ? "matching now" : "members"}`}</span>
                          </div>
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                );
              })}
            </CommandList>
          </Command>
          {pickerFooter && <div className="border-t p-1" onClick={() => setPickerOpen(false)}>{pickerFooter}</div>}
        </PopoverContent>
      </Popover>

      {pipelineOnly && <p className="text-xs text-muted-foreground">Processing already feeds this {destination}. Add another source only if you need a separate audience.</p>}
      {hasAnySource && <p className="text-xs text-muted-foreground">Overlapping members are enrolled once per destination. Removing a source affects future enrollment; existing enrollments remain.</p>}
    </div>
  );
}

function ConflictNote({ unapproved, onResolve }: { unapproved: number; onResolve: () => void }) {
  return (
    <div className="mt-3 flex items-start gap-2 border-t border-amber-400/30 pt-3">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
      <div className="space-y-2">
        <p className="text-xs leading-relaxed text-amber-800 dark:text-amber-300">
          This source also routes members here after processing. Remove the direct connection to make the processing workflow the single route.
          {unapproved > 0 && ` ${unapproved.toLocaleString()} members have not passed processing.`}
        </p>
        <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onResolve}>Use the processing route</Button>
      </div>
    </div>
  );
}
