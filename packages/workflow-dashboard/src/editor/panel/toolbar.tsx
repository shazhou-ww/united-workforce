import { useReactFlow, useStoreApi } from "@xyflow/react";
import { LayoutList, Redo2, Save, Undo2, Users } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import { Separator } from "../../components/ui/separator.tsx";
import { cn } from "../../lib/utils.ts";
import { useModel } from "../context.tsx";
import { handlers, nodesModel } from "../model/index.ts";
import type { RoleNodeData, WorkNode } from "../type.ts";
import { uuid } from "../utils/index.ts";

const DEFAULT_ROLE_DATA: RoleNodeData = {
  name: "新角色",
  description: "",
  identity: "",
  prepare: "",
  execute: "",
  report: "",
};

export function Toolbar(): ReactNode {
  const model = useModel();
  const flow = useReactFlow();
  const store = useStoreApi();
  const nodesActions = nodesModel.useCreation();
  const { autoLayoutLR } = handlers.use();
  const [canUndo, canRedo] = model.useStackState();

  function handleUndo() {
    model.undo();
  }

  function handleRedo() {
    model.redo();
  }

  function handleAddNode() {
    const { x, y, zoom } = flow.getViewport();
    const { width, height } = store.getState();
    const centerX = (width / 2 - x) / zoom;
    const centerY = (height / 2 - y) / zoom;

    const id = `n${uuid()}`;
    const node: WorkNode<"role"> = {
      id,
      type: "role",
      position: { x: centerX - 80, y: centerY - 40 },
      data: { ...DEFAULT_ROLE_DATA },
    };

    model.startTransaction();
    nodesActions.set((nds) => nds.concat(node));
    requestAnimationFrame(model.endTransaction);
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-[10px] shadow-md">
      <div className="flex items-center gap-0.5">
        <Button
          variant="ghost"
          size="icon-sm"
          title="撤销 (Undo)"
          onClick={handleUndo}
          disabled={!canUndo}
        >
          <Undo2 />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          title="重做 (Redo)"
          onClick={handleRedo}
          disabled={!canRedo}
        >
          <Redo2 />
        </Button>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <Button variant="ghost" size="icon-sm" title="添加角色" onClick={handleAddNode}>
        <Users />
      </Button>

      <Separator orientation="vertical" className="h-6" />

      <Button variant="ghost" size="icon-sm" title="自动布局" onClick={autoLayoutLR}>
        <LayoutList />
      </Button>

      <SaveButton />
    </div>
  );
}

function SaveButton(): ReactNode {
  const { saveData } = handlers.use();
  const [toast, setToast] = useState<{
    open: boolean;
    severity: "success" | "error";
    message: ReactNode;
  }>({ open: false, severity: "success", message: "" });

  function handleSave() {
    const { valid, errors } = saveData();
    if (valid) {
      setToast({ open: true, severity: "success", message: "流程保存成功" });
    } else {
      const errorMessages = errors.map(({ message, nodeId }) => (
        <div key={nodeId ?? message}>
          {nodeId ? `节点 ${nodeId}：` : ""}
          {message}
        </div>
      ));
      setToast({
        open: true,
        severity: "error",
        message: errorMessages || "流程校验失败",
      });
    }
    setTimeout(() => setToast((prev) => ({ ...prev, open: false })), 4000);
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" title="保存流程" onClick={handleSave}>
        <Save />
      </Button>
      {toast.open && (
        <div
          className={cn(
            "fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-lg text-sm text-white shadow-lg",
            toast.severity === "success" ? "bg-green-600" : "bg-red-600",
          )}
        >
          {toast.message}
        </div>
      )}
    </>
  );
}
