import {
  Background,
  type EdgeTypes,
  MarkerType,
  type Node,
  type NodeMouseHandler,
  type NodeTypes,
  ReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useMemo } from "react";
import type { WorkflowGraph as WorkflowGraphData } from "../../api.ts";
import { useTheme } from "../../hooks/use-theme.tsx";
import { ConditionEdge } from "./condition-edge.tsx";
import { RoleNode } from "./role-node.tsx";
import { TerminalNode } from "./terminal-node.tsx";
import type { NodeState } from "./types.ts";
import { useLayout } from "./use-layout.ts";

type Props = {
  graph: WorkflowGraphData;
  roles: Record<string, { description: string }>;
  nodeStates: Map<string, NodeState>;
  onNodeClick: ((roleName: string) => void) | null;
};

const nodeTypes: NodeTypes = {
  role: RoleNode,
  terminal: TerminalNode,
};

const edgeTypes: EdgeTypes = {
  condition: ConditionEdge,
};

function handleNodeClick(onNodeClick: (nodeId: string) => void, node: Node): void {
  if (node.type !== "role" && node.type !== "terminal") return;
  onNodeClick(node.id);
}

export function WorkflowGraph({ graph, roles, nodeStates, onNodeClick }: Props) {
  const layout = useLayout({ edges: graph.edges, roles, nodeStates });
  const { theme } = useTheme();

  const onNodeClickHandler: NodeMouseHandler | undefined =
    onNodeClick !== null
      ? (_e: React.MouseEvent, node: Node) => handleNodeClick(onNodeClick, node)
      : undefined;

  const styledEdges = useMemo(
    () =>
      layout.edges.map((e) => ({
        ...e,
        markerEnd: {
          type: MarkerType.ArrowClosed,
          width: 14,
          height: 14,
          color: "hsl(var(--foreground))",
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
      onNodeClick={onNodeClickHandler}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.3}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      proOptions={{ hideAttribution: true }}
      colorMode={theme}
      style={{ background: "hsl(var(--background))" }}
    >
      <Background color="hsl(var(--border))" gap={20} size={1} />
    </ReactFlow>
  );
}
