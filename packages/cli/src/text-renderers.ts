/**
 * Per-command text renderers — the per-command registry from spec
 * `cli-format-text-renderer-registry.md`.
 *
 * Each renderer accepts the command's payload (already mapped via the
 * output-mappers module) and returns a human-readable string. Renderers must
 * never throw on partial/missing data and must never return `undefined`.
 *
 * Distinct from the existing Liquid template registry in `format.ts`: this
 * registry is plain JS functions (the spec contract is
 * `Record<string, (data: unknown) => string>`). The Liquid templates remain
 * the primary rendering path inside `writeEnvelope`; these renderers are the
 * fallback contract surface so callers can resolve `text` rendering without
 * needing access to a CAS store.
 */

type ThreadListItem = {
  threadId: string;
  workflowHash: string;
  workflowName: string | null;
  status: string;
  currentRole: string | null;
  startedAt: number | null;
  completedAt: number | null;
};

type ThreadListPayload = { items: ThreadListItem[] };

type ThreadStatusPayload = {
  threadId: string;
  workflowHash: string;
  head: string | null;
  status: string;
  currentRole: string | null;
  suspendedRole: string | null;
  suspendMessage: string | null;
  done: boolean;
};

type ThreadStartPayload = {
  threadId: string;
  workflowHash: string;
};

type WorkflowListItem = {
  name: string;
  hash: string;
  source: string;
  description: string;
};

type WorkflowListPayload = { items: WorkflowListItem[] };

type WorkflowDetailPayload = {
  name: string;
  hash: string;
  version: number;
  description: string;
  roles: Record<string, { description: string; goal: string }>;
  graph: Record<string, Record<string, { role: string; prompt: string }>>;
};

type StepListItem = {
  hash: string;
  role: string;
  durationMs: number | null;
};

type StepListPayload = {
  threadId: string;
  items: StepListItem[];
};

type ThreadCancelPayload = {
  thread: string;
  cancelled: boolean;
};

type StepDetailPayload = {
  hash: string;
  role: string;
  agent: string;
  status: string;
  startedAtMs: number | null;
  completedAtMs: number | null;
  durationMs: number | null;
  frontmatter: Record<string, unknown>;
  turns: Array<{ role: string; content: string; timestamp: number | null }>;
};

function asObject(data: unknown): Record<string, unknown> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return {};
}

function asString(value: unknown, fallback = "-"): string {
  if (typeof value === "string" && value.length > 0) return value;
  return fallback;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function formatDuration(durationMs: unknown): string {
  if (typeof durationMs !== "number" || !Number.isFinite(durationMs)) return "-";
  if (durationMs >= 1000) return `${(durationMs / 1000).toFixed(1)}s`;
  return `${durationMs}ms`;
}

function pad(s: string, width: number): string {
  if (s.length >= width) return s.slice(0, width);
  return s + " ".repeat(width - s.length);
}

function formatTimestamp(ts: unknown): string {
  if (typeof ts !== "number" || !Number.isFinite(ts)) return "-";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "-";
  const pad2 = (n: number): string => n.toString().padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

export function renderThreadList(data: unknown): string {
  const payload = asObject(data) as Partial<ThreadListPayload>;
  const items = asArray(payload.items) as ThreadListItem[];
  const lines: string[] = [
    "THREAD                      WORKFLOW       STATUS     ROLE       STARTED",
  ];
  for (const item of items) {
    const it = asObject(item);
    const threadId = asString(it.threadId);
    const workflowHash = asString(it.workflowHash);
    const status = pad(asString(it.status), 9);
    const role = pad(asString(it.currentRole), 10);
    const started = formatTimestamp(it.startedAt);
    lines.push(`${threadId}  ${workflowHash}  ${status} ${role} ${started}`);
  }
  return lines.join("\n");
}

export function renderThreadShow(data: unknown): string {
  const p = asObject(data) as Partial<ThreadStatusPayload>;
  const status = asString(p.status);
  const role =
    status === "suspended" && typeof p.suspendedRole === "string" && p.suspendedRole.length > 0
      ? p.suspendedRole
      : asString(p.currentRole);
  const head = asString(p.head);
  const lines = [
    `Thread  ${asString(p.threadId)}`,
    `Workflow ${asString(p.workflowHash)}`,
    `Status  ${status}`,
    `Role    ${role}`,
    `Head    ${head}`,
  ];
  if (
    status === "suspended" &&
    typeof p.suspendMessage === "string" &&
    p.suspendMessage.length > 0
  ) {
    lines.push(`Suspend  ${p.suspendMessage}`);
  }
  return lines.join("\n");
}

export function renderThreadStart(data: unknown): string {
  const p = asObject(data) as Partial<ThreadStartPayload>;
  return `Thread  ${asString(p.threadId)}\nWorkflow ${asString(p.workflowHash)}`;
}

export function renderWorkflowList(data: unknown): string {
  const payload = asObject(data) as Partial<WorkflowListPayload>;
  const items = asArray(payload.items) as WorkflowListItem[];
  const lines: string[] = ["NAME          HASH           SOURCE     DESCRIPTION"];
  for (const item of items) {
    const it = asObject(item);
    const name = pad(asString(it.name), 13);
    const hash = asString(it.hash);
    const source = pad(asString(it.source), 10);
    const description = asString(it.description, "");
    lines.push(`${name} ${hash}  ${source} ${description}`);
  }
  return lines.join("\n");
}

export function renderWorkflowShow(data: unknown): string {
  const p = asObject(data) as Partial<WorkflowDetailPayload>;
  const roles =
    p.roles !== null && typeof p.roles === "object" && !Array.isArray(p.roles)
      ? Object.keys(p.roles)
      : [];
  const lines = [
    `Workflow  ${asString(p.name)}`,
    `Version   ${typeof p.version === "number" ? p.version : "-"}`,
    `Hash      ${asString(p.hash)}`,
    `Roles     ${roles.join(", ")}`,
  ];
  if (typeof p.description === "string" && p.description.length > 0) {
    lines.push(`Description ${p.description}`);
  }
  return lines.join("\n");
}

export function renderStepList(data: unknown): string {
  const payload = asObject(data) as Partial<StepListPayload>;
  const items = asArray(payload.items) as StepListItem[];
  const lines: string[] = ["HASH           ROLE        DURATION"];
  for (const item of items) {
    const it = asObject(item);
    const hash = asString(it.hash);
    const role = pad(asString(it.role), 10);
    const dur = formatDuration(it.durationMs);
    lines.push(`${hash}  ${role}  ${dur}`);
  }
  return lines.join("\n");
}

export function renderStepShow(data: unknown): string {
  const p = asObject(data) as Partial<StepDetailPayload>;
  return [
    `Step    ${asString(p.hash)}`,
    `Role    ${asString(p.role)}`,
    `Agent   ${asString(p.agent)}`,
    `Status  ${asString(p.status)}`,
    `Duration ${formatDuration(p.durationMs)}`,
  ].join("\n");
}

export function renderThreadCancel(data: unknown): string {
  const p = asObject(data) as Partial<ThreadCancelPayload>;
  const cancelled = typeof p.cancelled === "boolean" ? (p.cancelled ? "yes" : "no") : "-";
  return [
    `Thread     ${asString(p.thread)}`,
    `Status     cancelled`,
    `Cancelled  ${cancelled}`,
  ].join("\n");
}
