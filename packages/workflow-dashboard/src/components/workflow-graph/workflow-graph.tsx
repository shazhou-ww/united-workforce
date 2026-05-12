import { Background, type EdgeTypes, MarkerType, type NodeTypes, ReactFlow } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { WorkflowGraph as WorkflowGraphData } from "../../api.ts";
import { ConditionEdge } from "./condition-edge.tsx";
import { RoleNode } from "./role-node.tsx";
import { TerminalNode } from "./terminal-node.tsx";
import type { NodeState } from "./types.ts";
import { useLayout } from "./use-layout.ts";

type Props = {
  graph: WorkflowGraphData;
  roles: Record<string, { description: string }>;
  nodeStates: Map<string, NodeState>;
};

const nodeTypes: NodeTypes = {
  role: RoleNode,
  terminal: TerminalNode,
};

const edgeTypes: EdgeTypes = {
  condition: ConditionEdge,
};

export function WorkflowGraph({ graph, roles, nodeStates }: Props) {
  const layout = useLayout({ edges: graph.edges, roles, nodeStates });

  const styledEdges = useMemo(
    () =>
      layout.edges.map((e) => ({
        ...e,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "var(--color-text)",
        },
      })),
    [layout.edges],
  );

  return (
    <ReactFlow
      nodes={layout.nodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode="dark"
      style={{ background: "var(--color-bg)" }}
    >
      <Background color="var(--color-border)" gap={20} size={1} />
    </ReactFlow>
  );
}
