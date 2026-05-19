import { useState } from "react";
import { Navigate, Outlet, useParams } from "react-router";
import { clearApiKey, hasApiKey } from "./api.ts";
import { RunDialog } from "./components/run-dialog.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { useTheme } from "./hooks/use-theme.tsx";

export function Layout() {
  const [authed, setAuthed] = useState(hasApiKey());
  const { client } = useParams();
  const [showRun, setShowRun] = useState(false);
  const { theme, toggleTheme } = useTheme();

  if (!authed) {
    return <Navigate to="/login" replace />;
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar
        onLogout={() => {
          clearApiKey();
          setAuthed(false);
        }}
        theme={theme}
        onToggleTheme={toggleTheme}
      />
      <main className="flex-1 overflow-hidden flex flex-col">
        <StatusBar client={client ?? null} onRun={() => setShowRun(true)} />
        <div className="flex-1 overflow-auto p-6">
          <Outlet />
        </div>
      </main>
      {client && <RunDialog client={client} open={showRun} onOpenChange={setShowRun} />}
    </div>
  );
}
