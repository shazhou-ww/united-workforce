import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../../components/ui/button.tsx";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.tsx";
import { Input } from "../../components/ui/input.tsx";
import { Label } from "../../components/ui/label.tsx";
import { Textarea } from "../../components/ui/textarea.tsx";
import { type EditNodeState, editNodeViewModel } from "../model/edit-node-view.ts";
import type { RoleNodeData } from "../type.ts";

type FormProps = {
  state: EditNodeState;
  onSubmit: (data: RoleNodeData) => void;
  onCancel: () => void;
};

function Form({ state, onSubmit, onCancel }: FormProps): ReactNode {
  const data = state.node.data;
  const [name, setName] = useState(data.name);
  const [description, setDescription] = useState(data.description);
  const [identity, setIdentity] = useState(data.identity);
  const [prepare, setPrepare] = useState(data.prepare);
  const [execute, setExecute] = useState(data.execute);
  const [report, setReport] = useState(data.report);

  useEffect(() => {
    setName(data.name);
    setDescription(data.description);
    setIdentity(data.identity);
    setPrepare(data.prepare);
    setExecute(data.execute);
    setReport(data.report);
  }, [data]);

  function handleConfirm() {
    if (!name.trim()) return;
    onSubmit({
      name: name.trim(),
      description,
      identity,
      prepare,
      execute,
      report,
    });
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>编辑角色节点</DialogTitle>
      </DialogHeader>

      <div className="flex flex-col gap-3 max-h-[400px] overflow-y-auto p-1">
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">名称 *</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="角色名称" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">描述</Label>
          <Textarea
            rows={2}
            className="resize-none"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="角色描述"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">身份 (Identity)</Label>
          <Textarea
            rows={2}
            className="resize-none"
            value={identity}
            onChange={(e) => setIdentity(e.target.value)}
            placeholder="角色身份定义"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">准备 (Prepare)</Label>
          <Textarea
            rows={2}
            className="resize-none"
            value={prepare}
            onChange={(e) => setPrepare(e.target.value)}
            placeholder="执行前准备指令"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">执行 (Execute)</Label>
          <Textarea
            rows={2}
            className="resize-none"
            value={execute}
            onChange={(e) => setExecute(e.target.value)}
            placeholder="核心执行指令"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">报告 (Report)</Label>
          <Textarea
            rows={2}
            className="resize-none"
            value={report}
            onChange={(e) => setReport(e.target.value)}
            placeholder="输出格式指令"
          />
        </div>
      </div>

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={handleConfirm}>
          确定
        </Button>
      </DialogFooter>
    </>
  );
}

export function EditNodeDialog(): ReactNode {
  const state = editNodeViewModel.useData();
  const { commit, cancel } = editNodeViewModel.useCreation();

  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) cancel();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        {state && <Form state={state} onSubmit={commit} onCancel={cancel} />}
      </DialogContent>
    </Dialog>
  );
}
