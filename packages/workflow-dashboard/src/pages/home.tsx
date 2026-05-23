import { Plus, Trash2, Workflow } from "lucide-react";
import { type FormEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { WorkflowSummary } from "../../shared/types.ts";

export function HomePage(): ReactNode {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");

  const fetchWorkflows = useCallback(async () => {
    const res = await fetch("/api/workflows");
    const data = await res.json();
    setWorkflows(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newName.trim()) return;
    await fetch("/api/workflows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), description: newDesc.trim() }),
    });
    setNewName("");
    setNewDesc("");
    setCreateOpen(false);
    fetchWorkflows();
  };

  const handleDelete = async (name: string) => {
    await fetch(`/api/workflows/${encodeURIComponent(name)}`, { method: "DELETE" });
    fetchWorkflows();
  };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Workflows</h1>
          <p className="text-muted-foreground mt-1">管理你的工作流定义</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger render={<Button />}>
            <Plus className="size-4" data-icon="inline-start" />
            新建 Workflow
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={handleCreate}>
              <DialogHeader>
                <DialogTitle>新建 Workflow</DialogTitle>
                <DialogDescription>输入工作流的名称和描述</DialogDescription>
              </DialogHeader>
              <div className="mt-4 flex flex-col gap-3">
                <Input
                  placeholder="名称 (kebab-case，如 solve-issue)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  autoFocus
                />
                <Textarea
                  placeholder="描述"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                  rows={3}
                />
              </div>
              <DialogFooter className="mt-4">
                <Button type="submit" disabled={!newName.trim()}>
                  创建
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="text-muted-foreground py-12 text-center">加载中...</div>
      ) : workflows.length === 0 ? (
        <div className="py-12 text-center">
          <Workflow className="mx-auto size-12 text-muted-foreground/50" />
          <p className="text-muted-foreground mt-4">还没有任何 Workflow</p>
          <p className="text-muted-foreground/70 text-sm mt-1">点击上方按钮创建第一个工作流</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {workflows.map((wf) => (
            <Card
              key={wf.name}
              className="cursor-pointer transition-shadow hover:shadow-md"
              onClick={() => navigate(`/workflow/${encodeURIComponent(wf.name)}`)}
            >
              <CardHeader>
                <CardTitle>{wf.name}</CardTitle>
                <CardDescription>{wf.description || "无描述"}</CardDescription>
                <CardAction>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDelete(wf.name);
                    }}
                  >
                    <Trash2 className="size-4 text-muted-foreground" />
                  </Button>
                </CardAction>
              </CardHeader>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
