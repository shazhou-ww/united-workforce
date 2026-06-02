import type { AnyWorkEdge, AnyWorkNode, StatusEdge } from "../type";
import { uuid } from "../utils";
import type { WorkFlowStep } from "./type";

type Result = {
  nodes: AnyWorkNode[];
  edges: AnyWorkEdge[];
};

const _OUT_HANDLES = ["output-top", "output", "output-bottom"] as const;
const IN_HANDLES = ["input-top", "input", "input-bottom"] as const;
const DEFAULT_STATUS = "_";

function assignHandles(
  indices: number[],
  edges: AnyWorkEdge[],
  handles: readonly string[],
  key: "sourceHandle" | "targetHandle",
): void {
  if (indices.length === 1) {
    edges[indices[0]] = { ...edges[indices[0]], [key]: handles[1] };
  } else if (indices.length === 2) {
    edges[indices[0]] = { ...edges[indices[0]], [key]: handles[1] };
    edges[indices[1]] = { ...edges[indices[1]], [key]: handles[0] };
  } else {
    for (let i = 0; i < indices.length; i++) {
      edges[indices[i]] = { ...edges[indices[i]], [key]: handles[i % handles.length] };
    }
  }
}

function buildNodeMap(
  steps: WorkFlowStep[],
  nodes: AnyWorkNode[],
): { nameToId: Map<string, string>; idToOrder: Map<string, number> } {
  const nameToId = new Map<string, string>();
  const idToOrder = new Map<string, number>();
  nameToId.set("END", "end");
  idToOrder.set("start", -1);
  idToOrder.set("end", steps.length);
  for (let si = 0; si < steps.length; si++) {
    const step = steps[si];
    const nodeId = `n${uuid()}`;
    nameToId.set(step.role.name, nodeId);
    idToOrder.set(nodeId, si);
    nodes.push({ id: nodeId, type: "role", data: { ...step.role }, position: { x: 0, y: 0 } });
  }
  return { nameToId, idToOrder };
}

function sortTransitions(step: WorkFlowStep): WorkFlowStep["transitions"] {
  if (step.transitions.length <= 1) return step.transitions;
  return [...step.transitions].sort((a, b) => {
    if (a.status === DEFAULT_STATUS && b.status !== DEFAULT_STATUS) return -1;
    if (a.status !== DEFAULT_STATUS && b.status === DEFAULT_STATUS) return 1;
    return 0;
  });
}

function buildStepEdges(
  sourceId: string,
  step: WorkFlowStep,
  nameToId: Map<string, string>,
): { primaryEdges: AnyWorkEdge[]; statusEdges: AnyWorkEdge[] } {
  const hasMultiple = step.transitions.length > 1;
  const sorted = sortTransitions(step);
  const primaryEdges: AnyWorkEdge[] = [];
  const statusEdges: AnyWorkEdge[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const t = sorted[i];
    const targetId = nameToId.get(t.target);
    if (!targetId) continue;
    const edgeId = `e-${sourceId}-${targetId}-${i}`;
    if (hasMultiple || t.status !== DEFAULT_STATUS) {
      const edge: StatusEdge = {
        id: edgeId,
        source: sourceId,
        target: targetId,
        sourceHandle: "output",
        targetHandle: "input",
        type: "status",
        data: { status: t.status },
        animated: true,
      };
      if (hasMultiple && t.status === DEFAULT_STATUS) primaryEdges.push(edge);
      else statusEdges.push(edge);
    } else {
      primaryEdges.push({
        id: edgeId,
        source: sourceId,
        target: targetId,
        sourceHandle: "output",
        targetHandle: "input",
        animated: true,
      });
    }
  }
  return { primaryEdges, statusEdges };
}

function pushStepEdges(
  edges: AnyWorkEdge[],
  primaryEdges: AnyWorkEdge[],
  statusEdges: AnyWorkEdge[],
  idToOrder: Map<string, number>,
): void {
  for (const e of primaryEdges) edges.push({ ...e, sourceHandle: "output" });
  if (statusEdges.length > 0) {
    const statusHandles = ["output-top", "output-bottom"] as const;
    const sorted = [...statusEdges].sort(
      (a, b) => (idToOrder.get(b.target) ?? 0) - (idToOrder.get(a.target) ?? 0),
    );
    for (let i = 0; i < sorted.length; i++) {
      edges.push({ ...sorted[i], sourceHandle: statusHandles[i % statusHandles.length] });
    }
  }
}

function assignTargetHandles(edges: AnyWorkEdge[], idToOrder: Map<string, number>): void {
  const incomingByTarget = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const target = edges[i].target;
    if (!incomingByTarget.has(target)) incomingByTarget.set(target, []);
    incomingByTarget.get(target)?.push(i);
  }
  for (const indices of incomingByTarget.values()) {
    indices.sort(
      (a, b) => (idToOrder.get(edges[a].source) ?? 0) - (idToOrder.get(edges[b].source) ?? 0),
    );
    assignHandles(indices, edges, IN_HANDLES, "targetHandle");
  }
}

export function transIn(steps: WorkFlowStep[]): Result {
  const startNode: AnyWorkNode = {
    id: "start",
    type: "start",
    data: { label: "Start" },
    position: { x: 0, y: 0 },
  };
  const endNode: AnyWorkNode = {
    id: "end",
    type: "end",
    data: { label: "End" },
    position: { x: 250, y: 0 },
  };

  if (steps.length === 0) return { nodes: [startNode, endNode], edges: [] };

  const nodes: AnyWorkNode[] = [startNode, endNode];
  const edges: AnyWorkEdge[] = [];

  const { nameToId, idToOrder } = buildNodeMap(steps, nodes);

  const firstStepId = nameToId.get(steps[0].role.name) ?? "";
  edges.push({
    id: `e-start-${firstStepId}`,
    source: "start",
    sourceHandle: "output",
    target: firstStepId,
    targetHandle: "input",
    animated: true,
  });

  for (const step of steps) {
    const sourceId = nameToId.get(step.role.name) ?? "";
    const { primaryEdges, statusEdges } = buildStepEdges(sourceId, step, nameToId);
    pushStepEdges(edges, primaryEdges, statusEdges, idToOrder);
  }

  assignTargetHandles(edges, idToOrder);

  return { nodes, edges };
}
