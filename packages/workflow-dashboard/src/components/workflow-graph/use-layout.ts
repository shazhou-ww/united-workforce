import Dagre from "@dagrejs/dagre";
import type { Edge, Node } from "@xyflow/react";
import { useMemo } from "react";
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

function edgeKey(e: WorkflowGraphEdge): string {
  return `${e.from}->${e.to}::${e.condition}`;
}

function buildEdge(e: WorkflowGraphEdge): Edge<ConditionEdgeData> {
  const isFallback = e.condition === "FALLBACK";
  return {
    id: edgeKey(e),
    source: e.from,
    target: e.to,
    type: "condition",
    data: {
      condition: e.condition,
      conditionDescription: e.conditionDescription,
      isFallback,
    },
  };
}

export function useLayout(input: LayoutInput): LayoutResult {
  return useMemo(() => {
    const ids = collectNodeIds(input.edges);

    const g = new Dagre.graphlib.Graph({ multigraph: true }).setDefaultEdgeLabel(() => ({}));
    g.setGraph({ rankdir: "TB", nodesep: 60, ranksep: 80 });

    for (const id of ids) {
      const size = nodeSize(id);
      g.setNode(id, { width: size.width, height: size.height });
    }
    for (const e of input.edges) {
      if (e.from === e.to) {
        continue;
      }
      g.setEdge(e.from, e.to, {}, edgeKey(e));
    }

    Dagre.layout(g);

    const nodes: Node[] = [];
    for (const id of ids) {
      const dagNode = g.node(id);
      const size = nodeSize(id);
      const pos = { x: dagNode.x - size.width / 2, y: dagNode.y - size.height / 2 };
      const state = input.nodeStates.get(id) ?? "default";
      if (id === START_ID || id === END_ID) {
        nodes.push(buildTerminalNode(id, pos, state));
      } else {
        nodes.push(buildRoleNode(id, pos, input.roles, state));
      }
    }

    const edges: Edge[] = input.edges.map(buildEdge);

    return { nodes, edges };
  }, [input.edges, input.roles, input.nodeStates]);
}
