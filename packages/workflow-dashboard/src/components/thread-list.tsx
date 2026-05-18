import { AlertCircle, Clock, Loader2, Workflow, Zap } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { listThreads } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { Badge } from "./ui/badge.tsx";
import { Card } from "./ui/card.tsx";

function statusVariant(status: string): "success" | "destructive" | "secondary" {
  if (status === "completed") return "success";
  if (status === "failed") return "destructive";
  return "secondary";
}

export function ThreadList() {
  const params = useParams();
  const navigate = useNavigate();
  const client = params.client as string;
  const { status, data, error } = useFetch(() => listThreads(client), [client]);

  if (status === "loading")
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading threads...</p>
      </div>
    );

  if (status === "error")
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm text-destructive">Error: {error}</p>
      </div>
    );

  const threads = [...data.threads].sort((a, b) => {
    if (!a.startedAt && !b.startedAt) return 0;
    if (!a.startedAt) return 1;
    if (!b.startedAt) return -1;
    return b.startedAt.localeCompare(a.startedAt);
  });

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight mb-4">Threads</h2>
      {threads.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Zap className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm font-medium">No threads</p>
          <p className="text-xs text-muted-foreground">
            Run a workflow to create your first thread.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => (
            <Card
              key={t.threadId}
              className="p-4 cursor-pointer hover:bg-accent/50 hover:shadow-sm transition-all duration-200"
              onClick={() => navigate(`/${client}/threads/${t.threadId}`)}
            >
              <div className="flex items-center justify-between">
                <code className="font-mono text-sm text-foreground">{t.threadId}</code>
                {t.status && (
                  <Badge variant={statusVariant(t.status)} className="text-xs">
                    {t.status}
                  </Badge>
                )}
              </div>
              {t.workflow && (
                <p className="text-sm mt-1 font-medium text-foreground flex items-center gap-1.5">
                  <Workflow className="h-3.5 w-3.5 text-muted-foreground" />
                  {t.workflow}
                </p>
              )}
              {t.startedAt && (
                <p className="text-xs mt-1 text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {t.startedAt}
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
