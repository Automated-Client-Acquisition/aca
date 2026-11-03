import { memo, useState } from "react";
import {
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  getStraightPath,
  getBezierPath,
  type EdgeProps,
  type Edge,
} from "@xyflow/react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BranchOutcomeBadge,
  type BranchOutcomeTone,
} from "@/components/campaign-builder/nodes/BranchOutcomeBadge";
import { useSequenceCanvasActions } from "@/components/campaign-builder/SequenceCanvasContext";

export interface SequenceEdgeData {
  onDeleteEdge?: (edgeId: string) => void;
  isGoTo?: boolean;
  outcomeTone?: BranchOutcomeTone;
}

function SequenceEdgeComponent({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  label,
  selected,
  style,
  markerEnd,
  data,
}: EdgeProps<Edge<SequenceEdgeData & Record<string, unknown>>>) {
  // Keep ordinary branches centered in the gap; Go To arcs stay distinct.
  const [edgePath, labelX, labelY] = data?.isGoTo
    ? getBezierPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
      })
    : Math.abs(sourceX - targetX) < 0.5
      ? getStraightPath({ sourceX, sourceY, targetX, targetY })
      : getSmoothStepPath({
        sourceX,
        sourceY,
        sourcePosition,
        targetX,
        targetY,
        targetPosition,
        offset: 0,
        borderRadius: 18,
        centerY: (sourceY + targetY) / 2,
      });

  const actions = useSequenceCanvasActions();
  // Insert stays out of the way until the pointer is on the link, like the homepage mockup.
  const [hovered, setHovered] = useState(false);
  const showLabel = !!label;
  const removeLabel = typeof label === "string" ? `Remove ${label} connection` : "Remove connection";
  const canInsert = !!actions?.openInsertOnEdge && !data?.isGoTo;

  return (
    <>
      <g onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          strokeWidth: 1.5,
          strokeLinecap: "round",
          strokeLinejoin: "round",
          stroke: selected ? "#d2a33e" : "hsl(var(--muted-foreground) / 0.5)",
          ...(data?.isGoTo ? { strokeDasharray: "4 5" } : {}),
        }}
        // Steps read top to bottom, so only Go To back-links need an arrow.
        markerEnd={data?.isGoTo ? markerEnd : undefined}
      />
      </g>
      <EdgeLabelRenderer>
        {(showLabel || canInsert || (selected && data?.onDeleteEdge)) && (
          <div
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              pointerEvents: "none",
            }}
            className="flex items-center gap-1"
          >
            {showLabel && (
              <BranchOutcomeBadge label={label} tone={data?.outcomeTone || "neutral"} selected={selected} />
            )}
            <span className={cn("flex items-center gap-1", showLabel && "absolute left-full ml-1")}>
            {canInsert && (
              <button
                type="button"
                aria-label="Insert a step here"
                title="Insert a step here"
                onMouseEnter={() => setHovered(true)}
                onMouseLeave={() => setHovered(false)}
                className={cn(
                  "nodrag nopan pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-[transform,color,border-color,opacity] hover:scale-125 hover:border-amber-500 hover:text-amber-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:opacity-100",
                  hovered || selected ? "opacity-100" : "opacity-0",
                )}
                onClick={event => {
                  event.stopPropagation();
                  const rect = event.currentTarget.getBoundingClientRect();
                  actions!.openInsertOnEdge!(id, { x: rect.right + 6, y: rect.top });
                }}
              >
                <Plus className="h-3 w-3" />
              </button>
            )}
            {selected && data?.onDeleteEdge && (
              <button
                type="button"
                aria-label={removeLabel}
                title={removeLabel}
                className="nodrag nopan pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:border-destructive/30 hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500"
                onClick={event => { event.stopPropagation(); data.onDeleteEdge!(id); }}
              >
                <X className="h-3 w-3" />
              </button>
            )}
            </span>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
}

export const SequenceEdge = memo(SequenceEdgeComponent);
