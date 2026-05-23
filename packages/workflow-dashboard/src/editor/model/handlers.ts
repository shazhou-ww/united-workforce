import type { OnBeforeDelete, OnConnectEnd, OnDelete, OnNodeDrag } from "@xyflow/react";
import { define } from "../context";
import { LayoutLR } from "../layout";
import type { WorkFlowSteps } from "../trans";
import { transIn, transOut, validate } from "../trans";
import type { AnyWorkNode } from "../type";
import { addNodeViewModel } from "./add-node-view";
import { edgesModel } from "./edges";
import { editNodeViewModel } from "./edit-node-view";
import { injection } from "./inject";
import { nodesModel } from "./nodes";

export const handlers = define.memoize((use, model) => {
  const onNodeDragStart: OnNodeDrag<AnyWorkNode> = () => {
    model.startTransaction();
  };
  const onNodeDragStop: OnNodeDrag<AnyWorkNode> = () => {
    model.endTransaction();
  };
  const onConnectEnd: OnConnectEnd = (event, state) => {
    const { isValid, to, fromHandle, fromNode } = state;
    if (isValid) return;
    if (!to || !fromHandle || !fromNode) return;
    const { clientX, clientY } = event as MouseEvent;
    use(addNodeViewModel)[1].start({
      // biome-ignore lint/suspicious/noExplicitAny: ReactFlow node type mismatch
      fromNode: fromNode as any as AnyWorkNode,
      fromHandle: fromHandle,
      position: model.flow.screenToFlowPosition({ x: clientX, y: clientY }),
    });
  };

  function isProtectedNode(node: AnyWorkNode): boolean {
    return node.type === "start" || node.type === "end";
  }

  function isFirstConditionalSibling(
    edge: { id: string; source: string; type?: string },
    allEdges: { id: string; source: string; type?: string }[],
  ): boolean {
    if (edge.type !== "conditional") return false;
    const siblings = allEdges.filter((e) => e.source === edge.source && e.type === "conditional");
    return siblings.length >= 2 && siblings[0].id === edge.id;
  }

  const onBeforeDelete: OnBeforeDelete<AnyWorkNode> = async ({ nodes, edges }) => {
    if (nodes.some(isProtectedNode)) return false;
    if (edges.length > 0) {
      const allEdges = use(edgesModel)[0];
      if (edges.some((e) => isFirstConditionalSibling(e, allEdges))) return false;
    }
    model.startTransaction();
    return true;
  };
  const onDelete: OnDelete = ({ edges: deletedEdges }) => {
    if (deletedEdges.length > 0) {
      const currentEdges = use(edgesModel)[0];
      const sourcesToCheck = new Set(
        deletedEdges.filter((e) => e.type === "conditional").map((e) => e.source),
      );

      if (sourcesToCheck.size > 0) {
        let needsDowngrade = false;
        const updatedEdges = currentEdges.map((e) => {
          if (!sourcesToCheck.has(e.source) || e.type !== "conditional") return e;
          const siblings = currentEdges.filter(
            (s) => s.source === e.source && s.type === "conditional",
          );
          if (siblings.length === 1) {
            needsDowngrade = true;
            const { data: _, ...rest } = e;
            return { ...rest, type: "default" as const };
          }
          return e;
        });

        if (needsDowngrade) {
          use(edgesModel)[1].set(updatedEdges);
        }
      }
    }
    model.endTransaction();
  };

  function autoLayoutLR() {
    const [nodes, { set }] = use(nodesModel);
    const edges = use(edgesModel)[0];

    const layoutedNodes = LayoutLR(nodes, edges);
    model.startTransaction();
    set(layoutedNodes);
    model.endTransaction();
  }

  function resetView() {
    use(addNodeViewModel)[1].cancel();
    use(editNodeViewModel)[1].cancel();
  }

  function handleEscape() {
    const [addView, addViewActions] = use(addNodeViewModel);
    const [editView, editViewActions] = use(editNodeViewModel);
    if (addView) addViewActions.cancel();
    if (editView) editViewActions.cancel();
  }

  function handleUndoRedo(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.code === "KeyZ" && (event.ctrlKey || event.metaKey)) {
      if (event.shiftKey) model.redo();
      else model.undo();
    } else if (event.code === "KeyY" && (event.ctrlKey || event.metaKey)) {
      model.redo();
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.code === "Escape") {
      handleEscape();
      return;
    }
    handleUndoRedo(event);
  }

  function loadSteps(steps: WorkFlowSteps) {
    resetView();
    const { nodes, edges } = transIn(steps);
    use(nodesModel)[1].set(nodes);
    use(edgesModel)[1].set(edges);
    autoLayoutLR();
    model.reset();
  }

  function saveData() {
    const nodes = use(nodesModel)[0];
    const edges = use(edgesModel)[0];
    const result = validate(nodes, edges);
    if (result.valid) {
      const steps = transOut(nodes, edges);
      const instance = use(injection)[0];
      instance.emitPublic("save", steps);
    }
    return result;
  }

  return {
    onNodeDragStart,
    onNodeDragStop,
    onConnectEnd,
    onBeforeDelete,
    onDelete,
    autoLayoutLR,
    handleKeyDown,
    loadSteps,
    saveData,
  };
});
