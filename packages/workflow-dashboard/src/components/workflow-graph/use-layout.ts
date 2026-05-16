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

function collectNodeIds(edges: readonly WorkflowGraphEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return ids;
}

function detectBackEdges(ids: Set<string>, edges: readonly WorkflowGraphEdge[]): Set<string> {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const backEdges = new Set<string>();
  const color = new Map<string, number>();
  for (const id of ids) color.set(id, WHITE);

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
        backEdges.add(`${u}->${v}`);
      } else if (c === WHITE) {
        dfs(v);
      }
    }
    color.set(u, BLACK);
  }

  if (ids.has(START_ID)) dfs(START_ID);
  for (const id of ids) {
    if ((color.get(id) ?? WHITE) === WHITE) dfs(id);
  }
  return backEdges;
}

function buildDagAdjacency(
  ids: Set<string>,
  edges: readonly WorkflowGraphEdge[],
  backEdges: Set<string>,
): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const id of ids) adj.set(id, []);
  for (const e of edges) {
    if (e.from === e.to) continue;
    if (backEdges.has(`${e.from}->${e.to}`)) continue;
    adj.get(e.from)?.push(e.to);
  }
  return adj;
}

function computeInDegrees(ids: Set<string>, adj: Map<string, string[]>): Map<string, number> {
  const inDegree = new Map<string, number>();
  for (const id of ids) inDegree.set(id, 0);
  for (const id of ids) {
    for (const next of adj.get(id) ?? []) {
      inDegree.set(next, (inDegree.get(next) ?? 0) + 1);
    }
  }
  return inDegree;
}

function relaxLongestPathNeighbors(
  cur: string,
  curRank: number,
  adj: Map<string, string[]>,
  rank: Map<string, number>,
  inDegree: Map<string, number>,
  queue: string[],
): void {
  for (const next of adj.get(cur) ?? []) {
    const prevRank = rank.get(next) ?? 0;
    if (curRank + 1 > prevRank) rank.set(next, curRank + 1);
    const deg = (inDegree.get(next) ?? 1) - 1;
    inDegree.set(next, deg);
    if (deg === 0) queue.push(next);
  }
}

function longestPathRanks(ids: Set<string>, adj: Map<string, string[]>): Map<string, number> {
  const inDegree = computeInDegrees(ids, adj);
  const rank = new Map<string, number>();
  const queue: string[] = [];
  for (const id of ids) {
    if ((inDegree.get(id) ?? 0) === 0) {
      queue.push(id);
      rank.set(id, 0);
    }
  }

  while (queue.length > 0) {
    const cur = queue.shift();
    if (cur === undefined) break;
    relaxLongestPathNeighbors(cur, rank.get(cur) ?? 0, adj, rank, inDegree, queue);
  }
  return rank;
}

function compareLayerNodes(a: string, b: string): number {
  if (a === START_ID) return -1;
  if (b === START_ID) return 1;
  if (a === END_ID) return 1;
  if (b === END_ID) return -1;
  return a.localeCompare(b);
}

function ranksToLayers(rank: Map<string, number>): string[][] {
  const maxRank = Math.max(...[...rank.values()], 0);
  const layers: string[][] = [];
  for (let r = 0; r <= maxRank; r++) layers.push([]);
  for (const [id, r] of rank) layers[r].push(id);
  for (const layer of layers) layer.sort(compareLayerNodes);
  return layers.filter((l) => l.length > 0);
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
  const ids = collectNodeIds(edges);
  const backEdges = detectBackEdges(ids, edges);
  const adj = buildDagAdjacency(ids, edges, backEdges);
  const rank = longestPathRanks(ids, adj);
  return ranksToLayers(rank);
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

type EdgeLayoutContext = {
  rank: Map<string, number>;
  nodePositions: Map<string, { x: number; y: number; w: number; h: number }>;
  centerX: number;
  routedCountByTarget: Map<string, number>;
};

function computeEdgeLabelPosition(
  e: WorkflowGraphEdge,
  ctx: EdgeLayoutContext,
  isFeedback: boolean,
  isSkipForward: boolean,
  isSelfLoop: boolean,
): { labelX: number | null; labelY: number | null; feedbackSide: "right" | "left" | null } {
  const sourcePos = ctx.nodePositions.get(e.from);
  const targetPos = ctx.nodePositions.get(e.to);
  if (sourcePos === undefined || targetPos === undefined) {
    return { labelX: null, labelY: null, feedbackSide: null };
  }

  if (isFeedback || isSkipForward) {
    const count = ctx.routedCountByTarget.get(e.to) ?? 0;
    ctx.routedCountByTarget.set(e.to, count + 1);
    const feedbackSide = count % 2 === 0 ? "right" : "left";
    const offsetX =
      feedbackSide === "right"
        ? ctx.centerX + ROLE_NODE_WIDTH / 2 + FEEDBACK_OFFSET_X
        : ctx.centerX - ROLE_NODE_WIDTH / 2 - FEEDBACK_OFFSET_X;
    const midY = (sourcePos.y + sourcePos.h / 2 + targetPos.y + targetPos.h / 2) / 2;
    return { labelX: offsetX, labelY: midY, feedbackSide };
  }

  if (isSelfLoop) {
    return { labelX: null, labelY: null, feedbackSide: null };
  }

  const midY = (sourcePos.y + sourcePos.h + targetPos.y) / 2;
  return { labelX: ctx.centerX, labelY: midY, feedbackSide: null };
}

function buildConditionEdge(e: WorkflowGraphEdge, ctx: EdgeLayoutContext): Edge {
  const isFallback = e.condition === "FALLBACK";
  const isSelfLoop = e.from === e.to;
  const sourceRank = ctx.rank.get(e.from) ?? 0;
  const targetRank = ctx.rank.get(e.to) ?? 0;
  const isFeedback = !isSelfLoop && targetRank <= sourceRank;
  const isSkipForward = !isSelfLoop && !isFeedback && targetRank - sourceRank > 1;
  const routed = isFeedback || isSkipForward;

  const { labelX, labelY, feedbackSide } = computeEdgeLabelPosition(
    e,
    ctx,
    isFeedback,
    isSkipForward,
    isSelfLoop,
  );

  return {
    id: edgeKey(e),
    source: e.from,
    target: e.to,
    sourceHandle: routed ? (feedbackSide === "left" ? "left-out" : "right-out") : "bottom-out",
    targetHandle: routed ? (feedbackSide === "left" ? "left-in" : "right-in") : "top-in",
    type: "condition",
    data: {
      condition: e.condition,
      conditionDescription: e.conditionDescription,
      isFallback,
      isFeedback: routed,
      isSelfLoop,
      feedbackSide,
      labelX,
      labelY,
    },
  };
}

const LAYER_H_GAP = 40;

type NodePosition = { x: number; y: number; w: number; h: number };

function layerIndexRank(layers: string[][]): Map<string, number> {
  const rank = new Map<string, number>();
  for (let i = 0; i < layers.length; i++) {
    for (const id of layers[i]) rank.set(id, i);
  }
  return rank;
}

function computeLayerWidths(layers: string[][], hGap: number): number[] {
  return layers.map((layer) => {
    let w = 0;
    for (const id of layer) w += nodeSize(id).width;
    return w + (layer.length - 1) * hGap;
  });
}

function layoutNodePositions(
  layers: string[][],
  layerWidths: number[],
  centerX: number,
  hGap: number,
): Map<string, NodePosition> {
  const nodePositions = new Map<string, NodePosition>();
  let y = 0;
  for (let li = 0; li < layers.length; li++) {
    const layer = layers[li];
    let x = centerX - layerWidths[li] / 2;
    let maxH = 0;
    for (const id of layer) {
      const size = nodeSize(id);
      nodePositions.set(id, { x, y, w: size.width, h: size.height });
      x += size.width + hGap;
      if (size.height > maxH) maxH = size.height;
    }
    y += maxH + LAYER_GAP;
  }
  return nodePositions;
}

function buildLayoutNodes(
  layers: string[][],
  nodePositions: Map<string, NodePosition>,
  input: LayoutInput,
): Node[] {
  const nodes: Node[] = [];
  for (const layer of layers) {
    for (const id of layer) {
      const pos = nodePositions.get(id);
      if (pos === undefined) continue;
      const state = input.nodeStates.get(id) ?? "default";
      const xy = { x: pos.x, y: pos.y };
      if (id === START_ID || id === END_ID) {
        nodes.push(buildTerminalNode(id, xy, state));
      } else {
        nodes.push(buildRoleNode(id, xy, input.roles, state));
      }
    }
  }
  return nodes;
}

// ── Longest-path layout (uses same edge-building as before) ─────────

function computeLayoutLongestPath(input: LayoutInput): LayoutResult {
  const layers = computeLayersLongestPath(input.edges);
  const rank = layerIndexRank(layers);
  const layerWidths = computeLayerWidths(layers, LAYER_H_GAP);
  const centerX = Math.max(...layerWidths, ROLE_NODE_WIDTH) / 2;
  const nodePositions = layoutNodePositions(layers, layerWidths, centerX, LAYER_H_GAP);
  const nodes = buildLayoutNodes(layers, nodePositions, input);
  const edgeCtx: EdgeLayoutContext = {
    rank,
    nodePositions,
    centerX,
    routedCountByTarget: new Map<string, number>(),
  };
  const edges: Edge[] = input.edges.map((e) => buildConditionEdge(e, edgeCtx));
  return { nodes, edges };
}

// ── Public hook ─────────────────────────────────────────────────────

export function useLayout(input: LayoutInput): LayoutResult {
  return useMemo(() => computeLayoutLongestPath(input), [input]);
}
