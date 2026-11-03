import { useEffect, useRef, useState, type RefObject } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  ChevronDown,
  Clock,
  GitBranch,
  GripVertical,
  Mail,
  MoreHorizontal,
  Plus,
  Split,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatDelayHours,
  type ValidationError,
} from "@/lib/email-sequence-utils";
import { cn } from "@/lib/utils";
import { SEQUENCE_STEP_STYLES } from "@/components/email/sequence-step-styles";
import type { EmailSequenceStep, StepType } from "@/types/email";

interface SequenceOutlineProps {
  steps: EmailSequenceStep[];
  stepIds: string[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
  onAdd: (type: StepType) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  errors: ValidationError[];
}

const STEP_OPTIONS = [
  {
    type: "email",
    label: "Send an email",
    description: "Start or continue a conversation",
    icon: Mail,
  },
  {
    type: "delay",
    label: "Wait",
    description: "Give your prospect time to reply",
    icon: Clock,
  },
  {
    type: "condition",
    label: "Check a condition",
    description: "Respond to prospect activity",
    icon: GitBranch,
  },
  {
    type: "ab_test",
    label: "A/B test emails",
    description: "Find the message that performs best",
    icon: Split,
  },
] as const;

function getStepSummary(steps: EmailSequenceStep[], index: number) {
  const step = steps[index];
  const emailNumber = steps
    .slice(0, index + 1)
    .filter((item) => item.type === "email" || item.type === "ab_test").length;
  const previousEmail = steps
    .slice(0, index)
    .reverse()
    .find((item) => item.type === "email" || item.type === "ab_test");
  const previousSubject = steps
    .slice(0, index)
    .reverse()
    .filter((item) => item.type === "email" || item.type === "ab_test")
    .map((item) => item.subject?.trim() || item.variants?.[0]?.subject?.trim())
    .find(Boolean);
  if (step.type === "email") {
    return {
      label: `Email ${emailNumber}`,
      title:
        step.subject?.trim() ||
        (previousSubject
          ? `Re: ${previousSubject.replace(/^re:\s*/i, "")}`
          : "Add a subject line"),
      detail:
        !step.subject?.trim() && previousEmail
          ? "Reply in the same thread"
          : emailNumber === 1
            ? "Start the conversation"
            : "Follow-up email",
    };
  }
  if (step.type === "delay") {
    return {
      label: "Wait",
      title: `Wait ${formatDelayHours(step.delay_hours ?? 24)}`,
      detail: "Before the next step",
    };
  }
  if (step.type === "condition") {
    const activity = {
      opened: "an open",
      clicked: "a click",
      replied: "a reply",
      bounced: "a bounce",
    };
    return {
      label: "Condition",
      title: `Check for ${activity[step.condition_type ?? "replied"]}`,
      detail: `Within ${formatDelayHours(step.condition_timeout_hours ?? 48)}`,
    };
  }
  return {
    label: `Email ${emailNumber} · A/B test`,
    title:
      step.variants?.[0]?.subject?.trim() ||
      previousSubject ||
      "Compare email variants",
    detail: `${step.variants?.length ?? 0} variants · split delivery`,
  };
}

interface SortableStepProps {
  steps: EmailSequenceStep[];
  id: string;
  index: number;
  selected: boolean;
  activeRef: RefObject<HTMLDivElement>;
  errors: ValidationError[];
  onSelect: (index: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

function SortableStep({
  steps,
  id,
  index,
  selected,
  activeRef,
  errors,
  onSelect,
  onReorder,
}: SortableStepProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const didReorderFromMenu = useRef(false);
  const step = steps[index];
  const styles = SEQUENCE_STEP_STYLES[step.type];
  const Icon = STEP_OPTIONS.find((option) => option.type === step.type)!.icon;
  const summary = getStepSummary(steps, index);
  const stepErrors = errors.filter((error) => error.stepIndex === index);
  const moveActions = [
    {
      label: "Move up",
      icon: ArrowUp,
      target: index - 1,
      disabled: index === 0,
    },
    {
      label: "Move down",
      icon: ArrowDown,
      target: index + 1,
      disabled: index === steps.length - 1,
    },
    {
      label: "Move to first",
      icon: ArrowUpToLine,
      target: 0,
      disabled: index === 0,
    },
    {
      label: "Move to last",
      icon: ArrowDownToLine,
      target: steps.length - 1,
      disabled: index === steps.length - 1,
    },
  ];

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("relative w-64 shrink-0 lg:w-auto", isDragging && "z-10")}
    >
      {index < steps.length - 1 && (
        <span
          aria-hidden="true"
          className="absolute left-14 top-full hidden h-4 w-px bg-border lg:block"
        />
      )}
      <div
        ref={selected ? activeRef : undefined}
        className={cn(
          "relative flex min-h-20 items-start rounded-lg border border-transparent p-1.5 transition-colors",
          selected ? styles.selected : styles.row,
          isDragging && "bg-card shadow-lg ring-2 ring-ring",
        )}
      >
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          data-step-drag-handle={index}
          aria-label={`Drag step ${index + 1}: ${summary.label}`}
          title="Drag to move step. Use Space and arrow keys with a keyboard."
          className="mt-2 flex h-9 w-6 shrink-0 touch-none cursor-grab items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-current={selected ? "step" : undefined}
          aria-label={`Step ${index + 1}: ${summary.label}. ${summary.title}${stepErrors.length ? ". Needs attention" : ""}`}
          onClick={() => onSelect(index)}
          className="flex min-w-0 flex-1 items-start gap-3 rounded p-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span
            className={cn(
              "relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
              styles.icon,
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            <span className="absolute -bottom-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full border bg-card px-0.5 text-[9px] font-semibold text-muted-foreground">
              {index + 1}
            </span>
          </span>
          <span className="min-w-0 flex-1">
            <span
              className={cn(
                "flex items-center justify-between gap-2 text-[10px] font-semibold uppercase tracking-wider",
                styles.label,
              )}
            >
              {summary.label}
              {!!stepErrors.length && (
                <AlertCircle
                  className="h-3.5 w-3.5 shrink-0 text-destructive"
                  aria-hidden="true"
                />
              )}
            </span>
            <span
              className="mt-1.5 block truncate text-[13px] font-medium leading-5"
              title={summary.title}
            >
              {summary.title}
            </span>
            {selected && step.type !== "delay" && (
              <span className="mt-1.5 block truncate text-[11px] leading-4 text-muted-foreground">
                {summary.detail}
              </span>
            )}
          </span>
        </button>
        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger asChild>
            <Button
              ref={menuTriggerRef}
              variant="ghost"
              size="icon"
              aria-label={`Step ${index + 1} actions`}
              className="mt-2 h-9 w-7 shrink-0 text-muted-foreground hover:bg-background/70 hover:text-foreground"
            >
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={(event) => {
              // The row has moved. Focus it immediately after that move instead
              // of letting the closing animation steal focus from the next menu.
              if (didReorderFromMenu.current) {
                event.preventDefault();
                didReorderFromMenu.current = false;
              }
            }}
          >
            {moveActions.map(({ label, icon: MoveIcon, target, disabled }) => (
              <DropdownMenuItem
                key={label}
                disabled={disabled}
                onSelect={() => {
                  didReorderFromMenu.current = true;
                  setMenuOpen(false);
                  onReorder(index, target);
                  requestAnimationFrame(() =>
                    menuTriggerRef.current?.focus({ preventScroll: true }),
                  );
                }}
              >
                <MoveIcon className="mr-2 h-4 w-4" aria-hidden="true" />
                {label}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  );
}

export function SequenceOutline({
  steps,
  stepIds,
  selectedIndex,
  onSelect,
  onAdd,
  onReorder,
  errors,
}: SequenceOutlineProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);
  const pendingFocusIndex = useRef<number | null>(null);
  const dragStartIndex = useRef<number | null>(null);
  const dragEndIndex = useRef<number | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      scrollBehavior: "auto",
    }),
  );

  const handleDragEnd = ({ active, over, activatorEvent }: DragEndEvent) => {
    dragEndIndex.current = over ? stepIds.indexOf(String(over.id)) : null;
    if (over && active.id !== over.id) {
      const fromIndex = stepIds.indexOf(String(active.id));
      const toIndex = stepIds.indexOf(String(over.id));
      if (fromIndex < 0 || toIndex < 0) return;
      if (activatorEvent.type === "keydown")
        pendingFocusIndex.current = toIndex;
      onReorder(fromIndex, toIndex);
    }
  };
  const emailCount = steps.filter(
    (step) => step.type === "email" || step.type === "ab_test",
  ).length;

  useEffect(() => {
    if (pendingFocusIndex.current === null) return;
    const index = pendingFocusIndex.current;
    pendingFocusIndex.current = null;
    const frame = requestAnimationFrame(() => {
      scrollRef.current
        ?.querySelector<HTMLButtonElement>(`[data-step-drag-handle="${index}"]`)
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [steps]);

  useEffect(() => {
    const container = scrollRef.current;
    const active = activeRef.current;
    if (!container || !active) return;
    // Scroll only the outline: scrollIntoView can also move the page and editor.
    const bounds = container.getBoundingClientRect();
    const item = active.getBoundingClientRect();
    const top =
      item.top < bounds.top
        ? item.top - bounds.top
        : item.bottom > bounds.bottom
          ? item.bottom - bounds.bottom
          : 0;
    const left =
      item.left < bounds.left
        ? item.left - bounds.left
        : item.right > bounds.right
          ? item.right - bounds.right
          : 0;
    container.scrollTo({
      top: container.scrollTop + top,
      left: container.scrollLeft + left,
      behavior: "auto",
    });
  }, [selectedIndex, steps.length]);

  return (
    <nav
      aria-label="Sequence steps"
      className="flex min-w-0 flex-col overflow-hidden rounded-xl border bg-card shadow-sm"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">Sequence</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {steps.length} {steps.length === 1 ? "step" : "steps"} ·{" "}
            {emailCount} {emailCount === 1 ? "email" : "emails"}
          </p>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="cta" size="sm" className="shrink-0 gap-1.5 px-2.5">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add step
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-72">
            {STEP_OPTIONS.map(({ type, label, description, icon: Icon }) => (
              <DropdownMenuItem
                key={type}
                onSelect={() => onAdd(type)}
                className="items-start gap-3 py-3"
              >
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border",
                    SEQUENCE_STEP_STYLES[type].icon,
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                </span>
                <span>
                  <span className="block font-medium">{label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {description}
                  </span>
                </span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p className="shrink-0 border-b px-3 py-2 text-[11px] text-muted-foreground">
        Drag to reorder · use ⋯ for move options
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        accessibility={{
          restoreFocus: false,
          screenReaderInstructions: {
            draggable:
              "Press Space to pick up a step, then use the arrow keys to move it. Press Space again to drop it, or Escape to cancel.",
          },
          announcements: {
            onDragStart: ({ active }) => {
              dragStartIndex.current = stepIds.indexOf(String(active.id));
              dragEndIndex.current = null;
              return `Picked up step ${dragStartIndex.current + 1}.`;
            },
            onDragOver: ({ active, over }) =>
              over
                ? `Step ${(dragStartIndex.current ?? stepIds.indexOf(String(active.id))) + 1} is over position ${stepIds.indexOf(String(over.id)) + 1} of ${steps.length}.`
                : "Move over a step to choose its new position.",
            onDragEnd: ({ active, over }) =>
              over
                ? `Moved step ${(dragStartIndex.current ?? stepIds.indexOf(String(active.id))) + 1} to position ${(dragEndIndex.current ?? stepIds.indexOf(String(over.id))) + 1} of ${steps.length}.`
                : "Step order unchanged.",
            onDragCancel: () => "Move cancelled. Step order unchanged.",
          },
        }}
      >
        <div
          ref={scrollRef}
          className="min-h-0 overflow-x-auto px-3 py-4 lg:max-h-[max(8rem,calc(var(--app-content-height,calc(100dvh-4rem))-22rem))] lg:overflow-y-auto lg:overflow-x-hidden"
        >
          <SortableContext items={stepIds} strategy={rectSortingStrategy}>
            <ol className="flex min-w-max gap-4 lg:min-w-0 lg:flex-col">
              {steps.map((step, index) => (
                <SortableStep
                  key={stepIds[index]}
                  id={stepIds[index]}
                  steps={steps}
                  index={index}
                  selected={selectedIndex === index}
                  activeRef={activeRef}
                  errors={errors}
                  onSelect={onSelect}
                  onReorder={onReorder}
                />
              ))}
            </ol>
          </SortableContext>
          {steps.length === 0 && (
            <p className="px-1 py-6 text-center text-sm text-muted-foreground">
              Add your first email to get started.
            </p>
          )}
        </div>
      </DndContext>
    </nav>
  );
}
