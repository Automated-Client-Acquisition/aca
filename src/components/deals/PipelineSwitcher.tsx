import { Check, ChevronsUpDown, Plus, Settings2, Workflow } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { DealPipeline } from "@/hooks/crm/useDeals";
import { cn } from "@/lib/utils";

/** Pipeline picker for the deals board: switch, create, and open settings. */
export function PipelineSwitcher({
  pipelines,
  current,
  onSelect,
  onNew,
  onSettings,
}: {
  pipelines: DealPipeline[];
  current: DealPipeline | undefined;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSettings: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="min-w-[200px] max-w-[280px] justify-between gap-2 font-semibold">
          <span className="flex min-w-0 items-center gap-2">
            <Workflow className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{current?.name ?? "Pipeline"}</span>
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Pipelines
        </DropdownMenuLabel>
        {pipelines.map((p) => {
          const openStages = p.stages.filter((s) => s.stage_type !== "won" && s.stage_type !== "lost").length;
          return (
            <DropdownMenuItem key={p.id} onSelect={() => onSelect(p.id)} className="gap-2">
              <Check className={cn("h-4 w-4 shrink-0", p.id === current?.id ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              {p.is_default && (
                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">Default</span>
              )}
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                {openStages} {openStages === 1 ? "stage" : "stages"}
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onNew} className="gap-2">
          <Plus className="h-4 w-4" /> New pipeline
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onSettings} className="gap-2" disabled={!current}>
          <Settings2 className="h-4 w-4" /> Edit "{current?.name ?? "pipeline"}"
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
