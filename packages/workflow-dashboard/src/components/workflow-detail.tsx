import { useMemo, useRef, useState } from "react";
import type { WorkflowDetail as WorkflowDetailData, WorkflowRoleDescriptor } from "../api.ts";
import { getWorkflowDetail } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { type NodeState, WorkflowGraph } from "./workflow-graph/index.ts";

type Props = {
  client: string;
  workflowName: string;
  onBack: () => void;
};

function versionCount(detail: WorkflowDetailData): number {
  return detail.history.length + 1;
}

// ── Schema rendering helpers ────────────────────────────────────────

type SchemaRow = {
  key: string;
  name: string;
  type: string;
  description: string;
  depth: number;
  prefix: string;
  isVariantHeader: boolean;
};

function resolveType(prop: Record<string, unknown>): string {
  if (prop.type === "array") {
    const items = prop.items as Record<string, unknown> | undefined;
    if (items !== undefined) {
      const itemType = String(items.type ?? "unknown");
      return `${itemType}[]`;
    }
    return "array";
  }
  return String(prop.type ?? "unknown");
}

function flattenSchema(
  schema: Record<string, unknown>,
  depth: number,
  parentPrefix: string,
  keyPrefix: string,
): SchemaRow[] {
  const rows: SchemaRow[] = [];

  // Handle oneOf / discriminatedUnion
  const oneOf = schema.oneOf as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(oneOf) && oneOf.length > 0) {
    for (let vi = 0; vi < oneOf.length; vi++) {
      const variant = oneOf[vi];
      const variantProps = (variant.properties ?? {}) as Record<string, Record<string, unknown>>;
      let variantLabel = `Variant ${vi + 1}`;
      for (const [pName, pDef] of Object.entries(variantProps)) {
        if (pDef.const !== undefined) {
          variantLabel = `${pName}: ${String(pDef.const)}`;
          break;
        }
      }
      const isLast = vi === oneOf.length - 1;
      const connector = isLast ? "└" : "├";
      rows.push({
        key: `${keyPrefix}variant-${vi}`,
        name: `${parentPrefix}${connector} ${variantLabel}`,
        type: "",
        description: "",
        depth,
        prefix: parentPrefix,
        isVariantHeader: true,
      });
      const childPrefix = `${parentPrefix}${isLast ? "  " : "│ "}`;
      const variantRequired = new Set<string>(
        Array.isArray(variant.required) ? (variant.required as string[]) : [],
      );
      for (const [pName, pDef] of Object.entries(variantProps)) {
        if (pDef.const !== undefined) continue;
        const subRows = flattenProperty(
          pName,
          pDef,
          depth + 1,
          childPrefix,
          `${keyPrefix}v${vi}-`,
          variantRequired,
        );
        rows.push(...subRows);
      }
    }
    return rows;
  }

  const props = (schema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = new Set<string>(
    Array.isArray(schema.required) ? (schema.required as string[]) : [],
  );
  for (const [name, prop] of Object.entries(props)) {
    const subRows = flattenProperty(name, prop, depth, parentPrefix, keyPrefix, required);
    rows.push(...subRows);
  }
  return rows;
}

function flattenProperty(
  name: string,
  prop: Record<string, unknown>,
  depth: number,
  parentPrefix: string,
  keyPrefix: string,
  required: Set<string>,
): SchemaRow[] {
  const rows: SchemaRow[] = [];
  const hasOneOf = Array.isArray(prop.oneOf) && (prop.oneOf as unknown[]).length > 0;
  let type = hasOneOf ? "⊕ oneOf" : resolveType(prop);
  if (!required.has(name)) type += "?";
  const description = String(prop.description ?? "");
  const displayName = depth > 0 ? `${parentPrefix}└─ ${name}` : name;

  rows.push({
    key: `${keyPrefix}${name}`,
    name: displayName,
    type,
    description,
    depth,
    prefix: parentPrefix,
    isVariantHeader: false,
  });

  if (prop.type === "object" && prop.properties !== undefined) {
    const childPrefix = depth > 0 ? `${parentPrefix}   ` : "  ";
    rows.push(
      ...flattenSchema(
        prop as Record<string, unknown>,
        depth + 1,
        childPrefix,
        `${keyPrefix}${name}-`,
      ),
    );
  }

  if (prop.type === "array") {
    const items = prop.items as Record<string, unknown> | undefined;
    if (items !== undefined && items.type === "object" && items.properties !== undefined) {
      const childPrefix = depth > 0 ? `${parentPrefix}   ` : "  ";
      rows.push(...flattenSchema(items, depth + 1, childPrefix, `${keyPrefix}${name}-`));
    }
  }

  if (hasOneOf) {
    const childPrefix = depth > 0 ? `${parentPrefix}   ` : "  ";
    rows.push(
      ...flattenSchema(
        prop as Record<string, unknown>,
        depth + 1,
        childPrefix,
        `${keyPrefix}${name}-`,
      ),
    );
  }

  return rows;
}

// ── Components ──────────────────────────────────────────────────────

function RoleCard({ roleName, role }: { roleName: string; role: WorkflowRoleDescriptor }) {
  const rows = flattenSchema(role.schema, 0, "", `${roleName}-`);
  return (
    <div
      id={`role-${roleName}`}
      className="rounded-lg border p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
    >
      <h4 className="text-sm font-semibold font-mono mb-1" style={{ color: "var(--color-text)" }}>
        {roleName}
      </h4>
      {role.description !== "" && (
        <p className="text-xs mb-3" style={{ color: "var(--color-text-muted)" }}>
          {role.description}
        </p>
      )}
      {role.systemPrompt !== "" && (
        <details className="mb-3">
          <summary
            className="text-[10px] uppercase tracking-wider font-medium cursor-pointer select-none"
            style={{ color: "var(--color-text-muted)" }}
          >
            System Prompt
          </summary>
          <pre
            className="mt-1 text-xs p-2 rounded overflow-x-auto whitespace-pre-wrap break-words"
            style={{
              color: "var(--color-text)",
              background: "var(--color-bg)",
              border: "1px solid var(--color-border)",
              maxHeight: "300px",
              overflowY: "auto",
            }}
          >
            {role.systemPrompt}
          </pre>
        </details>
      )}
      {rows.length > 0 && (
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
                <th
                  className="text-left py-1 pr-3 font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Field
                </th>
                <th
                  className="text-left py-1 pr-3 font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Type
                </th>
                <th
                  className="text-left py-1 font-medium"
                  style={{ color: "var(--color-text-muted)" }}
                >
                  Description
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  style={{
                    borderBottom: r.isVariantHeader ? "none" : "1px solid var(--color-border)",
                  }}
                >
                  <td
                    className="py-1 pr-3 font-mono whitespace-pre"
                    style={{
                      color: r.isVariantHeader ? "var(--color-text-muted)" : "var(--color-accent)",
                      fontStyle: r.isVariantHeader ? "italic" : "normal",
                    }}
                  >
                    {r.name}
                  </td>
                  <td className="py-1 pr-3 font-mono" style={{ color: "var(--color-text-muted)" }}>
                    {r.type}
                  </td>
                  <td className="py-1" style={{ color: "var(--color-text)" }}>
                    {r.description || (r.isVariantHeader ? "" : "—")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length === 0 && Object.keys(role.schema).length > 0 && (
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

// ── Main component ──────────────────────────────────────────────────

export function WorkflowDetail({ client, workflowName, onBack }: Props) {
  const { status, data, error } = useFetch(
    () => getWorkflowDetail(client, workflowName),
    [client, workflowName],
  );

  const [highlightedRole, setHighlightedRole] = useState<string | null>(null);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const detail = status === "ok" ? data : null;
  const descriptor = detail?.descriptor ?? null;
  const roleEntries = descriptor !== null ? Object.entries(descriptor.roles) : [];
  const edgeCount = descriptor !== null ? descriptor.graph.edges.length : 0;
  const hasGraph = descriptor !== null && edgeCount > 0;

  const allLitStates = useMemo(() => {
    const m = new Map<string, NodeState>();
    m.set("__start__", "completed");
    m.set("__end__", "completed");
    for (const [name] of roleEntries) {
      m.set(name, "completed");
    }
    return m;
  }, [roleEntries]);

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
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          type="button"
          onClick={onBack}
          className="text-sm hover:underline"
          style={{ color: "var(--color-accent)" }}
        >
          ← Back to workflows
        </button>
      </div>

      <h2 className="text-xl font-semibold mb-4 font-mono">{workflowName}</h2>

      {status === "loading" && <p style={{ color: "var(--color-text-muted)" }}>Loading...</p>}
      {status === "error" && <p style={{ color: "var(--color-error)" }}>Error: {error}</p>}

      {detail !== null && (
        <div className="flex gap-4" style={{ minHeight: "calc(100vh - 160px)" }}>
          {/* Left: fixed graph sidebar */}
          {hasGraph && (
            <div
              className="shrink-0"
              style={{
                width: 280,
                position: "sticky",
                top: 16,
                height: "calc(100vh - 160px)",
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

          {/* Right: scrollable content */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Workflow overview */}
            <div
              className="rounded-lg border p-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <p
                className="text-sm whitespace-pre-wrap mb-3"
                style={{ color: "var(--color-text)" }}
              >
                {descriptor !== null && descriptor.description !== ""
                  ? descriptor.description
                  : "—"}
              </p>
              <div className="flex gap-4 text-xs" style={{ color: "var(--color-text-muted)" }}>
                <span>
                  Hash:{" "}
                  <code className="font-mono" style={{ color: "var(--color-accent)" }}>
                    {detail.hash}
                  </code>
                </span>
                <span>
                  {versionCount(detail)} version{versionCount(detail) !== 1 ? "s" : ""}
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
      )}
    </div>
  );
}
