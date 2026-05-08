import { useState } from "react";
import { Sidebar } from "./components/sidebar.tsx";
import { ThreadList } from "./components/thread-list.tsx";
import { ThreadDetail } from "./components/thread-detail.tsx";
import { WorkflowList } from "./components/workflow-list.tsx";
import { StatusBar } from "./components/status-bar.tsx";

type View = "threads" | "workflows";

export function App() {
  const [view, setView] = useState<View>("threads");
  const [selectedThread, setSelectedThread] = useState<string | null>(null);

  return (
    <div className="flex h-screen">
      <Sidebar view={view} onViewChange={setView} onBack={() => setSelectedThread(null)} />
      <main className="flex-1 overflow-hidden flex flex-col">
        <StatusBar />
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
    </div>
  );
}
