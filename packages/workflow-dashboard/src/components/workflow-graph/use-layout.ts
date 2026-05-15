import type { Edge, Node } from "@xyflow/react";
import { useMemo } from "react";
import type { WorkflowGraphEdge } from "../../api.ts";
import type { NodeState, RoleNodeData, TerminalNodeData } from "./types.ts";

const START_ID = "__start__";
const END_ID = "__end__";
const ROLE_NODE_WIDTH = 180;
const ROLE_NODE_HEIGHT = 60;
const TERMINAL_NODE_SIZE = 40;

// Vertical gap between nodes in the spine
const LAYER_GAP = 80;
// Horizontal offset for feedback (back) edges routed on the right side
const FEEDBACK_OFFSET_X = 80;

type LayoutInput = {
  edges: readonly WorkflowGraphEdge[];
  roles: Record<string, { description: string }>;
  nodeStates: Map<string, NodeState>;
};

type LayoutResult = {
  nodes: Node[];
  edges: Edge[];
};

function nodeSize(id: string): { width: number; height: number } {
  if (id === START_ID || id === END_ID) {
    return { width: TERMINAL_NODE_SIZE, height: TERMINAL_NODE_SIZE };
  }
  return { width: ROLE_NODE_WIDTH, height: ROLE_NODE_HEIGHT };
}

function edgeKey(e: WorkflowGraphEdge): string {
  return `${e.from}->${e.to}::${e.condition}`;
}

/**
 * Compute node layers using a reachability-based partial order.
 *
 * Definitions (where ~> means "has a directed path"):
 *   a « b  =  a ~> b  AND  NOT b ~> a       (a strictly precedes b)
 *   a ~ b  =  NOT a « b  AND  NOT b « a     (incomparable)
 *   depth(a) = shortest path length from __start__ to a
 *   a < b  =  a « b  OR  (a ~ b AND depth(a) < depth(b))
 *   a == b =  NOT a < b  AND  NOT b < a     (equivalence class → same row)
 *
 * Nodes in the same equivalence class are placed side-by-side horizontally.
 */
function computeLayers(edges: readonly WorkflowGraphEdge[]): string[][] {
  // Collect all node IDs
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  const nodeList = [...ids];

  // Build adjacency (excluding self-loops)
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (e.from !== e.to) {
      adj.get(e.from)!.push(e.to);
    }
  }

  // Compute reachability via BFS from each node
  const reachable = new Map<string, Set<string>>();
  for (const source of nodeList) {
    const visited = new Set<string>();
    const queue = [source];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (!visited.has(next)) {
          visited.add(next);
          queue.push(next);
        }
      }
    }
    reachable.set(source, visited);
  }

  const reaches = (a: string, b: string): boolean => reachable.get(a)?.has(b) ?? false;

  // a « b = a ~> b AND NOT b ~> a
  const strictlyPrecedes = (a: string, b: string): boolean => reaches(a, b) && !reaches(b, a);

  // Compute depth = shortest path from __start__ via BFS
  const depth = new Map<string, number>();
  {
    const queue = [START_ID];
    depth.set(START_ID, 0);
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const d = depth.get(cur)!;
      for (const next of adj.get(cur) ?? []) {
        if (!depth.has(next)) {
          depth.set(next, d + 1);
          queue.push(next);
        }
      }
    }
  }
  const depthOf = (a: string): number => depth.get(a) ?? Number.MAX_SAFE_INTEGER;

  // a < b = a « b OR (a ~ b AND depth(a) < depth(b))
  const lessThan = (a: string, b: string): boolean => {
    if (strictlyPrecedes(a, b)) return true;
    if (strictlyPrecedes(b, a)) return false;
    // a ~ b: incomparable under «
    return depthOf(a) < depthOf(b);
  };

  // Group into equivalence classes: a == b iff NOT a < b AND NOT b < a
  const assigned = new Set<string>();
  const groups: string[][] = [];

  // Process in a stable order (sorted by depth, then alphabetical)
  const sorted = [...nodeList].sort((a, b) => {
    const dd = depthOf(a) - depthOf(b);
    if (dd !== 0) return dd;
    return a.localeCompare(b);
  });

  for (const node of sorted) {
    if (assigned.has(node)) continue;
    const group = [node];
    assigned.add(node);
    for (const other of sorted) {
      if (assigned.has(other)) continue;
      if (!lessThan(node, other) && !lessThan(other, node)) {
        group.push(other);
        assigned.add(other);
      }
    }
    groups.push(group);
  }

  // Topological sort the groups by <
  groups.sort((ga, gb) => {
    // Use representative: if any a in ga < any b in gb, ga comes first
    for (const a of ga) {
      for (const b of gb) {
        if (lessThan(a, b)) return -1;
        if (lessThan(b, a)) return 1;
      }
    }
    return 0;
  });

  return groups;
}

function buildRoleNode(
  id: string,
  pos: { x: number; y: number },
  roles: Record<string, { description: string }>,
  state: NodeState,
): Node<RoleNodeData> {
  const description = roles[id]?.description ?? "";
  return {
    id,
    type: "role",
    position: pos,
    data: { label: id, description, state },
    draggable: false,
  };
}

function buildTerminalNode(
  id: string,
  pos: { x: number; y: number },
  state: NodeState,
): Node<TerminalNodeData> {
  return {
    id,
    type: "terminal",
    position: pos,
    data: { kind: id === START_ID ? "start" : "end", state },
    draggable: false,
    selectable: false,
  };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: layout logic is inherently branchy
function computeLayout(input: LayoutInput): LayoutResult {
  const layers = computeLayers(input.edges);

  // Flatten layers into a rank map (layer index = rank)
  const rank = new Map<string, number>();
  for (let i = 0; i < layers.length; i++) {
    for (const id of layers[i]) {
      rank.set(id, i);
    }
  }

  // Horizontal gap between nodes in the same layer
  const H_GAP = 40;

  // Position nodes: each layer is a horizontal row
  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();

  // Find max layer width for centering
  const layerWidths: number[] = [];
  for (const layer of layers) {
    let w = 0;
    for (const id of layer) {
      w += nodeSize(id).width;
    }
    w += (layer.length - 1) * H_GAP;
    layerWidths.push(w);
  }
  const maxLayerWidth = Math.max(...layerWidths, ROLE_NODE_WIDTH);
  const centerX = maxLayerWidth / 2;

  let y = 0;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    const totalWidth = layerWidths[li];
    let x = centerX - totalWidth / 2;
    let maxH = 0;
    for (const id of layer) {
      const size = nodeSize(id);
      nodePositions.set(id, { x, y, w: size.width, h: size.height });
      x += size.width + H_GAP;
      if (size.height > maxH) maxH = size.height;
    }
    y += maxH + LAYER_GAP;
  }

  // Build nodes
  const nodes: Node[] = [];
  for (const layer of layers) {
    for (const id of layer) {
      const pos = nodePositions.get(id);
      if (pos === undefined) continue;
      const state = input.nodeStates.get(id) ?? "default";
      if (id === START_ID || id === END_ID) {
        nodes.push(buildTerminalNode(id, { x: pos.x, y: pos.y }, state));
      } else {
        nodes.push(buildRoleNode(id, { x: pos.x, y: pos.y }, input.roles, state));
      }
    }
  }

  // Build edges with label positions
  // For feedback edges (target rank < source rank), we'll compute label at midpoint
  // of the right-side arc. The actual SVG path is drawn by ConditionEdge component.
  // Track feedback edge count per target node for alternating sides
  const feedbackCountByTarget = new Map<string, number>();
  const edges: Edge[] = input.edges.map((e) => {
    const isFallback = e.condition === "FALLBACK";
    const isSelfLoop = e.from === e.to;
    const sourceRank = rank.get(e.from) ?? 0;
    const targetRank = rank.get(e.to) ?? 0;
    const isFeedback = !isSelfLoop && targetRank <= sourceRank;

    const sourcePos = nodePositions.get(e.from);
    const targetPos = nodePositions.get(e.to);

    let labelX: number | null = null;
    let labelY: number | null = null;
    let feedbackSide: "right" | "left" | null = null;

    if (sourcePos !== undefined && targetPos !== undefined) {
      if (isFeedback) {
        // Alternate feedback edges left/right per target node
        const count = feedbackCountByTarget.get(e.to) ?? 0;
        feedbackCountByTarget.set(e.to, count + 1);
        feedbackSide = count % 2 === 0 ? "right" : "left";
        const offsetX =
          feedbackSide === "right"
            ? centerX + ROLE_NODE_WIDTH / 2 + FEEDBACK_OFFSET_X
            : centerX - ROLE_NODE_WIDTH / 2 - FEEDBACK_OFFSET_X;
        const midY = (sourcePos.y + sourcePos.h / 2 + targetPos.y + targetPos.h / 2) / 2;
        labelX = offsetX;
        labelY = midY;
      } else if (!isSelfLoop) {
        // Forward edge: label between source bottom and target top
        const midX = centerX;
        const midY = (sourcePos.y + sourcePos.h + targetPos.y) / 2;
        labelX = midX;
        labelY = midY;
      }
      // Self-loop: let ReactFlow default handle it
    }

    return {
      id: edgeKey(e),
      source: e.from,
      target: e.to,
      sourceHandle: isFeedback
        ? feedbackSide === "left"
          ? "left-out"
          : "right-out"
        : "bottom-out",
      targetHandle: isFeedback ? (feedbackSide === "left" ? "left-in" : "right-in") : "top-in",
      type: "condition",
      data: {
        condition: e.condition,
        conditionDescription: e.conditionDescription,
        isFallback,
        isFeedback,
        isSelfLoop,
        feedbackSide,
        labelX,
        labelY,
      },
    };
  });

  return { nodes, edges };
}

export function useLayout(input: LayoutInput): LayoutResult {
  return useMemo(() => computeLayout(input), [input]);
}
