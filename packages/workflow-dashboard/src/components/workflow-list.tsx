import { AlertCircle, Clock, Hash, Loader2, Package } from "lucide-react";
import { useNavigate, useParams } from "react-router";
import { listWorkflows } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { Card } from "./ui/card.tsx";

export function WorkflowList() {
  const params = useParams();
  const navigate = useNavigate();
  const client = params.client as string;
  const { status, data, error } = useFetch(() => listWorkflows(client), [client]);

  if (status === "loading")
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading workflows...</p>
      </div>
    );

  if (status === "error")
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3">
        <AlertCircle className="h-5 w-5 text-destructive" />
        <p className="text-sm text-destructive">Error: {error}</p>
      </div>
    );

  const workflows = data.workflows;

  return (
    <div>
      <h2 className="text-xl font-semibold tracking-tight mb-4">Workflows</h2>
      {workflows.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3">
          <Package className="h-12 w-12 text-muted-foreground/50" />
          <p className="text-sm font-medium">No workflows</p>
          <p className="text-xs text-muted-foreground">Register a workflow to get started.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => (
            <Card
              key={w.name}
              className="p-4 cursor-pointer hover:bg-accent/50 hover:shadow-sm transition-all duration-200"
              onClick={() => navigate(`/${client}/workflows/${w.name}`)}
            >
              <span className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Package className="h-3.5 w-3.5 text-muted-foreground" />
                {w.name}
              </span>
              <code className="text-xs mt-1 font-mono text-muted-foreground flex items-center gap-1.5">
                <Hash className="h-3 w-3" />
                {w.hash !== null ? w.hash : "—"}
              </code>
              {w.timestamp !== null ? (
                <span className="text-xs mt-1 text-muted-foreground flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  Updated {new Date(w.timestamp).toLocaleString()}
                </span>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
