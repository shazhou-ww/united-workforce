import { useCallback, useEffect, useMemo, useState } from "react";
import type { WorkflowDetail } from "../api.ts";
import { getWorkflowDetail, listWorkflows } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { type NodeState, WorkflowGraph } from "./workflow-graph/index.ts";

type Props = {
  agent: string;
};

type DetailCacheEntry =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; detail: WorkflowDetail };

function versionCount(detail: WorkflowDetail): number {
  return detail.history.length + 1;
}

function ExpandedWorkflowBody({
  cacheEntry,
  staticNodeStates,
}: {
  cacheEntry: DetailCacheEntry | undefined;
  staticNodeStates: Map<string, NodeState>;
}) {
  if (cacheEntry === undefined || cacheEntry.status === "loading") {
    return (
      <p className="text-sm py-2" style={{ color: "var(--color-text-muted)" }}>
        Loading workflow details...
      </p>
    );
  }

  if (cacheEntry.status === "error") {
    return (
      <p className="text-sm py-2" style={{ color: "var(--color-error)" }}>
        {cacheEntry.message}
      </p>
    );
  }

  const { detail } = cacheEntry;
  const descriptor = detail.descriptor;
  const edgeCount = descriptor !== null ? descriptor.graph.edges.length : 0;
  const vc = versionCount(detail);

  const hasGraph = descriptor !== null && edgeCount > 0;

  return (
    <div
      className="pt-3 border-t flex gap-4"
      style={{ borderColor: "var(--color-border)" }}
    >
      <div className="space-y-3 shrink-0" style={{ minWidth: 200, maxWidth: 280 }}>
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {detail.name}
          </p>
          <p className="text-xs mt-1 mb-1" style={{ color: "var(--color-text-muted)" }}>
            Hash
          </p>
          <code className="text-xs font-mono block" style={{ color: "var(--color-accent)" }}>
            {detail.hash}
          </code>
        </div>
        <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
          {vc} version{vc !== 1 ? "s" : ""}
        </p>
        <div>
          <p className="text-xs mb-1 font-medium" style={{ color: "var(--color-text-muted)" }}>
            Description
          </p>
          <p className="text-sm whitespace-pre-wrap" style={{ color: "var(--color-text)" }}>
            {descriptor !== null && descriptor.description !== ""
              ? descriptor.description
              : descriptor !== null
                ? "—"
                : "No descriptor available for this workflow version."}
          </p>
        </div>
      </div>
      {hasGraph ? (
        <div
          className="rounded-lg border overflow-hidden flex-1"
          style={{ borderColor: "var(--color-border)", background: "var(--color-bg)", minHeight: 500 }}
        >
          <div
            className="px-3 py-2 text-xs flex justify-between items-center"
            style={{ color: "var(--color-text-muted)", background: "var(--color-surface)" }}
          >
            <span className="font-mono">Workflow graph</span>
            <span>
              {edgeCount} edge{edgeCount === 1 ? "" : "s"}
            </span>
          </div>
          <div style={{ height: 600, width: "100%" }}>
            <WorkflowGraph
              graph={descriptor.graph}
              roles={descriptor.roles}
              nodeStates={staticNodeStates}
              onNodeClick={null}
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function WorkflowList({ agent }: Props) {
  const { status, data, error } = useFetch(() => listWorkflows(agent), [agent]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [detailsByName, setDetailsByName] = useState<Map<string, DetailCacheEntry>>(
    () => new Map(),
  );

  const staticNodeStates = useMemo(() => new Map<string, NodeState>(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset expansion when switching agents
  useEffect(() => {
    setExpanded(new Set());
    setDetailsByName(new Map());
  }, [agent]);

  const ensureDetailLoaded = useCallback(
    (name: string) => {
      setDetailsByName((prev) => {
        const cur = prev.get(name);
        if (cur !== undefined && (cur.status === "ok" || cur.status === "loading")) {
          return prev;
        }
        return new Map(prev).set(name, { status: "loading" });
      });

      void (async () => {
        try {
          const detail = await getWorkflowDetail(agent, name);
          setDetailsByName((prev) => {
            const next = new Map(prev);
            next.set(name, { status: "ok", detail });
            return next;
          });
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          setDetailsByName((prev) => {
            const next = new Map(prev);
            next.set(name, { status: "error", message });
            return next;
          });
        }
      })();
    },
    [agent],
  );

  function toggleExpanded(name: string) {
    const wasExpanded = expanded.has(name);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
    if (!wasExpanded) {
      ensureDetailLoaded(name);
    }
  }

  if (status === "loading")
    return <p style={{ color: "var(--color-text-muted)" }}>Loading workflows...</p>;
  if (status === "error") return <p style={{ color: "var(--color-error)" }}>Error: {error}</p>;

  const workflows = data.workflows;

  return (
    <div>
      <h2 className="text-xl font-semibold mb-4">Workflows</h2>
      {workflows.length === 0 ? (
        <p style={{ color: "var(--color-text-muted)" }}>No workflows registered.</p>
      ) : (
        <div className="space-y-2">
          {workflows.map((w) => {
            const isOpen = expanded.has(w.name);
            return (
              <div
                key={w.name}
                className="rounded-lg border overflow-hidden"
                style={{ background: "var(--color-surface)", borderColor: "var(--color-border)" }}
              >
                <button
                  type="button"
                  onClick={() => toggleExpanded(w.name)}
                  className="w-full text-left p-4 flex items-start justify-between gap-3 hover:opacity-90"
                  style={{ color: "var(--color-text)" }}
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="text-xs font-mono"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        {isOpen ? "▼" : "▶"}
                      </span>
                      <span className="font-medium">{w.name}</span>
                    </div>
                    <code
                      className="text-xs mt-1 block font-mono truncate"
                      style={{ color: "var(--color-accent)" }}
                    >
                      {w.hash !== null ? w.hash : "—"}
                    </code>
                    {w.timestamp !== null ? (
                      <span
                        className="text-xs mt-1 block"
                        style={{ color: "var(--color-text-muted)" }}
                      >
                        Updated {new Date(w.timestamp).toLocaleString()}
                      </span>
                    ) : null}
                  </div>
                </button>
                {isOpen ? (
                  <div className="px-4 pb-4">
                    <ExpandedWorkflowBody
                      cacheEntry={detailsByName.get(w.name)}
                      staticNodeStates={staticNodeStates}
                    />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
