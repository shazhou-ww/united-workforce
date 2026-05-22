import { useState, useEffect, useRef, type ReactNode } from "react";
import { useParams, useNavigate, useLocation } from "react-router";
import FlowEditor, { FlowModel, type WorkFlowSteps } from "../editor/flow.tsx";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Pencil, Eye } from "lucide-react";

export function DetailPage(): ReactNode {
  const { name } = useParams<{ name: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const editing = location.pathname.endsWith("/edit");
  const [model, setModel] = useState<FlowModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(name);
  nameRef.current = name;

  useEffect(() => {
    if (!name) return;
    let cancelled = false;

    fetch(`/api/workflows/${encodeURIComponent(name)}`)
      .then((res) => {
        if (!res.ok) throw new Error("not found");
        return res.json() as Promise<WorkFlowSteps>;
      })
      .then((steps) => {
        if (cancelled) return;
        const m = new FlowModel(steps.length > 0 ? steps : undefined);
        m.on("save", (savedSteps) => {
          const n = nameRef.current;
          if (!n) return;
          setSaving(true);
          fetch(`/api/workflows/${encodeURIComponent(n)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(savedSteps),
          }).then(() => setSaving(false));
        });
        setModel(m);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) navigate("/");
      });

    return () => { cancelled = true; };
  }, [name, navigate]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        加载中...
      </div>
    );
  }

  const basePath = `/workflow/${encodeURIComponent(name!)}`;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button variant="ghost" size="icon-sm" onClick={() => navigate("/")}>
          <ArrowLeft className="size-4" />
        </Button>
        <h1 className="text-base font-medium">{name}</h1>
        <div className="flex-1" />
        {editing ? (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(basePath)}
          >
            <Eye className="size-3.5" data-icon="inline-start" />
            预览
          </Button>
        ) : (
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`${basePath}/edit`)}
          >
            <Pencil className="size-3.5" data-icon="inline-start" />
            编辑
          </Button>
        )}
        {saving && <span className="text-xs text-muted-foreground">保存中...</span>}
      </div>
      <div className="flex-1">
        {model && <FlowEditor model={model} readonly={!editing} />}
      </div>
    </div>
  );
}
