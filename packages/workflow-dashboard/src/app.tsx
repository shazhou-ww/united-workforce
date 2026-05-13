import { useState } from "react";
import { clearApiKey, hasApiKey } from "./api.ts";
import { LoginPage } from "./components/login.tsx";
import { RunDialog } from "./components/run-dialog.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { ThreadDetail } from "./components/thread-detail.tsx";
import { ThreadList } from "./components/thread-list.tsx";
import { WorkflowList } from "./components/workflow-list.tsx";
import { useHashRoute } from "./use-hash-route.ts";

export function App() {
  const [authed, setAuthed] = useState(hasApiKey());
  const { view, client, threadId, setView, setClient, setThreadId } = useHashRoute();
  const [showRun, setShowRun] = useState(false);

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar
        view={view}
        client={client}
        onViewChange={setView}
        onClientChange={setClient}
        onLogout={() => {
          clearApiKey();
          setAuthed(false);
        }}
      />
      <main className="flex-1 overflow-hidden flex flex-col">
        <StatusBar client={client} onRun={() => setShowRun(true)} />
        <div className="flex-1 overflow-auto p-6">
          {!client && (
            <div className="flex items-center justify-center h-full">
              <p style={{ color: "var(--color-text-muted)" }}>
                Select an client from the sidebar to get started.
              </p>
            </div>
          )}
          {client && view === "threads" && threadId === null && (
            <ThreadList client={client} onSelect={setThreadId} />
          )}
          {client && view === "threads" && threadId !== null && (
            <ThreadDetail client={client} threadId={threadId} onBack={() => setThreadId(null)} />
          )}
          {client && view === "workflows" && <WorkflowList client={client} />}
        </div>
      </main>
      {showRun && client && (
        <RunDialog
          client={client}
          onClose={() => setShowRun(false)}
          onCreated={(id) => {
            setShowRun(false);
            setThreadId(id);
          }}
        />
      )}
    </div>
  );
}
