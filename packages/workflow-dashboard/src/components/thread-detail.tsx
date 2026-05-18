import { AlertCircle, ArrowLeft, Layers, Loader2, Pause, Play, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
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
import { Badge } from "./ui/badge.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { ResizablePanel } from "./ui/resizable-panel.tsx";
import { type NodeState, WorkflowGraph } from "./workflow-graph/index.ts";

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

  const hasStart = records.some((r) => r.type === "thread-start");
  if (hasStart) {
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

function isClickableGraphNode(nodeStates: Map<string, NodeState>, nodeId: string): boolean {
  const state = nodeStates.get(nodeId);
  return state !== undefined && state !== "default";
}

function scrollToFirstRecord(): void {
  const firstCard = document.querySelector('[data-record-index="0"]');
  if (firstCard !== null) firstCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

function scrollToRoleOccurrence(
  nodeId: string,
  indicesByRole: Map<string, number[]>,
  clickCycleRef: { current: Map<string, number> },
  onHighlight: (role: string) => void,
): void {
  const indices = indicesByRole.get(nodeId);
  if (indices === undefined || indices.length === 0) return;

  const cycle = clickCycleRef.current.get(nodeId) ?? 0;
  const idx = indices[cycle % indices.length];
  clickCycleRef.current.set(nodeId, cycle + 1);

  const el = document.querySelector(`[data-record-index="${idx}"]`);
  if (el === null) return;
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  onHighlight(nodeId);
}

export function ThreadDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const client = params.client as string;
  const threadId = params.threadId as string;
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

  const clickCycleRef = useRef<Map<string, number>>(new Map());

  const highlightRole = useCallback((role: string) => {
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    setHighlightedRole(role);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedRole(null);
      highlightTimerRef.current = null;
    }, 1500);
  }, []);

  const handleGraphNodeClick = useCallback(
    (nodeId: string) => {
      if (!isClickableGraphNode(nodeStates, nodeId)) return;
      if (nodeId === "__start__") {
        scrollToFirstRecord();
        return;
      }
      if (nodeId === "__end__") {
        recordsEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
        return;
      }
      scrollToRoleOccurrence(nodeId, indicesByRole, clickCycleRef, highlightRole);
    },
    [nodeStates, indicesByRole, highlightRole],
  );

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
      setActionStatus(null);
    } catch (e) {
      setActionStatus(`${action} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Button
          variant="ghost"
          className="gap-1.5 px-2 text-muted-foreground hover:text-foreground transition-colors duration-200"
          onClick={() => navigate(`/${client}/threads`)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to threads
        </Button>
        <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
          <Button
            variant="outline"
            size="sm"
            className="transition-colors duration-200"
            onClick={() => handleAction("pause")}
          >
            <Pause className="h-3.5 w-3.5 text-warning" />
            Pause
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="transition-colors duration-200"
            onClick={() => handleAction("resume")}
          >
            <Play className="h-3.5 w-3.5 text-success" />
            Resume
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="transition-colors duration-200"
            onClick={() => handleAction("kill")}
          >
            <X className="h-3.5 w-3.5 text-destructive" />
            Kill
          </Button>
        </div>
      </div>

      <h2 className="text-xl font-semibold mb-2 font-mono tracking-tight flex items-center gap-2 flex-wrap">
        <span>{threadId}</span>
        {sse.connected && !sse.completed && (
          <Badge variant="success" className="animate-pulse flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-success-foreground" />
            Live
          </Badge>
        )}
      </h2>
      {actionStatus && (
        <Badge variant="secondary" className="mb-4 text-xs font-normal">
          {actionStatus}
        </Badge>
      )}

      <div className="flex gap-4" style={{ minHeight: "calc(100vh - 120px)" }}>
        {descriptor !== null && descriptor.graph.edges.length > 0 && (
          <ResizablePanel
            defaultWidth={360}
            minWidth={240}
            maxWidth={560}
            className={null}
            style={{
              position: "sticky",
              top: 16,
              height: "calc(100vh - 120px)",
              alignSelf: "flex-start",
            }}
          >
            <Card className="h-full flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground bg-muted/50 border-b border-border">
                <span className="font-mono flex items-center gap-1.5">
                  <Layers className="h-3.5 w-3.5" />
                  Workflow graph
                  {workflowName !== null && (
                    <span className="ml-2 text-foreground">{workflowName}</span>
                  )}
                </span>
                <span className="tabular-nums">
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
            </Card>
          </ResizablePanel>
        )}

        <div className="flex-1 min-w-0">
          {status === "loading" && !liveActive && records.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <Loader2 className="h-6 w-6 animate-spin" />
              <span className="text-sm">Loading thread...</span>
            </div>
          )}
          {status === "error" && !liveActive && (
            <div className="flex items-center gap-2 py-8 justify-center text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">Error: {error}</span>
            </div>
          )}
          {(status === "ok" || liveActive || records.length > 0) && (
            <div className="border-l-2 border-border ml-2 pl-4 space-y-3">
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
                      className="relative"
                      ref={(el) => {
                        if (!isFirstForRole) return;
                        if (el !== null) firstCardByRoleRef.current.set(r.role, el);
                        else firstCardByRoleRef.current.delete(r.role);
                      }}
                    >
                      <div className="absolute -left-[1.3rem] top-4 h-2.5 w-2.5 rounded-full border-2 border-border bg-background" />
                      <RecordCard record={r} highlighted={flash} />
                    </div>
                  );
                }
                return (
                  <div key={key} data-record-index={i} className="relative">
                    <div className="absolute -left-[1.3rem] top-4 h-2.5 w-2.5 rounded-full border-2 border-border bg-background" />
                    <RecordCard record={r} highlighted={false} />
                  </div>
                );
              })}
              <div ref={recordsEndRef} aria-hidden />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
