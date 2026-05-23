import type { AnyWorkEdge, AnyWorkNode, ConditionalEdge } from "../type";
import { uuid } from "../utils";
import type { WorkFlowStep } from "./type";

type Result = {
  nodes: AnyWorkNode[];
  edges: AnyWorkEdge[];
};

const _OUT_HANDLES = ["output-top", "output", "output-bottom"] as const;
const IN_HANDLES = ["input-top", "input", "input-bottom"] as const;

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

  if (steps.length === 0) {
    return { nodes: [startNode, endNode], edges: [] };
  }

  const nodes: AnyWorkNode[] = [startNode, endNode];
  const edges: AnyWorkEdge[] = [];
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
    nodes.push({
      id: nodeId,
      type: "role",
      data: { ...step.role },
      position: { x: 0, y: 0 },
    });
  }

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
    const _sourceOrder = idToOrder.get(sourceId) ?? 0;
    const hasMultipleTransitions = step.transitions.length > 1;

    const sorted = hasMultipleTransitions
      ? [...step.transitions].sort((a, b) => {
          if (a.condition === null && b.condition !== null) return -1;
          if (a.condition !== null && b.condition === null) return 1;
          return 0;
        })
      : step.transitions;

    const elseEdges: AnyWorkEdge[] = [];
    const ifEdges: AnyWorkEdge[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const targetId = nameToId.get(t.target);
      if (!targetId) continue;

      const edgeId = `e-${sourceId}-${targetId}-${i}`;

      if (hasMultipleTransitions || t.condition !== null) {
        const edge: ConditionalEdge = {
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourceHandle: "output",
          targetHandle: "input",
          type: "conditional",
          data: { condition: t.condition ?? "" },
          animated: true,
        };
        if (hasMultipleTransitions && i === 0) {
          elseEdges.push(edge);
        } else {
          ifEdges.push(edge);
        }
      } else {
        elseEdges.push({
          id: edgeId,
          source: sourceId,
          target: targetId,
          sourceHandle: "output",
          targetHandle: "input",
          animated: true,
        });
      }
    }

    // out: else → output (right); if → sort by target order desc (rightmost first), then top/bottom
    for (const e of elseEdges) {
      edges.push({ ...e, sourceHandle: "output" });
    }
    if (ifEdges.length > 0) {
      const sortedIf = [...ifEdges].sort((a, b) => {
        const oa = idToOrder.get(a.target) ?? 0;
        const ob = idToOrder.get(b.target) ?? 0;
        return ob - oa;
      });
      const ifHandles = ["output-top", "output-bottom"] as const;
      for (let i = 0; i < sortedIf.length; i++) {
        edges.push({ ...sortedIf[i], sourceHandle: ifHandles[i % ifHandles.length] });
      }
    }
  }

  // in: group by target, sort by source order asc (leftmost first), assign input > input-top > input-bottom
  const incomingByTarget = new Map<string, number[]>();
  for (let i = 0; i < edges.length; i++) {
    const target = edges[i].target;
    if (!incomingByTarget.has(target)) incomingByTarget.set(target, []);
    incomingByTarget.get(target)?.push(i);
  }

  for (const indices of incomingByTarget.values()) {
    indices.sort((a, b) => {
      const oa = idToOrder.get(edges[a].source) ?? 0;
      const ob = idToOrder.get(edges[b].source) ?? 0;
      return oa - ob;
    });
    assignHandles(indices, edges, IN_HANDLES, "targetHandle");
  }

  return { nodes, edges };
}
