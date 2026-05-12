import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  getThread,
  getWorkflowDescriptor,
  killThread,
  pauseThread,
  resumeThread,
  type ThreadRecord,
  type WorkflowDescriptor,
} from "../api.ts";
import { useFetch } from "../hooks.ts";
import { useSSE } from "../use-sse.ts";
import { RecordCard } from "./record-card.tsx";
import { type NodeState, WorkflowGraph } from "./workflow-graph/index.ts";

type Props = {
  agent: string;
  threadId: string;
  onBack: () => void;
};

function extractWorkflowName(records: readonly ThreadRecord[]): string | null {
  for (const r of records) {
    if (r.type === "thread-start") return r.workflow;
  }
  return null;
}

type GraphPanelProps = {
  descriptor: WorkflowDescriptor;
  workflowName: string | null;
  nodeStates: Map<string, NodeState>;
  onNodeClick: ((roleName: string) => void) | null;
};

function GraphPanel({ descriptor, workflowName, nodeStates, onNodeClick }: GraphPanelProps) {
  const [open, setOpen] = useState(true);
  const edgeCount = descriptor.graph.edges.length;
  return (
    <div
      className="mb-4 rounded-lg border overflow-hidden"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs"
        style={{ color: "var(--color-text-muted)" }}
      >
        <span className="font-mono">
          {open ? "▼" : "▶"} Workflow graph
          {workflowName !== null && (
            <span className="ml-2" style={{ color: "var(--color-text)" }}>
              {workflowName}
            </span>
          )}
        </span>
        <span>
          {edgeCount} edge{edgeCount === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <div style={{ height: 300, width: "100%" }}>
          <WorkflowGraph
            graph={descriptor.graph}
            roles={descriptor.roles}
            nodeStates={nodeStates}
            onNodeClick={onNodeClick}
          />
        </div>
      )}
    </div>
  );
}

function computeNodeStates(records: readonly ThreadRecord[]): Map<string, NodeState> {
  const states = new Map<string, NodeState>();
  const roleRecords = records.filter(
    (r): r is Extract<ThreadRecord, { type: "role" }> => r.type === "role",
  );
  const hasResult = records.some((r) => r.type === "workflow-result");

  for (let i = 0; i < roleRecords.length; i++) {
    const role = roleRecords[i].role;
    const isLast = i === roleRecords.length - 1;
    states.set(role, !hasResult && isLast ? "active" : "completed");
  }

  if (roleRecords.length > 0) {
    states.set("__start__", "completed");
  }
  if (hasResult) {
    states.set("__end__", "completed");
    for (const [k, v] of states) {
      if (v === "active") states.set(k, "completed");
    }
  }

  return states;
}

export function ThreadDetail({ agent, threadId, onBack }: Props) {
  const sse = useSSE(agent, threadId);
  const { status, data, error } = useFetch(() => getThread(agent, threadId), [agent, threadId]);
  const [actionStatus, setActionStatus] = useState<string | null>(null);
  const recordsEndRef = useRef<HTMLDivElement>(null);
  const firstCardByRoleRef = useRef<Map<string, HTMLDivElement>>(new Map());
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [highlightedRole, setHighlightedRole] = useState<string | null>(null);

  const liveActive = sse.connected && !sse.completed;
  const records = liveActive
    ? sse.records
    : status === "ok"
      ? data.records
      : ([] as typeof sse.records);

  const workflowName = useMemo(() => extractWorkflowName(records), [records]);

  const descriptorFetch = useFetch<WorkflowDescriptor | null>(
    () =>
      workflowName === null ? Promise.resolve(null) : getWorkflowDescriptor(agent, workflowName),
    [agent, workflowName],
  );

  const descriptor = descriptorFetch.status === "ok" ? descriptorFetch.data : null;
  const nodeStates = useMemo(() => computeNodeStates(records), [records]);

  const firstIndexByRole = useMemo(() => {
    const m = new Map<string, number>();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === "role" && !m.has(r.role)) {
        m.set(r.role, i);
      }
    }
    return m;
  }, [records]);

  const handleGraphNodeClick = useCallback((roleName: string) => {
    const el = firstCardByRoleRef.current.get(roleName);
    if (el == null) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    setHighlightedRole(roleName);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedRole(null);
      highlightTimerRef.current = null;
    }, 1500);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when the rendered record list grows
  useEffect(() => {
    recordsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [records.length]);

  async function handleAction(action: "kill" | "pause" | "resume") {
    setActionStatus(`${action}ing...`);
    try {
      const fn = action === "kill" ? killThread : action === "pause" ? pauseThread : resumeThread;
      await fn(agent, threadId);
      setActionStatus(`${action} sent ✓`);
    } catch (e) {
      setActionStatus(`${action} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          ← Back to threads
        </button>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => handleAction("pause")}
            className="px-3 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-warning)", color: "var(--color-warning)" }}
          >
            ⏸ Pause
          </button>
          <button
            type="button"
            onClick={() => handleAction("resume")}
            className="px-3 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-success)", color: "var(--color-success)" }}
          >
            ▶ Resume
          </button>
          <button
            type="button"
            onClick={() => handleAction("kill")}
            className="px-3 py-1 text-xs rounded border"
            style={{ borderColor: "var(--color-error)", color: "var(--color-error)" }}
          >
            ✕ Kill
          </button>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-2 font-mono flex items-center gap-2 flex-wrap">
        <span>{threadId}</span>
        {sse.connected && !sse.completed && (
          <span
            className="text-xs font-medium px-2 py-0.5 rounded"
            style={{ background: "var(--color-success)", color: "var(--color-bg)" }}
          >
            Live
          </span>
        )}
      </h2>
      {actionStatus && (
        <p className="text-xs mb-4" style={{ color: "var(--color-text-muted)" }}>
          {actionStatus}
        </p>
      )}

      {descriptor !== null && descriptor.graph.edges.length > 0 && (
        <GraphPanel
          descriptor={descriptor}
          workflowName={workflowName}
          nodeStates={nodeStates}
          onNodeClick={handleGraphNodeClick}
        />
      )}

      {status === "loading" && !liveActive && records.length === 0 && (
        <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>
      )}
      {status === "error" && !liveActive && (
        <p style={{ color: "var(--color-error)" }}>Error: {error}</p>
      )}
      {(status === "ok" || liveActive || records.length > 0) && (
        <div className="space-y-3">
          {records.map((r, i) => {
            const key = `${threadId}-${i}`;
            if (r.type === "role") {
              const isFirstForRole = firstIndexByRole.get(r.role) === i;
              const flash = highlightedRole === r.role;
              return (
                <div
                  key={key}
                  ref={(el) => {
                    if (!isFirstForRole) return;
                    if (el !== null) firstCardByRoleRef.current.set(r.role, el);
                    else firstCardByRoleRef.current.delete(r.role);
                  }}
                >
                  <RecordCard record={r} highlighted={flash} />
                </div>
              );
            }
            return <RecordCard key={key} record={r} highlighted={false} />;
          })}
          <div ref={recordsEndRef} aria-hidden />
        </div>
      )}
    </div>
  );
}
