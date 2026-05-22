import type { AnyWorkNode, AnyWorkEdge, WorkNode, ConditionalEdge } from '../type';
import type { WorkFlowStep, WorkFlowTransition } from './type';

export function transOut(nodes: AnyWorkNode[], edges: AnyWorkEdge[]): WorkFlowStep[] {
  const nodeMap = new Map<string, AnyWorkNode>();
  for (const node of nodes) {
    nodeMap.set(node.id, node);
  }

  const outgoingEdges = new Map<string, AnyWorkEdge[]>();
  for (const edge of edges) {
    if (!outgoingEdges.has(edge.source)) {
      outgoingEdges.set(edge.source, []);
    }
    outgoingEdges.get(edge.source)!.push(edge);
  }

  const startOutEdges = outgoingEdges.get('start') ?? [];
  if (startOutEdges.length === 0) return [];

  const firstNodeId = startOutEdges[0].target;
  const visited = new Set<string>();
  const steps: WorkFlowStep[] = [];

  traverse(firstNodeId, nodeMap, outgoingEdges, visited, steps);

  return steps;
}

function traverse(
  nodeId: string,
  nodeMap: Map<string, AnyWorkNode>,
  outgoingEdges: Map<string, AnyWorkEdge[]>,
  visited: Set<string>,
  steps: WorkFlowStep[],
): void {
  if (visited.has(nodeId) || nodeId === 'start' || nodeId === 'end') return;
  visited.add(nodeId);

  const node = nodeMap.get(nodeId);
  if (!node || node.type !== 'role') return;

  const roleNode = node as WorkNode<'role'>;
  const outEdges = outgoingEdges.get(nodeId) ?? [];

  const transitions: WorkFlowTransition[] = outEdges.map((edge, index) => {
    const targetNode = nodeMap.get(edge.target);
    const target = edge.target === 'end'
      ? 'END'
      : (targetNode?.type === 'role' ? (targetNode as WorkNode<'role'>).data.name : edge.target);

    let condition: string | null = null;
    if (edge.type === 'conditional') {
      const isElse = outEdges.length >= 2 && index === 0;
      condition = isElse ? null : ((edge as ConditionalEdge).data?.condition ?? null);
    }

    return { target, condition };
  });

  const { name, description, identity, prepare, execute, report } = roleNode.data;
  steps.push({
    role: { name, description, identity, prepare, execute, report },
    transitions,
  });

  for (const edge of outEdges) {
    traverse(edge.target, nodeMap, outgoingEdges, visited, steps);
  }
}
