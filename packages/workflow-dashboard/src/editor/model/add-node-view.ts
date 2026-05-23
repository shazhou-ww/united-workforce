import type { Edge } from "@xyflow/react";
import { define } from "../context";
import type { AnyWorkNode, RoleNodeData } from "../type";
import { edgesModel } from "./edges";
import { nodesModel } from "./nodes";

type ConnectHandle = {
  id?: string | null;
  nodeId: string;
  type: "source" | "target";
};

export type AddNodeState = {
  fromNode: AnyWorkNode;
  fromHandle: ConnectHandle;
  position: { x: number; y: number };
};

type CommitParams = {
  data: RoleNodeData;
};

function addNodeView() {
  return null as AddNodeState | null;
}

export const addNodeViewModel = define.view("addNodeView", addNodeView, (set, get, model) => {
  function start(state: AddNodeState) {
    set(state);
  }

  function cancel() {
    set(null);
  }

  function commit(params: CommitParams) {
    const state = get();
    if (!state) return;
    set(null);

    const { fromNode, fromHandle, position } = state;
    const { data } = params;

    const id = `n${Date.now()}`;
    const node = {
      id,
      data,
      position,
      type: "role" as const,
      origin: [0.0, 0.5] as [number, number],
    };

    const [fnid, fhid] = [fromNode.id, fromHandle.id];
    const newEdge: Edge =
      fromHandle.type === "source"
        ? { id: `e${fnid}-${id}`, source: fnid, target: id, sourceHandle: fhid, animated: true }
        : { id: `e${id}-${fnid}`, source: id, target: fnid, targetHandle: fhid, animated: true };

    model.startTransaction();
    model.use(nodesModel)[1].set((nds) => nds.concat(node));
    model.use(edgesModel)[1].set((eds) => eds.concat(newEdge));
    requestAnimationFrame(model.endTransaction);
  }

  return { start, commit, cancel };
});
