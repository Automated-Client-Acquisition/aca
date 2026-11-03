import { useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type CollisionDetection,
  type DragStartEvent,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { differenceInCalendarDays, format, parseISO } from "date-fns";
import { Plus, Trophy, XCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { CrmPipelineStage } from "@/hooks/crm/useContacts";
import { type CrmDeal, dealProbability, formatMoney, useMoveDeal } from "@/hooks/crm/useDeals";
import { LostReasonDialog } from "./LostReasonDialog";
import { cn } from "@/lib/utils";

type Columns = Record<string, string[]>;

// Won/Lost aren't columns: they're drop targets that appear while dragging
// (Pipedrive-style), so every open stage fits on screen.
const WON_ZONE = "__won__";
const LOST_ZONE = "__lost__";

interface DealsBoardProps {
  stages: CrmPipelineStage[];
  deals: CrmDeal[];
  memberNames: Record<string, string>;
  onOpenDeal: (deal: CrmDeal) => void;
  onAddDeal: (stageId: string) => void;
}

// The Won/Lost zones are small and fixed, so corner distance would always pick
// the tall column under them: if the pointer is inside a zone, that wins.
const collisionDetection: CollisionDetection = (args) => {
  const zone = pointerWithin(args).find((c) => c.id === WON_ZONE || c.id === LOST_ZONE);
  return zone ? [zone] : closestCorners(args);
};

const isClosedStage = (s: CrmPipelineStage) => s.stage_type === "won" || s.stage_type === "lost";

function buildColumns(stages: CrmPipelineStage[], deals: CrmDeal[]): Columns {
  const cols: Columns = Object.fromEntries(stages.map((s) => [s.id, [] as string[]]));
  const sorted = [...deals].sort((a, b) => a.position - b.position || b.created_at.localeCompare(a.created_at));
  for (const d of sorted) cols[d.stage_id]?.push(d.id);
  return cols;
}

function initials(name?: string | null) {
  if (!name) return "?";
  return name
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function DealsBoard({ stages, deals, memberNames, onOpenDeal, onAddDeal }: DealsBoardProps) {
  const moveDeal = useMoveDeal();
  const openStages = useMemo(() => stages.filter((s) => !isClosedStage(s)), [stages]);
  const wonStage = stages.find((s) => s.stage_type === "won");
  const lostStage = stages.find((s) => s.stage_type === "lost");
  const openDeals = useMemo(() => deals.filter((d) => d.status === "open"), [deals]);
  const dealById = useMemo(() => Object.fromEntries(deals.map((d) => [d.id, d])), [deals]);
  const stageById = useMemo(() => Object.fromEntries(stages.map((s) => [s.id, s])), [stages]);
  const [columns, setColumns] = useState<Columns>(() => buildColumns(openStages, openDeals));
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pendingLost, setPendingLost] = useState<{ id: string; stage_id: string; position: number } | null>(null);

  // Server data wins whenever we're not mid-drag.
  useEffect(() => {
    if (!activeId) setColumns(buildColumns(openStages, openDeals));
  }, [openStages, openDeals, activeId]);

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Long-press to drag on touch, so swiping still scrolls the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    // Space picks a card up; Enter is left free to open it.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ["Space"], cancel: ["Escape"], end: ["Space"] },
    }),
  );

  const findColumn = (id: string) => (id in columns ? id : Object.keys(columns).find((k) => columns[k].includes(id)));

  const handleDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));

  // Live-move the card across columns so the drop target previews correctly.
  const handleDragOver = (e: DragOverEvent) => {
    const { active, over } = e;
    if (!over) return;
    const from = findColumn(String(active.id));
    const to = findColumn(String(over.id));
    if (!from || !to || from === to) return;
    setColumns((prev) => {
      const fromItems = prev[from].filter((id) => id !== active.id);
      const toItems = [...prev[to]];
      const overIndex = toItems.indexOf(String(over.id));
      toItems.splice(overIndex >= 0 ? overIndex : toItems.length, 0, String(active.id));
      return { ...prev, [from]: fromItems, [to]: toItems };
    });
  };

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    const id = String(active.id);
    const deal = dealById[id];
    setActiveId(null);
    if (!over || !deal) return;

    if (over.id === WON_ZONE && wonStage) {
      moveDeal.mutate({ id, stage_id: wonStage.id, position: 0, status: "won" });
      toast.success(`Won: ${deal.name}`, { description: formatMoney(Number(deal.value), deal.currency) });
      return;
    }
    if (over.id === LOST_ZONE && lostStage) {
      setPendingLost({ id, stage_id: lostStage.id, position: 0 });
      return;
    }

    const to = findColumn(String(over.id));
    if (!to) return;
    let items = columns[to];
    const oldIndex = items.indexOf(id);
    const overIndex = items.indexOf(String(over.id));
    if (oldIndex >= 0 && overIndex >= 0 && oldIndex !== overIndex) {
      items = [...items];
      items.splice(oldIndex, 1);
      items.splice(overIndex, 0, id);
      setColumns((prev) => ({ ...prev, [to]: items }));
    }

    const index = items.indexOf(id);
    const prev = index > 0 ? dealById[items[index - 1]]?.position : undefined;
    const next = index < items.length - 1 ? dealById[items[index + 1]]?.position : undefined;
    const position =
      prev !== undefined && next !== undefined ? (prev + next) / 2 : next !== undefined ? next - 1 : prev !== undefined ? prev + 1 : 0;

    if (to === deal.stage_id && position === deal.position) return;
    moveDeal.mutate({ id, stage_id: to, position });
  };

  const activeDeal = activeId ? dealById[activeId] : null;

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        // The drop bar slides in after drag start; re-measure so its rect is current.
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => {
          setActiveId(null);
          setColumns(buildColumns(openStages, openDeals));
        }}
      >
        <div className="-mx-4 flex h-full snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:snap-none sm:px-0">
          {openStages.map((stage) => {
            const ids = columns[stage.id] ?? [];
            const colDeals = ids.map((id) => dealById[id]).filter(Boolean);
            const total = colDeals.reduce((sum, d) => sum + Number(d.value || 0), 0);
            const weighted = colDeals.reduce((sum, d) => sum + (Number(d.value || 0) * dealProbability(d, stage)) / 100, 0);
            const currency = colDeals[0]?.currency ?? "USD";
            return (
              <BoardColumn
                key={stage.id}
                stage={stage}
                ids={ids}
                count={colDeals.length}
                total={formatMoney(total, currency, true)}
                weighted={formatMoney(weighted, currency, true)}
                onAdd={() => onAddDeal(stage.id)}
              >
                {colDeals.map((deal) => (
                  <SortableDealCard
                    key={deal.id}
                    deal={deal}
                    stage={stage}
                    ownerName={deal.owner_user_id ? memberNames[deal.owner_user_id] : undefined}
                    onOpen={() => onOpenDeal(deal)}
                  />
                ))}
              </BoardColumn>
            );
          })}
        </div>

        <CloseDropBar visible={!!activeDeal} canWin={!!wonStage} canLose={!!lostStage} />

        <DragOverlay dropAnimation={{ duration: 180, easing: "cubic-bezier(0.2, 0, 0, 1)" }}>
          {activeDeal ? (
            <DealCard
              deal={activeDeal}
              stage={stageById[activeDeal.stage_id]}
              ownerName={activeDeal.owner_user_id ? memberNames[activeDeal.owner_user_id] : undefined}
              dragging
            />
          ) : null}
        </DragOverlay>
      </DndContext>

      <LostReasonDialog
        open={!!pendingLost}
        dealName={pendingLost ? dealById[pendingLost.id]?.name : undefined}
        onCancel={() => {
          setPendingLost(null);
          setColumns(buildColumns(openStages, openDeals));
        }}
        onConfirm={(reason) => {
          if (pendingLost) moveDeal.mutate({ ...pendingLost, lost_reason: reason || null, status: "lost" });
          setPendingLost(null);
        }}
      />
    </>
  );
}

function CloseDropBar({ visible, canWin, canLose }: { visible: boolean; canWin: boolean; canLose: boolean }) {
  return (
    <div
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center gap-3 px-4 transition-all duration-200",
        visible ? "translate-y-0 opacity-100" : "translate-y-6 opacity-0",
      )}
      aria-hidden={!visible}
    >
      {canWin && <DropZone id={WON_ZONE} label="Won" icon={Trophy} tone="won" active={visible} />}
      {canLose && <DropZone id={LOST_ZONE} label="Lost" icon={XCircle} tone="lost" active={visible} />}
    </div>
  );
}

function DropZone({
  id,
  label,
  icon: Icon,
  tone,
  active,
}: {
  id: string;
  label: string;
  icon: typeof Trophy;
  tone: "won" | "lost";
  active: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !active });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex h-16 w-40 items-center justify-center gap-2 rounded-xl border-2 border-dashed bg-background/95 text-sm font-semibold shadow-lg backdrop-blur transition-all sm:w-56",
        active && "pointer-events-auto",
        tone === "won"
          ? "border-emerald-500/60 text-emerald-700 dark:text-emerald-400"
          : "border-red-500/60 text-red-700 dark:text-red-400",
        isOver && (tone === "won" ? "scale-105 border-solid bg-emerald-50 dark:bg-emerald-950" : "scale-105 border-solid bg-red-50 dark:bg-red-950"),
      )}
    >
      <Icon className="h-4 w-4" />
      {label}
    </div>
  );
}

function BoardColumn({
  stage,
  ids,
  count,
  total,
  weighted,
  onAdd,
  children,
}: {
  stage: CrmPipelineStage;
  ids: string[];
  count: number;
  total: string;
  weighted: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: stage.id });

  return (
    <div className="flex w-[85%] shrink-0 snap-start flex-col rounded-xl bg-muted/40 sm:w-auto sm:min-w-[212px] sm:max-w-[320px] sm:flex-1">
      <div className="px-3 pb-2 pt-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} />
            <span className="truncate text-[13px] font-semibold">{stage.name}</span>
            <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            onClick={onAdd}
            aria-label={`Add deal to ${stage.name}`}
          >
            <Plus className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="mt-1 flex items-baseline gap-1.5 pl-4 text-xs">
          <span className="font-semibold tabular-nums">{total}</span>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="cursor-default tabular-nums text-muted-foreground">· {weighted} weighted</span>
            </TooltipTrigger>
            <TooltipContent>Value × confidence. Stage default is {stage.win_probability ?? 0}%.</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <SortableContext id={stage.id} items={ids} strategy={verticalListSortingStrategy}>
        <div
          ref={setNodeRef}
          className={cn(
            "mx-1.5 mb-1.5 flex min-h-[140px] flex-1 flex-col gap-2 overflow-y-auto rounded-lg p-1.5 transition-colors",
            isOver && "bg-primary/5 ring-1 ring-inset ring-primary/20",
          )}
        >
          {children}
          {count === 0 && (
            <button
              onClick={onAdd}
              className="flex items-center justify-center rounded-lg border border-dashed border-border/80 py-5 text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
            >
              <Plus className="mr-1 h-3.5 w-3.5" /> Add deal
            </button>
          )}
        </div>
      </SortableContext>
    </div>
  );
}

function SortableDealCard(props: { deal: CrmDeal; stage?: CrmPipelineStage; ownerName?: string; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.deal.id });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring", isDragging && "opacity-30")}
      {...attributes}
      {...listeners}
      onKeyDown={(e) => {
        if (e.key === "Enter") props.onOpen();
        listeners?.onKeyDown?.(e);
      }}
    >
      <DealCard {...props} />
    </div>
  );
}

export function DealCard({
  deal,
  stage,
  ownerName,
  onOpen,
  dragging,
}: {
  deal: CrmDeal;
  stage?: CrmPipelineStage;
  ownerName?: string;
  onOpen?: () => void;
  dragging?: boolean;
}) {
  const isOpen = deal.status === "open";
  const daysToClose = deal.expected_close_date ? differenceInCalendarDays(parseISO(deal.expected_close_date), new Date()) : null;
  const overdue = isOpen && daysToClose !== null && daysToClose < 0;
  const closingSoon = isOpen && daysToClose !== null && daysToClose >= 0 && daysToClose <= 7;
  const daysInStage = differenceInCalendarDays(new Date(), new Date(deal.stage_entered_at));
  const stale = isOpen && stage?.expected_days != null && daysInStage > stage.expected_days;
  const probability = dealProbability(deal, stage);
  const entityName = deal.company?.name ?? deal.contact?.display_name;
  const entityImage = deal.company?.logo_url ?? deal.contact?.avatar_url ?? undefined;

  return (
    <div
      onClick={onOpen}
      className={cn(
        "group cursor-grab select-none rounded-lg border bg-card p-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-all hover:border-foreground/15 hover:shadow-md active:cursor-grabbing",
        dragging && "rotate-[1.5deg] cursor-grabbing border-foreground/15 shadow-xl",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          {entityName ? (
            <>
              <Avatar className="h-5 w-5 rounded-md">
                {entityImage && <AvatarImage src={entityImage} alt="" />}
                <AvatarFallback className="rounded-md bg-muted text-[9px] font-semibold">{initials(entityName)}</AvatarFallback>
              </Avatar>
              <span className="truncate text-xs text-muted-foreground">{entityName}</span>
            </>
          ) : null}
        </div>
        {ownerName && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Avatar className="h-5 w-5 shrink-0">
                <AvatarFallback className="bg-secondary text-[9px] font-semibold text-secondary-foreground">{initials(ownerName)}</AvatarFallback>
              </Avatar>
            </TooltipTrigger>
            <TooltipContent>Owner: {ownerName}</TooltipContent>
          </Tooltip>
        )}
      </div>

      <p className="mt-2 line-clamp-2 text-sm font-medium leading-snug">{deal.name}</p>

      <div className="mt-3 flex items-end justify-between gap-2">
        <span className="text-[15px] font-semibold tabular-nums tracking-tight">{formatMoney(Number(deal.value), deal.currency)}</span>
        <div className="flex items-center gap-1">
          {stale && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-0.5 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                  <Clock className="h-2.5 w-2.5" />
                  {daysInStage}d
                </span>
              </TooltipTrigger>
              <TooltipContent>
                {daysInStage} days in {stage?.name} (expected {stage?.expected_days})
              </TooltipContent>
            </Tooltip>
          )}
          {deal.expected_close_date && isOpen && (
            <span
              className={cn(
                "rounded-full px-1.5 py-0.5 text-[10px] font-medium tabular-nums",
                overdue
                  ? "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
                  : closingSoon
                    ? "bg-foreground/[0.07] text-foreground"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {overdue ? "Overdue · " : ""}
              {format(parseISO(deal.expected_close_date), "MMM d")}
            </span>
          )}
        </div>
      </div>

      {isOpen && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${probability}%`, backgroundColor: stage?.color ?? "hsl(var(--primary))" }}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent>{probability}% likely to close</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
