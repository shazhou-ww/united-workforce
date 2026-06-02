import { applyNodeChanges, type NodeChange } from "@xyflow/react";
import { type Draft, produce } from "immer";
import { define } from "../context";
import type { AnyWorkNode } from "../type";

function makeNodes(): AnyWorkNode[] {
  return [
    {
      id: "start",
      type: "start",
      data: { label: "Start" },
      position: { x: 0, y: 0 },
    },
    {
      id: "end",
      data: { label: "End" },
      position: { x: 1000, y: 0 },
      type: "end",
    },
  ];
}

export const nodesModel = define.model("nodes", makeNodes, (set, _get, model) => {
  const whites = new Set<NodeChange["type"]>(["add", "replace"]);
  function onNodesChange(changes: NodeChange<AnyWorkNode>[]) {
    if (changes.some((c) => whites.has(c.type))) {
      model.startTransaction();
      set((nds) => applyNodeChanges(changes, nds));
      requestAnimationFrame(model.endTransaction);
      return;
    }
    set((nds) => applyNodeChanges(changes, nds));
  }

  function editNode(id: string, updater: (node: Draft<AnyWorkNode>) => void) {
    set(
      produce((draft) => {
        const node = draft.find((n) => n.id === id);
        if (node) updater(node);
      }),
    );
  }

  function deleteNode(id: string) {
    model.startTransaction();
    set((nds) => nds.filter((n) => n.id !== id));
    requestAnimationFrame(model.endTransaction);
  }

  return { onNodesChange, set, editNode, deleteNode };
});
