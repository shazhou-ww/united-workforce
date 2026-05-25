import { applyEdgeChanges, type Connection, type Edge, type EdgeChange } from "@xyflow/react";
import { define } from "../context";

function makeEdges(): Edge[] {
  return [];
}

function isInputHandle(handle: string | null | undefined): boolean {
  return handle === "input" || handle === "input-top" || handle === "input-bottom";
}

function isOutputHandle(handle: string | null | undefined): boolean {
  return handle === "output" || handle === "output-top" || handle === "output-bottom";
}

function normalizeConnection(params: Edge | Connection): Edge | Connection {
  if (isInputHandle(params.sourceHandle) && isOutputHandle(params.targetHandle)) {
    return {
      ...params,
      source: params.target,
      sourceHandle: params.targetHandle ?? null,
      target: params.source,
      targetHandle: params.sourceHandle ?? null,
    } as Edge | Connection;
  }
  return params;
}

let edgeCounter = 0;

export const edgesModel = define.model("edges", makeEdges, (set, get, model) => {
  function onEdgesChange(changes: EdgeChange[]) {
    const whites = new Set(["add", "replace"]);
    if (changes.some((c) => whites.has(c.type))) {
      model.startTransaction();
      set((eds) => applyEdgeChanges(changes, eds));
      requestAnimationFrame(model.endTransaction);
      return;
    }
    set((eds) => applyEdgeChanges(changes, eds));
  }

  function onConnect(params: Edge | Connection) {
    const normalized = normalizeConnection(params);

    if (normalized.source === normalized.target) return;

    if (!isOutputHandle(normalized.sourceHandle) || !isInputHandle(normalized.targetHandle)) return;

    const currentEdges = get();
    const duplicate = currentEdges.some(
      (e) => e.source === normalized.source && e.target === normalized.target,
    );
    if (duplicate) return;

    model.startTransaction();

    const id = `e-${normalized.source}-${normalized.target}-${++edgeCounter}`;
    const edge: Edge = {
      ...normalized,
      id,
      animated: true,
    } as Edge;

    const existingFromSource = currentEdges.filter((e) => e.source === normalized.source);

    if (existingFromSource.length > 0) {
      edge.type = "status";
      edge.data = { status: "" };

      const promoted = currentEdges.map((e) => {
        if (e.source === normalized.source && e.type !== "status") {
          return { ...e, type: "status" as const, data: { status: "_" } };
        }
        return e;
      });
      set([...promoted, edge]);
    } else {
      set((eds) => [...eds, edge]);
    }
    requestAnimationFrame(model.endTransaction);
  }

  return { onEdgesChange, onConnect, set };
});
