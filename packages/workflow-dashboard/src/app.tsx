import { useState } from "react";
import { hasApiKey, clearApiKey } from "./api.ts";
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
  const { view, agent, threadId, setView, setAgent, setThreadId } = useHashRoute();
  const [showRun, setShowRun] = useState(false);

  if (!authed) {
    return <LoginPage onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="flex h-screen">
      <Sidebar view={view} agent={agent} onViewChange={setView} onAgentChange={setAgent} onLogout={() => { clearApiKey(); setAuthed(false); }} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <StatusBar agent={agent} onRun={() => setShowRun(true)} />
        <div className="flex-1 overflow-auto p-6">
          {!agent && (
            <div className="flex items-center justify-center h-full">
              <p style={{ color: "var(--color-text-muted)" }}>
                Select an agent from the sidebar to get started.
              </p>
            </div>
          )}
          {agent && view === "threads" && threadId === null && (
            <ThreadList agent={agent} onSelect={setThreadId} />
          )}
          {agent && view === "threads" && threadId !== null && (
            <ThreadDetail agent={agent} threadId={threadId} onBack={() => setThreadId(null)} />
          )}
          {agent && view === "workflows" && <WorkflowList agent={agent} />}
        </div>
      </main>
      {showRun && agent && (
        <RunDialog
          agent={agent}
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
