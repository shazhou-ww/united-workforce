import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkflowDetail, WorkflowRoleDescriptor } from "../api.ts";
import { getWorkflowDetail, listWorkflows } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { type NodeState, WorkflowGraph } from "./workflow-graph/index.ts";

type Props = {
  client: string;
};

type DetailCacheEntry =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; detail: WorkflowDetail };

function versionCount(detail: WorkflowDetail): number {
  return detail.history.length + 1;
}

function schemaPropertiesTable(schema: Record<string, unknown>): Array<{
  name: string;
  type: string;
  description: string;
}> {
  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  return Object.entries(props).map(([name, prop]) => {
    let type = String(prop.type ?? "unknown");
    if (!required.has(name)) type += "?";
    const description = String(prop.description ?? "");
    return { name, type, description };
  });
}

function RoleCard({
  roleName,
  role,
}: {
  roleName: string;
  role: WorkflowRoleDescriptor;
}) {
  const fields = schemaPropertiesTable(role.schema);
  return (
    <div
      id={`role-${roleName}`}
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h4
        className="text-sm font-semibold font-mono mb-1"
        style={{ color: "var(--color-text)" }}
      >
        {roleName}
      </h4>
      {role.description !== "" && (
        <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
          {role.description}
        </p>
      )}
      {fields.length > 0 && (
        <div>
          <p
            className="text-[10px] uppercase tracking-wider mb-1 font-medium"
            style={{ color: "var(--color-text-muted)" }}
          >
            Meta Schema
          </p>
          <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--color-border)" }}>
                <th className="text-left py-1 pr-3 font-medium" style={{ color: "var(--color-text-muted)" }}>Field</th>
                <th className="text-left py-1 pr-3 font-medium" style={{ color: "var(--color-text-muted)" }}>Type</th>
                <th className="text-left py-1 font-medium" style={{ color: "var(--color-text-muted)" }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((f) => (
                <tr key={f.name} style={{ borderBottom: "1px solid var(--color-border)" }}>
                  <td className="py-1 pr-3 font-mono" style={{ color: "var(--color-accent)" }}>{f.name}</td>
                  <td className="py-1 pr-3 font-mono" style={{ color: "var(--color-text-muted)" }}>{f.type}</td>
                  <td className="py-1" style={{ color: "var(--color-text)" }}>{f.description || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {fields.length === 0 && Object.keys(role.schema).length > 0 && (
        <pre
          className="text-[10px] font-mono p-2 rounded overflow-x-auto"
          style={{ background: "var(--color-bg)", color: "var(--color-text-muted)" }}
        >
          {JSON.stringify(role.schema, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ExpandedWorkflowBody({
  cacheEntry,
  staticNodeStates,
}: {
  cacheEntry: DetailCacheEntry | undefined;
  staticNodeStates: Map<string, NodeState>;
}) {
  const [highlightedRole, setHighlightedRole] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detail = cacheEntry?.status === "ok" ? cacheEntry.detail : null;
  const descriptor = detail?.descriptor ?? null;
  const roleEntries = descriptor !== null ? Object.entries(descriptor.roles) : [];

  // All roles are "completed" (static view, all nodes lit) — must be before early returns
  const allLitStates = useMemo(() => {
    const m = new Map<string, NodeState>();
    m.set("__start__", "completed");
    m.set("__end__", "completed");
    for (const [name] of roleEntries) {
      m.set(name, "completed");
    }
    return m;
  }, [roleEntries]);

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

  const edgeCount = descriptor !== null ? descriptor.graph.edges.length : 0;
  const vc = detail !== null ? versionCount(detail) : 0;

  const hasGraph = descriptor !== null && edgeCount > 0;

  function handleGraphNodeClick(nodeId: string) {
    const el = document.getElementById(`role-${nodeId}`);
    if (el === null) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    if (highlightTimerRef.current !== null) clearTimeout(highlightTimerRef.current);
    setHighlightedRole(nodeId);
    highlightTimerRef.current = setTimeout(() => {
      setHighlightedRole(null);
      highlightTimerRef.current = null;
    }, 1500);
  }

  return (
    <div className="pt-3 border-t flex gap-4" style={{ borderColor: "var(--color-border)" }}>
      {/* Left: graph sidebar */}
      {hasGraph && (
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
              <span className="font-mono">Workflow graph</span>
              <span>
                {edgeCount} edge{edgeCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex-1">
              <WorkflowGraph
                graph={descriptor.graph}
                roles={descriptor.roles}
                nodeStates={allLitStates}
                onNodeClick={handleGraphNodeClick}
              />
            </div>
          </div>
        </div>
      )}

      {/* Right: workflow info + role cards */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Workflow overview */}
        <div
          className="rounded-lg border p-4"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
        >
          <h3 className="text-base font-semibold mb-2" style={{ color: "var(--color-text)" }}>
            {detail.name}
          </h3>
          <p className="text-sm whitespace-pre-wrap mb-3" style={{ color: "var(--color-text)" }}>
            {descriptor !== null && descriptor.description !== ""
              ? descriptor.description
              : descriptor !== null
                ? "—"
                : "No descriptor available for this workflow version."}
          </p>
          <div className="flex gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span>
              Hash:{" "}
              <code className="font-mono" style={{ color: "var(--color-accent)" }}>
                {detail.hash}
              </code>
            </span>
            <span>
              {vc} version{vc !== 1 ? "s" : ""}
            </span>
            {roleEntries.length > 0 && (
              <span>
                {roleEntries.length} role{roleEntries.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        {/* Role cards */}
        {roleEntries.map(([name, role]) => (
          <div
            key={name}
            style={{
              transition: "box-shadow 0.3s",
              boxShadow: highlightedRole === name ? "0 0 0 2px var(--color-accent)" : "none",
              borderRadius: 8,
            }}
          >
            <RoleCard roleName={name} role={role} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function WorkflowList({ client }: Props) {
  const { status, data, error } = useFetch(() => listWorkflows(client), [client]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [detailsByName, setDetailsByName] = useState<Map<string, DetailCacheEntry>>(
    () => new Map(),
  );

  const staticNodeStates = useMemo(() => new Map<string, NodeState>(), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset expansion when switching clients
  useEffect(() => {
    setExpanded(new Set());
    setDetailsByName(new Map());
  }, [client]);

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
          const detail = await getWorkflowDetail(client, name);
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
    [client],
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
