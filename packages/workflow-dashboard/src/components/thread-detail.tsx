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
  client: string;
  threadId: string;
  onBack: () => void;
};

function extractWorkflowName(records: readonly ThreadRecord[]): string | null {
  for (const r of records) {
    if (r.type === "thread-start") return r.workflow;
  }
  return null;
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

export function ThreadDetail({ client, threadId, onBack }: Props) {
  const sse = useSSE(client, threadId);
  const { status, data, error } = useFetch(() => getThread(client, threadId), [client, threadId]);
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
      workflowName === null ? Promise.resolve(null) : getWorkflowDescriptor(client, workflowName),
    [client, workflowName],
  );

  const descriptor = descriptorFetch.status === "ok" ? descriptorFetch.data : null;
  const nodeStates = useMemo(() => computeNodeStates(records), [records]);

  const indicesByRole = useMemo(() => {
    const m = new Map<string, number[]>();
    for (let i = 0; i < records.length; i++) {
      const r = records[i];
      if (r.type === "role") {
        const list = m.get(r.role) ?? [];
        list.push(i);
        m.set(r.role, list);
      }
    }
    return m;
  }, [records]);

  // Track which occurrence to jump to next per role (cycling)
  const clickCycleRef = useRef<Map<string, number>>(new Map());

  const handleGraphNodeClick = useCallback((nodeId: string) => {
    // Only allow clicks on lit (non-default) nodes
    if (nodeStates.get(nodeId) === undefined || nodeStates.get(nodeId) === "default") return;

    // __start__: scroll to the first record (thread-start prompt)
    if (nodeId === "__start__") {
      const firstCard = document.querySelector('[data-record-index="0"]');
      if (firstCard !== null) firstCard.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }

    // __end__: scroll to bottom
    if (nodeId === "__end__") {
      recordsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
      return;
    }

    // Role nodes: cycle through occurrences
    const indices = indicesByRole.get(nodeId);
    if (indices === undefined || indices.length === 0) return;

    const cycle = clickCycleRef.current.get(nodeId) ?? 0;
    const idx = indices[cycle % indices.length];
    clickCycleRef.current.set(nodeId, cycle + 1);

    const el = document.querySelector(`[data-record-index="${idx}"]`);
    if (el !== null) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
      setHighlightedRole(nodeId);
      highlightTimerRef.current = setTimeout(() => {
        setHighlightedRole(null);
        highlightTimerRef.current = null;
      }, 1500);
    }
  }, [nodeStates, indicesByRole]);

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
      await fn(client, threadId);
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

      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 120px)" }}>
        {descriptor !== null && descriptor.graph.edges.length > 0 && (
          <div
            className="shrink-0"
            style={{
              width: 280,
              position: "sticky",
              top: 16,
              height: "calc(100vh - 120px)",
              alignSelf: "flex-start",
            }}
          >
            <div
              className="rounded-lg border h-full flex flex-col overflow-hidden"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <div
                className="flex items-center justify-between px-3 py-2 text-xs"
                style={{ color: "var(--color-text-muted)" }}
              >
                <span className="font-mono">
                  Workflow graph
                  {workflowName !== null && (
                    <span className="ml-2" style={{ color: "var(--color-text)" }}>
                      {workflowName}
                    </span>
                  )}
                </span>
                <span>
                  {descriptor.graph.edges.length} edge
                  {descriptor.graph.edges.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex-1">
                <WorkflowGraph
                  graph={descriptor.graph}
                  roles={descriptor.roles}
                  nodeStates={nodeStates}
                  onNodeClick={handleGraphNodeClick}
                />
              </div>
            </div>
          </div>
        )}

        <div className="flex-1 min-w-0">
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
                  const roleIndices = indicesByRole.get(r.role);
                  const isFirstForRole = roleIndices !== undefined && roleIndices[0] === i;
                  const flash = highlightedRole === r.role;
                  return (
                    <div
                      key={key}
                      data-record-index={i}
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
                return <div key={key} data-record-index={i}><RecordCard record={r} highlighted={false} /></div>;
              })}
              <div ref={recordsEndRef} aria-hidden />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
