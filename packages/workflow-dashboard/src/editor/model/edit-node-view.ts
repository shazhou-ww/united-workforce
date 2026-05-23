import { define } from "../context";
import type { RoleNodeData, WorkNode } from "../type";
import { nodesModel } from "./nodes";

export type EditNodeState = {
  node: WorkNode<"role">;
};

function editNodeView() {
  return null as EditNodeState | null;
}

export const editNodeViewModel = define.view("editNodeView", editNodeView, (set, get, model) => {
  function start(nodeId: string) {
    const [nodes] = model.use(nodesModel);
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || node.type !== "role") return;
    set({ node: node as WorkNode<"role"> });
  }

  function cancel() {
    set(null);
  }

  function commit(data: RoleNodeData) {
    const state = get();
    if (!state) return;
    set(null);

    const { editNode } = model.use(nodesModel)[1];

    model.startTransaction();
    editNode(state.node.id, (node) => {
      // biome-ignore lint/suspicious/noExplicitAny: node data type varies by node kind
      node.data = data as any;
    });
    requestAnimationFrame(model.endTransaction);
  }

  return { start, commit, cancel };
});
