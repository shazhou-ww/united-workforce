import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  GitBranch,
  Hash,
  Layers,
  Loader2,
  User,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import type { WorkflowDetail as WorkflowDetailData, WorkflowRoleDescriptor } from "../api.ts";
import { getWorkflowDetail } from "../api.ts";
import { useFetch } from "../hooks.ts";
import { cn } from "../lib/utils.ts";
import { Markdown } from "./markdown.tsx";
import { Button } from "./ui/button.tsx";
import { Card } from "./ui/card.tsx";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible.tsx";
import { ResizablePanel } from "./ui/resizable-panel.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table.tsx";
import { type NodeState, WorkflowGraph } from "./workflow-graph/index.ts";

const ROLE_BORDER_COLORS = [
  "border-l-blue-400/60",
  "border-l-emerald-400/60",
  "border-l-amber-400/60",
  "border-l-violet-400/60",
  "border-l-rose-400/60",
  "border-l-cyan-400/60",
  "border-l-orange-400/60",
  "border-l-teal-400/60",
];

function roleBorderColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) | 0;
  }
  return ROLE_BORDER_COLORS[Math.abs(hash) % ROLE_BORDER_COLORS.length];
}

function versionCount(detail: WorkflowDetailData): number {
  return detail.history.length + 1;
}

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

function RoleCard({ roleName, role }: { roleName: string; role: WorkflowRoleDescriptor }) {
  const rows = flattenSchema(role.schema, 0, "", `${roleName}-`);
  const [promptOpen, setPromptOpen] = useState(false);

  return (
    <Card id={`role-${roleName}`} className={cn("p-4 border-l-4", roleBorderColor(roleName))}>
      <h4 className="text-sm font-semibold font-mono mb-1 text-foreground flex items-center gap-1.5">
        <User className="h-3.5 w-3.5 text-muted-foreground" />
        {roleName}
      </h4>
      {role.description !== "" && (
        <p className="text-xs mb-3 text-muted-foreground">{role.description}</p>
      )}
      {role.systemPrompt !== "" && (
        <Collapsible open={promptOpen} onOpenChange={setPromptOpen} className="mb-3">
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 h-7 px-2 text-[10px] uppercase tracking-wider text-muted-foreground bg-muted/50 rounded-md transition-all duration-200"
            >
              <ChevronDown
                className={cn("h-3 w-3 transition-transform", promptOpen && "rotate-180")}
              />
              System Prompt
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-1 p-2 rounded-md overflow-y-auto text-xs bg-background border border-border max-h-[300px]">
              <Markdown content={role.systemPrompt} />
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
      {rows.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider mb-1 font-medium text-muted-foreground">
            Meta Schema
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">Field</TableHead>
                <TableHead className="text-xs">Type</TableHead>
                <TableHead className="text-xs">Description</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow
                  key={r.key}
                  className={cn(r.isVariantHeader ? "border-b-0" : "", "even:bg-muted/30")}
                >
                  <TableCell
                    className={cn(
                      "font-mono whitespace-pre text-xs",
                      r.isVariantHeader ? "italic text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {r.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {r.type}
                  </TableCell>
                  <TableCell className="text-xs">
                    {r.description || (r.isVariantHeader ? "" : "—")}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {rows.length === 0 && Object.keys(role.schema).length > 0 && (
        <pre className="text-[10px] font-mono p-2 rounded-md overflow-x-auto bg-background text-muted-foreground">
          {JSON.stringify(role.schema, null, 2)}
        </pre>
      )}
    </Card>
  );
}

export function WorkflowDetail() {
  const params = useParams();
  const navigate = useNavigate();
  const client = params.client as string;
  const workflowName = params.workflowName as string;
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
        <Button
          variant="ghost"
          className="gap-1.5 px-2 text-muted-foreground hover:text-foreground transition-all duration-200"
          onClick={() => navigate(`/${client}/workflows`)}
        >
          <ArrowLeft className="h-4 w-4" />
          Back to workflows
        </Button>
      </div>

      <h2 className="text-xl font-semibold mb-4 font-mono tracking-tight">{workflowName}</h2>

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading workflow...</span>
        </div>
      )}
      {status === "error" && (
        <div className="flex items-center justify-center gap-2 py-12 text-destructive">
          <AlertCircle className="h-5 w-5" />
          <span>Error: {error}</span>
        </div>
      )}

      {detail !== null && (
        <div className="flex gap-4" style={{ minHeight: "calc(100vh - 160px)" }}>
          {hasGraph && (
            <ResizablePanel
              defaultWidth={360}
              minWidth={240}
              maxWidth={560}
              className={null}
              style={{
                position: "sticky",
                top: 16,
                height: "calc(100vh - 160px)",
                alignSelf: "flex-start",
              }}
            >
              <Card className="h-full flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 text-xs text-muted-foreground bg-muted/50">
                  <span className="font-mono flex items-center gap-1.5">
                    <Layers className="h-3.5 w-3.5" />
                    Workflow graph
                  </span>
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
              </Card>
            </ResizablePanel>
          )}

          <div className="flex-1 min-w-0 space-y-4">
            <Card className="p-4">
              <div className="rounded-md bg-muted/30 px-3 py-2 mb-3">
                <p className="text-sm whitespace-pre-wrap text-foreground">
                  {descriptor !== null && descriptor.description !== ""
                    ? descriptor.description
                    : "—"}
                </p>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-mono">
                  <Hash className="h-3 w-3" />
                  <span className="text-foreground">{detail.hash}</span>
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                  <GitBranch className="h-3 w-3" />
                  {versionCount(detail)} version{versionCount(detail) !== 1 ? "s" : ""}
                </span>
                {roleEntries.length > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs">
                    <User className="h-3 w-3" />
                    {roleEntries.length} role{roleEntries.length !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </Card>

            {roleEntries.map(([name, role]) => (
              <div
                key={name}
                className={cn(
                  "rounded-lg transition-shadow duration-300",
                  highlightedRole === name && "ring-2 ring-ring",
                )}
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
