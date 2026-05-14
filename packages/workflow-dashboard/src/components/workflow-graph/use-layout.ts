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
const FEEDBACK_OFFSET_X = 140;

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
 * Extract the linear spine from the graph using topological ordering.
 * Forward edges go from lower rank to higher rank; feedback edges go backwards.
 * Self-loops are neither forward nor feedback — they're handled separately.
 */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: topological sort is inherently branchy
function extractSpine(edges: readonly WorkflowGraphEdge[]): string[] {
  // Collect all node IDs
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }

  // Build adjacency for forward edges only (non-self-loop, non-FALLBACK-back)
  // Strategy: BFS from __start__, picking the first non-FALLBACK forward edge,
  // or FALLBACK if no other option.
  const forwardAdj = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const existing = forwardAdj.get(e.from) ?? [];
    existing.push(e.to);
    forwardAdj.set(e.from, existing);
  }

  // Walk the main path: prefer non-FALLBACK edges for the spine ordering
  const visited = new Set<string>();
  const spine: string[] = [];

  // Build a set of "primary" next targets per node (non-FALLBACK first)
  const primaryNext = new Map<string, string>();
  const edgesByFrom = new Map<string, WorkflowGraphEdge[]>();
  for (const e of edges) {
    if (e.from === e.to) continue;
    const list = edgesByFrom.get(e.from) ?? [];
    list.push(e);
    edgesByFrom.set(e.from, list);
  }

  // For each node, the "primary" next is the first non-FALLBACK target,
  // or the FALLBACK target if all edges are FALLBACK
  for (const [from, edgeList] of edgesByFrom) {
    const nonFallback = edgeList.find((e) => e.condition !== "FALLBACK");
    const fallback = edgeList.find((e) => e.condition === "FALLBACK");
    primaryNext.set(from, nonFallback?.to ?? fallback?.to ?? "");
  }

  // Walk the spine from __start__
  let current: string | null = START_ID;
  while (current !== null && !visited.has(current)) {
    visited.add(current);
    spine.push(current);
    const next = primaryNext.get(current);
    if (next !== undefined && next !== "" && !visited.has(next)) {
      current = next;
    } else {
      current = null;
    }
  }

  // Add any remaining nodes not on the main path (shouldn't normally happen)
  for (const id of ids) {
    if (!visited.has(id)) {
      spine.push(id);
    }
  }

  return spine;
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

function computeLayout(input: LayoutInput): LayoutResult {
  const spine = extractSpine(input.edges);
  const rank = new Map<string, number>();
  for (let i = 0; i < spine.length; i++) {
    rank.set(spine[i], i);
  }

  // Position nodes along a vertical spine, centered horizontally
  const centerX = ROLE_NODE_WIDTH / 2; // left edge at x=0, center at width/2
  const nodePositions = new Map<string, { x: number; y: number; w: number; h: number }>();

  let y = 0;
  for (const id of spine) {
    const size = nodeSize(id);
    // Center-align all nodes on the spine
    const x = centerX - size.width / 2;
    nodePositions.set(id, { x, y, w: size.width, h: size.height });
    y += size.height + LAYER_GAP;
  }

  // Build nodes
  const nodes: Node[] = [];
  for (const id of spine) {
    const pos = nodePositions.get(id);
    if (pos === undefined) continue;
    const state = input.nodeStates.get(id) ?? "default";
    if (id === START_ID || id === END_ID) {
      nodes.push(buildTerminalNode(id, { x: pos.x, y: pos.y }, state));
    } else {
      nodes.push(buildRoleNode(id, { x: pos.x, y: pos.y }, input.roles, state));
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
      sourceHandle: isFeedback ? (feedbackSide === "left" ? "left-out" : "right-out") : undefined,
      targetHandle: isFeedback ? (feedbackSide === "left" ? "left-in" : "right-in") : undefined,
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
