import { useState } from "react";
import { RunDialog } from "./components/run-dialog.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { ThreadDetail } from "./components/thread-detail.tsx";
import { ThreadList } from "./components/thread-list.tsx";
import { WorkflowList } from "./components/workflow-list.tsx";
import { useHashRoute } from "./use-hash-route.ts";

export function App() {
  const { view, threadId, setView, setThreadId } = useHashRoute();
  const [showRun, setShowRun] = useState(false);

  return (
    <div className="flex h-screen">
      <Sidebar view={view} onViewChange={setView} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <StatusBar onRun={() => setShowRun(true)} />
        <div className="flex-1 overflow-auto p-6">
          {view === "threads" && threadId === null && <ThreadList onSelect={setThreadId} />}
          {view === "threads" && threadId !== null && (
            <ThreadDetail threadId={threadId} onBack={() => setThreadId(null)} />
          )}
          {view === "workflows" && <WorkflowList />}
        </div>
      </main>
      {showRun && (
        <RunDialog
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
