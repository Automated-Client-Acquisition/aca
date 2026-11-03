import type { SequenceNode, SequenceEdge, SequenceNodeType } from '@/lib/sequence-utils';
import { NODE_TYPE_CONFIGS, getNodeSourceHandles } from '@/lib/sequence-utils';

const NODE_WIDTH = 320;
export const SEQUENCE_LAYOUT_SPACING = { horizontal: 160, vertical: 56 };
const HORIZONTAL_GAP = SEQUENCE_LAYOUT_SPACING.horizontal;
const VERTICAL_GAP = SEQUENCE_LAYOUT_SPACING.vertical;

function nodeHeight(node: SequenceNode): number {
  const measuredHeight = node.measured?.height || node.height;
  if (Number.isFinite(measuredHeight) && measuredHeight > 0) return measuredHeight;
  const config = NODE_TYPE_CONFIGS[node.type as SequenceNodeType];
  const outcomes = getNodeSourceHandles(node).length;
  // Multi-outcome cards list their branch handles vertically. Reserve their
  // full height before React Flow has measured them to keep initial layout safe.
  if (outcomes > 2) return Math.max(250, 100 + outcomes * 22);
  if (config?.category === 'condition') return 160;
  return config?.category === 'terminal' || node.type === 'delay' ? 48 : 220;
}

/** Use the same breathing room for saved-layout display repair and Tidy. */
export function hasCrowdedSequenceLayout(nodes: SequenceNode[]): boolean {
  const visible = nodes.filter(node => !node.hidden);
  return visible.some((node, index) => visible.slice(index + 1).some(other => {
    const width = node.measured?.width || node.width || NODE_WIDTH;
    const otherWidth = other.measured?.width || other.width || NODE_WIDTH;
    return node.position.x < other.position.x + otherWidth + HORIZONTAL_GAP
      && node.position.x + width + HORIZONTAL_GAP > other.position.x
      && node.position.y < other.position.y + nodeHeight(other) + VERTICAL_GAP
      && node.position.y + nodeHeight(node) + VERTICAL_GAP > other.position.y;
  }));
}

interface TreeNode {
  id: string;
  children: { handle: string; node: TreeNode }[];
  // Width of the entire subtree rooted here (in pixels)
  subtreeWidth: number;
}

/**
 * Compute auto-layout positions for a DAG of sequence nodes.
 *
 * The graph may contain GoTo nodes and branch merges, so it's a DAG (not a pure tree).
 * The algorithm:
 * 1. Compute the depth (row) of each node as the LONGEST path from start (topological layering).
 *    This ensures sibling branches from a condition node start at the same depth.
 * 2. Build a tree by DFS from start. GoTo destination edges and already-visited nodes are excluded
 *    from the tree (they become cross-links rendered by React Flow edges, not layout children).
 * 3. Compute subtree widths bottom-up and assign x positions top-down, just like a
 *    Reingold-Tilford tree layout.
 * 4. Y positions use the tallest card per depth plus a clear gap between rows.
 */
export function computeAutoLayout(
  nodes: SequenceNode[],
  edges: SequenceEdge[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  const nodeById = new Map(nodes.map(n => [n.id, n]));

  // Build adjacency: parent → [{ handle, targetId }]
  const childrenMap = new Map<string, { handle: string; targetId: string }[]>();
  for (const edge of edges) {
    // Go To is a jump, not a child relationship. Exclude it before both depth
    // and tree calculation, including forward jumps and jumps to other branches.
    if (nodeById.get(edge.source)?.type === 'goTo' || !nodeById.has(edge.source) || !nodeById.has(edge.target)) continue;
    const list = childrenMap.get(edge.source) || [];
    list.push({ handle: edge.sourceHandle || 'default', targetId: edge.target });
    childrenMap.set(edge.source, list);
  }

  const startNode = nodes.find(n => n.type === 'start');
  if (!startNode) return new Map();

  // ── Step 1: Compute depth for each node (longest path from start) ──
  // This ensures that when two branches from a condition merge back, the shared
  // node sits below both branches (not at the level of the shorter one).
  const depth = new Map<string, number>();
  const nodeSet = new Set(nodes.map(n => n.id));

  function computeDepth(nodeId: string, d: number, visiting: Set<string>) {
    if (!nodeSet.has(nodeId)) return;
    // Cycle detection (GoTo back-edges)
    if (visiting.has(nodeId)) return;

    // Only update if we found a longer path
    if (depth.has(nodeId) && depth.get(nodeId)! >= d) return;
    depth.set(nodeId, d);

    visiting.add(nodeId);
    const outgoing = childrenMap.get(nodeId) || [];
    for (const { targetId } of outgoing) {
      computeDepth(targetId, d + 1, visiting);
    }
    visiting.delete(nodeId);
  }

  computeDepth(startNode.id, 0, new Set());

  const rowHeights = new Map<number, number>();
  for (const [id, row] of depth) {
    rowHeights.set(row, Math.max(rowHeights.get(row) || 0, nodeHeight(nodeById.get(id)!)));
  }
  const rowTops = new Map<number, number>([[0, 0]]);
  const lastRow = Math.max(...depth.values());
  for (let row = 0; row < lastRow; row++) {
    rowTops.set(row + 1, rowTops.get(row)! + rowHeights.get(row)! + VERTICAL_GAP);
  }

  // ── Step 2: Build layout tree via DFS ──
  // Nodes can only appear once in the tree; merge edges still render as cross-links.
  const visited = new Set<string>();

  function buildTree(nodeId: string): TreeNode | null {
    if (visited.has(nodeId)) return null;
    visited.add(nodeId);

    const outgoing = childrenMap.get(nodeId) || [];

    // Sort children to match the node's visual handle order.
    const node = nodeById.get(nodeId);
    const handleOrder = node ? getNodeSourceHandles(node) : [];

    outgoing.sort((a, b) => {
      const aIdx = handleOrder.indexOf(a.handle);
      const bIdx = handleOrder.indexOf(b.handle);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    const children: { handle: string; node: TreeNode }[] = [];
    for (const { handle, targetId } of outgoing) {
      const child = buildTree(targetId);
      if (child) children.push({ handle, node: child });
    }

    // Subtree width
    const isConditionNode = handleOrder.length > 1;

    let subtreeWidth: number;
    if (children.length === 0) {
      subtreeWidth = NODE_WIDTH;
    } else if (children.length === 1 && isConditionNode) {
      // Condition with one connected branch — offset to side, needs wider band
      subtreeWidth = NODE_WIDTH + HORIZONTAL_GAP + children[0].node.subtreeWidth;
    } else if (children.length === 1) {
      subtreeWidth = Math.max(NODE_WIDTH, children[0].node.subtreeWidth);
    } else {
      subtreeWidth = children.reduce((sum, c) => sum + c.node.subtreeWidth, 0)
        + HORIZONTAL_GAP * (children.length - 1);
    }

    return { id: nodeId, children, subtreeWidth };
  }

  const root = buildTree(startNode.id);
  if (!root) return new Map();

  // ── Step 3: Assign positions ──
  // Y = top of each height-aware row (from step 1)
  // X = tree layout (centered subtrees)
  const positions = new Map<string, { x: number; y: number }>();

  function assignPositions(treeNode: TreeNode, centerX: number) {
    const y = rowTops.get(depth.get(treeNode.id) || 0)!;
    positions.set(treeNode.id, { x: centerX - NODE_WIDTH / 2, y });

    if (treeNode.children.length === 0) return;

    if (treeNode.children.length === 1) {
      const child = treeNode.children[0];
      const parentNode = nodeById.get(treeNode.id);
      const parentHandles = parentNode ? getNodeSourceHandles(parentNode) : [];
      const isCondition = parentHandles.length > 1;

      if (isCondition) {
        // Condition with one child: offset based on which handle is connected
        const handleIdx = parentHandles.indexOf(child.handle);
        const offset = NODE_WIDTH / 2 + HORIZONTAL_GAP / 2;
        const childCenterX = handleIdx === 0
          ? centerX - offset
          : centerX + offset;
        assignPositions(child.node, childCenterX);
      } else {
        assignPositions(child.node, centerX);
      }
      return;
    }

    // Two or more children: distribute left-to-right in handle order
    const totalWidth = treeNode.children.reduce((sum, c) => sum + c.node.subtreeWidth, 0)
      + HORIZONTAL_GAP * (treeNode.children.length - 1);
    const bandLeft = centerX - totalWidth / 2;

    let offsetX = bandLeft;
    for (const child of treeNode.children) {
      const childCenterX = offsetX + child.node.subtreeWidth / 2;
      assignPositions(child.node, childCenterX);
      offsetX += child.node.subtreeWidth + HORIZONTAL_GAP;
    }
  }

  assignPositions(root, root.subtreeWidth / 2);

  // ── Step 4: Orphaned nodes ──
  const orphaned = nodes.filter(n => !visited.has(n.id));
  if (orphaned.length > 0) {
    const maxBottom = Math.max(...Array.from(positions, ([id, position]) => position.y + nodeHeight(nodeById.get(id)!)));
    const rootPos = positions.get(root.id);
    const orphanX = rootPos ? rootPos.x : 0;
    let orphanY = maxBottom + VERTICAL_GAP;
    for (const node of orphaned) {
      positions.set(node.id, { x: orphanX, y: orphanY });
      orphanY += nodeHeight(node) + VERTICAL_GAP;
    }
  }

  return positions;
}

/**
 * Animate nodes from current positions to target positions.
 * Uses requestAnimationFrame with cubic ease-out for smooth motion.
 * Returns a cancel function.
 */
export function animateToLayout(
  currentNodes: SequenceNode[],
  targetPositions: Map<string, { x: number; y: number }>,
  setNodes: React.Dispatch<React.SetStateAction<SequenceNode[]>>,
  onComplete: () => void,
  duration = 300,
): () => void {
  const startPositions = new Map(
    currentNodes.map(n => [n.id, { x: n.position.x, y: n.position.y }]),
  );
  const startTime = performance.now();
  let frameId: number;

  function frame(now: number) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);

    setNodes(prev =>
      prev.map(node => {
        const start = startPositions.get(node.id);
        const target = targetPositions.get(node.id);
        if (!start || !target) return node;

        return {
          ...node,
          position: {
            x: start.x + (target.x - start.x) * eased,
            y: start.y + (target.y - start.y) * eased,
          },
        };
      }),
    );

    if (progress < 1) {
      frameId = requestAnimationFrame(frame);
    } else {
      onComplete();
    }
  }

  frameId = requestAnimationFrame(frame);

  return () => cancelAnimationFrame(frameId);
}
