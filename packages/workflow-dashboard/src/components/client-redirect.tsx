import { Loader2, Users } from "lucide-react";
import { Navigate } from "react-router";
import { listClients } from "../api.ts";
import { useFetch } from "../hooks.ts";

export function ClientRedirect() {
  const { status, data } = useFetch(() => listClients(), []);

  if (status === "loading") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading clients...</p>
      </div>
    );
  }

  if (status === "ok" && data.length > 0) {
    return <Navigate to={`/${data[0].name}/threads`} replace />;
  }

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3">
      <Users className="h-12 w-12 text-muted-foreground/50" />
      <p className="text-sm font-medium">No client selected</p>
      <p className="text-xs text-muted-foreground">
        Select a client from the sidebar to get started.
      </p>
    </div>
  );
}
