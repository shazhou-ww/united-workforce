import type { AnyWorkEdge, AnyWorkNode, ConditionalEdge } from "../type";

export type ValidationError = {
  nodeId: string | null;
  message: string;
};

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

export function validate(nodes: AnyWorkNode[], edges: AnyWorkEdge[]): ValidationResult {
  const errors: ValidationError[] = [];

  const outgoing = buildEdgeMap(edges, "source");
  const incoming = buildEdgeMap(edges, "target");

  const startNodes = nodes.filter((n) => n.type === "start");
  const endNodes = nodes.filter((n) => n.type === "end");
  const roleNodes = nodes.filter((n) => n.type === "role");

  validateStartNode(startNodes, outgoing, errors);
  validateEndNode(endNodes, incoming, outgoing, errors);
  validateRoleNodes(roleNodes, outgoing, incoming, errors);
  validateRoleCount(roleNodes, errors);
  validateReachability(nodes, edges, startNodes, endNodes, errors);

  return { valid: errors.length === 0, errors };
}

function buildEdgeMap(edges: AnyWorkEdge[], key: "source" | "target"): Map<string, AnyWorkEdge[]> {
  const map = new Map<string, AnyWorkEdge[]>();
  for (const edge of edges) {
    const id = edge[key];
    if (!map.has(id)) {
      map.set(id, []);
    }
    map.get(id)?.push(edge);
  }
  return map;
}

function validateStartNode(
  startNodes: AnyWorkNode[],
  outgoing: Map<string, AnyWorkEdge[]>,
  errors: ValidationError[],
): void {
  if (startNodes.length === 0) {
    errors.push({ nodeId: null, message: "缺少 Start 节点" });
    return;
  }
  if (startNodes.length > 1) {
    errors.push({ nodeId: null, message: "Start 节点只能有一个" });
    return;
  }

  const startId = startNodes[0].id;
  const outEdges = outgoing.get(startId) ?? [];
  if (outEdges.length === 0) {
    errors.push({ nodeId: startId, message: "Start 节点必须有一个输出连接" });
  } else if (outEdges.length > 1) {
    errors.push({ nodeId: startId, message: "Start 节点只能有一个输出连接" });
  }
}

function validateEndNode(
  endNodes: AnyWorkNode[],
  incoming: Map<string, AnyWorkEdge[]>,
  outgoing: Map<string, AnyWorkEdge[]>,
  errors: ValidationError[],
): void {
  if (endNodes.length === 0) {
    errors.push({ nodeId: null, message: "缺少 End 节点" });
    return;
  }
  if (endNodes.length > 1) {
    errors.push({ nodeId: null, message: "End 节点只能有一个" });
    return;
  }

  const endId = endNodes[0].id;
  const inEdges = incoming.get(endId) ?? [];
  if (inEdges.length === 0) {
    errors.push({ nodeId: endId, message: "End 节点必须有至少一个输入连接" });
  }

  const outEdges = outgoing.get(endId) ?? [];
  if (outEdges.length > 0) {
    errors.push({ nodeId: endId, message: "End 节点不能有输出连接" });
  }
}

function validateRoleNodes(
  roleNodes: AnyWorkNode[],
  outgoing: Map<string, AnyWorkEdge[]>,
  incoming: Map<string, AnyWorkEdge[]>,
  errors: ValidationError[],
): void {
  for (const node of roleNodes) {
    const inEdges = incoming.get(node.id) ?? [];
    const outEdges = outgoing.get(node.id) ?? [];

    if (inEdges.length === 0) {
      errors.push({ nodeId: node.id, message: "角色节点缺少输入连接" });
    }
    if (outEdges.length === 0) {
      errors.push({ nodeId: node.id, message: "角色节点缺少输出连接" });
    }

    if (outEdges.length > 1) {
      const conditionalEdges = outEdges.filter((e) => e.type === "conditional");
      if (conditionalEdges.length !== outEdges.length) {
        errors.push({ nodeId: node.id, message: "多输出节点的所有出边必须附带条件" });
      } else {
        const ifEdges = conditionalEdges.slice(1);
        for (const edge of ifEdges) {
          const condEdge = edge as ConditionalEdge;
          if (!condEdge.data?.condition?.trim()) {
            errors.push({ nodeId: node.id, message: "条件边的条件表达式不能为空" });
            break;
          }
        }
      }
    }
  }
}

function validateRoleCount(roleNodes: AnyWorkNode[], errors: ValidationError[]): void {
  if (roleNodes.length < 2) {
    errors.push({ nodeId: null, message: "工作流至少需要 2 个角色节点" });
  }
}

function validateReachability(
  nodes: AnyWorkNode[],
  edges: AnyWorkEdge[],
  startNodes: AnyWorkNode[],
  endNodes: AnyWorkNode[],
  errors: ValidationError[],
): void {
  if (startNodes.length !== 1 || endNodes.length !== 1) return;

  const forwardAdj = new Map<string, string[]>();
  const backwardAdj = new Map<string, string[]>();
  for (const edge of edges) {
    if (!forwardAdj.has(edge.source)) forwardAdj.set(edge.source, []);
    forwardAdj.get(edge.source)?.push(edge.target);
    if (!backwardAdj.has(edge.target)) backwardAdj.set(edge.target, []);
    backwardAdj.get(edge.target)?.push(edge.source);
  }

  const reachableFromStart = bfs(startNodes[0].id, forwardAdj);
  const reachableFromEnd = bfs(endNodes[0].id, backwardAdj);

  for (const node of nodes) {
    if (node.type === "start" || node.type === "end") continue;
    if (!reachableFromStart.has(node.id)) {
      errors.push({ nodeId: node.id, message: "节点不可从 Start 到达（孤立节点）" });
    }
    if (!reachableFromEnd.has(node.id)) {
      errors.push({ nodeId: node.id, message: "节点无法到达 End（死端节点）" });
    }
  }
}

function bfs(startId: string, adj: Map<string, string[]>): Set<string> {
  const visited = new Set<string>();
  const queue = [startId];
  visited.add(startId);
  while (queue.length > 0) {
    const current = queue.shift() ?? "";
    for (const next of adj.get(current) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        queue.push(next);
      }
    }
  }
  return visited;
}
