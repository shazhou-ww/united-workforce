import {
  Background,
  type EdgeTypes,
  MarkerType,
  type Node,
  type NodeTypes,
  type OnNodeClick,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useEffect, useMemo } from "react";
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
  onNodeClick: ((roleName: string) => void) | null;
};

const nodeTypes: NodeTypes = {
  role: RoleNode,
  terminal: TerminalNode,
};

const edgeTypes: EdgeTypes = {
  condition: ConditionEdge,
};

function handleRoleNodeClick(onRoleClick: (roleName: string) => void, node: Node): void {
  if (node.type !== "role") return;
  onRoleClick(node.id);
}

function WorkflowGraphInner({ graph, roles, nodeStates, onNodeClick }: Props) {
  const layout = useLayout({ edges: graph.edges, roles, nodeStates });
  const { fitView } = useReactFlow();

  const onNodeClickHandler: OnNodeClick | undefined =
    onNodeClick !== null ? (_e, node) => handleRoleNodeClick(onNodeClick, node) : undefined;

  // Re-fit when layout changes (ELK is async)
  // Use requestAnimationFrame + setTimeout to ensure ReactFlow has processed nodes
  useEffect(() => {
    if (layout.nodes.length > 0) {
      let cancelled = false;
      requestAnimationFrame(() => {
        if (cancelled) return;
        setTimeout(() => {
          if (!cancelled) fitView({ padding: 0.1, duration: 300 });
        }, 300);
      });
      return () => {
        cancelled = true;
      };
    }
  }, [layout.nodes, layout.edges, fitView]);

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

  // Generate a stable key that changes when layout changes, to force ReactFlow remount + fitView
  const layoutKey = useMemo(
    () => layout.nodes.map((n) => `${n.id}:${n.position.x}:${n.position.y}`).join(","),
    [layout.nodes],
  );

  return (
    <ReactFlow
      key={layoutKey}
      nodes={layout.nodes}
      edges={styledEdges}
      nodeTypes={nodeTypes}
      edgeTypes={edgeTypes}
      onNodeClick={onNodeClickHandler}
      fitView
      fitViewOptions={{ padding: 0.1, minZoom: 0.1, maxZoom: 1.5 }}
      minZoom={0.1}
      maxZoom={1.5}
      defaultViewport={{ x: 0, y: 0, zoom: 0.5 }}
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

export function WorkflowGraph(props: Props) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphInner {...props} />
    </ReactFlowProvider>
  );
}
