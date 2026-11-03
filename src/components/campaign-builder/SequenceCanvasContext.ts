import { createContext, useContext } from "react";

/** Point a "+" button was clicked, in screen coordinates. */
export interface CanvasMenuAnchor {
  x: number;
  y: number;
}

export interface SequenceCanvasActions {
  /** Add a step after an open outcome of a step. */
  openAddAfter: (from: { nodeId: string; handleId?: string }, anchor: CanvasMenuAnchor) => void;
  /** Insert a step on an existing connection. */
  openInsertOnEdge?: (edgeId: string, anchor: CanvasMenuAnchor) => void;
}

export const SequenceCanvasContext = createContext<SequenceCanvasActions | null>(null);

export function useSequenceCanvasActions() {
  return useContext(SequenceCanvasContext);
}
