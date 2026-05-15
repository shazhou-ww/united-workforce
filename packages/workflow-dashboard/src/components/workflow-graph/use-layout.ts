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

// ── Strategy 1: Longest-path layering (Sugiyama step 1) ─────────────

/**
 * Assign layers via longest path from sources.
 *
 * For each node, rank = max(rank(pred) + 1) over all predecessors.
 * This guarantees that if a -> b (and not b -> a), rank(a) < rank(b).
 *
 * Back-edges (cycles) are detected and excluded from ranking:
 * we first remove edges that create cycles (DFS-based), compute ranks
 * on the resulting DAG, then the removed edges become feedback edges.
 */
function computeLayersLongestPath(edges: readonly WorkflowGraphEdge[]): string[][] {
  // Collect all node IDs
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }

  // Build adjacency (excluding self-loops)
  const adj = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();
  for (const id of ids) {
    adj.set(id, []);
    inEdges.set(id, []);
  }
  // Detect back-edges via DFS to break cycles
  const backEdges = new Set<string>();
  {
    const WHITE = 0;
    const GRAY = 1;
    const BLACK = 2;
    const color = new Map<string, number>();
    for (const id of ids) color.set(id, WHITE);

    // Temporary full adjacency for cycle detection
    const fullAdj = new Map<string, string[]>();
    for (const id of ids) fullAdj.set(id, []);
    for (const e of edges) {
      if (e.from !== e.to) fullAdj.get(e.from)?.push(e.to);
    }

    function dfs(u: string): void {
      color.set(u, GRAY);
      for (const v of fullAdj.get(u) ?? []) {
        const c = color.get(v) ?? WHITE;
        if (c === GRAY) {
          // Back-edge: u -> v where v is an ancestor
          backEdges.add(`${u}->${v}`);
        } else if (c === WHITE) {
          dfs(v);
        }
      }
      color.set(u, BLACK);
    }

    // Start DFS from __start__ first for determinism
    if (ids.has(START_ID)) dfs(START_ID);
    for (const id of ids) {
      if ((color.get(id) ?? WHITE) === WHITE) dfs(id);
    }
  }

  // Build DAG adjacency (without back-edges)
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (backEdges.has(`${e.from}->${e.to}`)) continue;
    adj.get(e.from)?.push(e.to);
    inEdges.get(e.to)?.push(e.from);
  }

  // Longest-path ranking via topological order (Kahn's algorithm)
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, 0);
  for (const id of ids) {
    for (const next of adj.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }

  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) {
    if ((inDegree.get(id) ?? 0) === 0) {
      queue.push(id);
      rank.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift()!;
    const curRank = rank.get(cur) ?? 0;
    for (const next of adj.get(cur) ?? []) {
      // Longest path: take max
      const prevRank = rank.get(next) ?? 0;
      if (curRank + 1 > prevRank) {
        rank.set(next, curRank + 1);
      }
      const deg = (inDegree.get(next) ?? 1) - 1;
      inDegree.set(next, deg);
      if (deg === 0) {
        queue.push(next);
      }
    }
  }

  // Group by rank
  const maxRank = Math.max(...[...rank.values()], 0);
  const layers: string[][] = [];
  for (let r = 0; r <= maxRank; r++) {
    layers.push([]);
  }
  for (const [id, r] of rank) {
    layers[r].push(id);
  }

  // Sort within layers alphabetically for stability, but __start__ first, __end__ last
  for (const layer of layers) {
    layer.sort((a, b) => {
      if (a === START_ID) return -1;
      if (b === START_ID) return 1;
      if (a === END_ID) return 1;
      if (b === END_ID) return -1;
      return a.localeCompare(b);
    });
  }

  // Remove empty layers
  return layers.filter((l) => l.length > 0);
}

// ── Shared helpers ──────────────────────────────────────────────────

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

// ── Longest-path layout (uses same edge-building as before) ─────────

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: layout logic is inherently branchy
function computeLayoutLongestPath(input: LayoutInput): LayoutResult {
  const layers = computeLayersLongestPath(input.edges);

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
  const routedCountByTarget = new Map<string, number>();
  const edges: Edge[] = input.edges.map((e) => {
    const isFallback = e.condition === "FALLBACK";
    const isSelfLoop = e.from === e.to;
    const sourceRank = rank.get(e.from) ?? 0;
    const targetRank = rank.get(e.to) ?? 0;
    const isFeedback = !isSelfLoop && targetRank <= sourceRank;
    const isSkipForward = !isSelfLoop && !isFeedback && targetRank - sourceRank > 1;

    const sourcePos = nodePositions.get(e.from);
    const targetPos = nodePositions.get(e.to);

    let labelX: number | null = null;
    let labelY: number | null = null;
    let feedbackSide: "right" | "left" | null = null;

    if (sourcePos !== undefined && targetPos !== undefined) {
      if (isFeedback || isSkipForward) {
        const count = routedCountByTarget.get(e.to) ?? 0;
        routedCountByTarget.set(e.to, count + 1);
        feedbackSide = count % 2 === 0 ? "right" : "left";
        const offsetX =
          feedbackSide === "right"
            ? centerX + ROLE_NODE_WIDTH / 2 + FEEDBACK_OFFSET_X
            : centerX - ROLE_NODE_WIDTH / 2 - FEEDBACK_OFFSET_X;
        const midY = (sourcePos.y + sourcePos.h / 2 + targetPos.y + targetPos.h / 2) / 2;
        labelX = offsetX;
        labelY = midY;
      } else if (!isSelfLoop) {
        const midX = centerX;
        const midY = (sourcePos.y + sourcePos.h + targetPos.y) / 2;
        labelX = midX;
        labelY = midY;
      }
    }

    return {
      id: edgeKey(e),
      source: e.from,
      target: e.to,
      sourceHandle:
        isFeedback || isSkipForward
          ? feedbackSide === "left"
            ? "left-out"
            : "right-out"
          : "bottom-out",
      targetHandle:
        isFeedback || isSkipForward ? (feedbackSide === "left" ? "left-in" : "right-in") : "top-in",
      type: "condition",
      data: {
        condition: e.condition,
        conditionDescription: e.conditionDescription,
        isFallback,
        isFeedback: isFeedback || isSkipForward,
        isSelfLoop,
        feedbackSide,
        labelX,
        labelY,
      },
    };
  });

  return { nodes, edges };
}

// ── Public hook ─────────────────────────────────────────────────────

export function useLayout(input: LayoutInput): LayoutResult {
  return useMemo(() => computeLayoutLongestPath(input), [input]);
}
