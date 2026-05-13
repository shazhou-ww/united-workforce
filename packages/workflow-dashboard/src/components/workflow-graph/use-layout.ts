import type { Edge, Node } from "@xyflow/react";
import ELK, { type ElkExtendedEdge, type ElkNode } from "elkjs/lib/elk.bundled.js";
import { useEffect, useState } from "react";
import type { WorkflowGraphEdge } from "../../api.ts";
import type { ConditionEdgeData, NodeState, RoleNodeData, TerminalNodeData } from "./types.ts";

const START_ID = "__start__";
const END_ID = "__end__";
const ROLE_NODE_WIDTH = 180;
const ROLE_NODE_HEIGHT = 60;
const TERMINAL_NODE_SIZE = 40;

type LayoutInput = {
  edges: readonly WorkflowGraphEdge[];
  roles: Record<string, { description: string }>;
  nodeStates: Map<string, NodeState>;
};

type LayoutResult = {
  nodes: Node[];
  edges: Edge[];
};

function collectNodeIds(edges: readonly WorkflowGraphEdge[]): Set<string> {
  const ids = new Set<string>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  return ids;
}

function nodeSize(id: string): { width: number; height: number } {
  if (id === START_ID || id === END_ID) {
    return { width: TERMINAL_NODE_SIZE, height: TERMINAL_NODE_SIZE };
  }
  return { width: ROLE_NODE_WIDTH, height: ROLE_NODE_HEIGHT };
}

function edgeKey(e: WorkflowGraphEdge): string {
  return `${e.from}->${e.to}::${e.condition}`;
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

function buildEdge(e: WorkflowGraphEdge, elkEdgeMap: Map<string, ElkExtendedEdge>): Edge<ConditionEdgeData> {
  const isFallback = e.condition === "FALLBACK";
  const key = edgeKey(e);
  const elkEdge = elkEdgeMap.get(key);

  // Extract ELK's computed label position
  let labelX: number | null = null;
  let labelY: number | null = null;
  if (elkEdge?.labels && elkEdge.labels.length > 0) {
    const label = elkEdge.labels[0];
    if (label.x !== undefined && label.y !== undefined) {
      labelX = label.x + (label.width ?? 0) / 2;
      labelY = label.y + (label.height ?? 0) / 2;
    }
  }

  return {
    id: key,
    source: e.from,
    target: e.to,
    type: "condition",
    data: {
      condition: e.condition,
      conditionDescription: e.conditionDescription,
      isFallback,
      elkLabelX: labelX,
      elkLabelY: labelY,
    } as ConditionEdgeData,
  };
}

const elk = new ELK();

async function computeLayout(input: LayoutInput): Promise<LayoutResult> {
  const ids = collectNodeIds(input.edges);

  const elkNodes: ElkNode[] = [];
  for (const id of ids) {
    const size = nodeSize(id);
    elkNodes.push({ id, width: size.width, height: size.height });
  }

  const elkEdges: ElkExtendedEdge[] = input.edges
    .filter((e) => e.from !== e.to)
    .map((e) => ({
      id: edgeKey(e),
      sources: [e.from],
      targets: [e.to],
      labels: e.condition !== ""
        ? [{ text: e.condition, width: Math.max(e.condition.length * 7 + 16, 60), height: 22 }]
        : [],
    }));

  const graph: ElkNode = {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "DOWN",
      // Node spacing
      "elk.spacing.nodeNode": "30",
      "elk.layered.spacing.nodeNodeBetweenLayers": "50",
      // Edge spacing — keep edges apart from each other and from nodes
      "elk.spacing.edgeNode": "25",
      "elk.spacing.edgeEdge": "15",
      "elk.layered.spacing.edgeNodeBetweenLayers": "25",
      "elk.layered.spacing.edgeEdgeBetweenLayers": "15",
      // Edge routing
      "elk.edgeRouting": "ORTHOGONAL",
      "elk.layered.mergeEdges": "false",
      // Node placement
      "elk.layered.nodePlacement.strategy": "NETWORK_SIMPLEX",
      // Edge label placement
      "elk.edgeLabels.placement": "CENTER",
      // Crossing minimization
      "elk.layered.crossingMinimization.strategy": "LAYER_SWEEP",
      // Compaction
      "elk.layered.compaction.postCompaction.strategy": "EDGE_LENGTH",
      // Cycle breaking — keep main flow top-to-bottom
      "elk.layered.cycleBreaking.strategy": "DEPTH_FIRST",
    },
    children: elkNodes,
    edges: elkEdges,
  };

  const laid = await elk.layout(graph);

  // Build map of ELK edge results for label positions
  const elkEdgeMap = new Map<string, ElkExtendedEdge>();
  for (const e of laid.edges ?? []) {
    elkEdgeMap.set(e.id, e);
  }

  const nodes: Node[] = [];
  for (const child of laid.children ?? []) {
    const pos = { x: child.x ?? 0, y: child.y ?? 0 };
    const state = input.nodeStates.get(child.id) ?? "default";
    if (child.id === START_ID || child.id === END_ID) {
      nodes.push(buildTerminalNode(child.id, pos, state));
    } else {
      nodes.push(buildRoleNode(child.id, pos, input.roles, state));
    }
  }

  const edges: Edge[] = input.edges.map((e) => buildEdge(e, elkEdgeMap));

  return { nodes, edges };
}

const EMPTY_LAYOUT: LayoutResult = { nodes: [], edges: [] };

export function useLayout(input: LayoutInput): LayoutResult {
  const [layout, setLayout] = useState<LayoutResult>(EMPTY_LAYOUT);

  const edgeJson = JSON.stringify(input.edges);
  const roleJson = JSON.stringify(input.roles);

  useEffect(() => {
    let cancelled = false;
    const parsed = {
      edges: JSON.parse(edgeJson) as readonly WorkflowGraphEdge[],
      roles: JSON.parse(roleJson) as Record<string, { description: string }>,
      nodeStates: input.nodeStates,
    };
    computeLayout(parsed).then((result) => {
      if (!cancelled) setLayout(result);
    });
    return () => {
      cancelled = true;
    };
  }, [edgeJson, roleJson, input.nodeStates]);

  return layout;
}
