import { useState } from "react";
import { Sidebar } from "./components/sidebar.tsx";
import { ThreadList } from "./components/thread-list.tsx";
import { ThreadDetail } from "./components/thread-detail.tsx";
import { WorkflowList } from "./components/workflow-list.tsx";
import { StatusBar } from "./components/status-bar.tsx";
import { RunDialog } from "./components/run-dialog.tsx";

type View = "threads" | "workflows";

export function App() {
  const [view, setView] = useState<View>("threads");
  const [selectedThread, setSelectedThread] = useState<string | null>(null);
  const [showRun, setShowRun] = useState(false);

  return (
    <div className="flex h-screen">
      <Sidebar view={view} onViewChange={setView} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <StatusBar onRun={() => setShowRun(true)} />
        <div className="flex-1 overflow-auto p-6">
          {view === "threads" && !selectedThread && (
            <ThreadList onSelect={setSelectedThread} />
          )}
          {view === "threads" && selectedThread && (
            <ThreadDetail threadId={selectedThread} onBack={() => setSelectedThread(null)} />
          )}
          {view === "workflows" && <WorkflowList />}
        </div>
      </main>
      {showRun && (
        <RunDialog
          onClose={() => setShowRun(false)}
          onCreated={(id) => {
            setShowRun(false);
            setView("threads");
            setSelectedThread(id);
          }}
        />
      )}
    </div>
  );
}
