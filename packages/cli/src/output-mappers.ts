import type { CasRef, StartOutput, StepOutput } from "@united-workforce/protocol";
import { extractUlidTimestamp } from "@united-workforce/util";
import type { ThreadListItemWithStatus } from "./commands/thread.js";
import type {
  WorkflowAddOutput,
  WorkflowListEntry,
  WorkflowShowOutput,
} from "./commands/workflow.js";

/**
 * Mappers that convert the existing rich command outputs into the
 * schema-aligned payload shapes registered under `@uwf/output/*`.
 *
 * Each mapper returns plain payload data — no CAS refs, no JSON encoding,
 * no I/O. The CLI calls one of these immediately before handing the payload
 * to `writeEnvelope`.
 */

export type ThreadStartPayload = {
  threadId: string;
  workflowHash: string;
};

export function toThreadStartPayload(out: StartOutput): ThreadStartPayload {
  return { threadId: out.thread, workflowHash: out.workflow };
}

export type ThreadStatusPayload = {
  threadId: string;
  workflowHash: string;
  head: string | null;
  status: string;
  currentRole: string | null;
  suspendedRole: string | null;
  suspendMessage: string | null;
  done: boolean;
};

export function toThreadStatusPayload(out: StepOutput): ThreadStatusPayload {
  return {
    threadId: out.thread,
    workflowHash: out.workflow,
    head: out.head ?? null,
    status: out.status,
    currentRole: out.currentRole,
    suspendedRole: out.suspendedRole,
    suspendMessage: out.suspendMessage,
    done: out.done,
  };
}

export type ThreadListPayload = {
  items: Array<{
    threadId: string;
    workflowHash: string;
    workflowName: string | null;
    status: string;
    currentRole: string | null;
    startedAt: number | null;
    completedAt: number | null;
  }>;
};

export function toThreadListPayload(items: ThreadListItemWithStatus[]): ThreadListPayload {
  return {
    items: items.map((it) => ({
      threadId: it.thread,
      workflowHash: it.workflow,
      workflowName: it.workflowName,
      status: it.status,
      currentRole: it.currentRole,
      startedAt: extractUlidTimestamp(it.thread),
      completedAt: null,
    })),
  };
}

export type ThreadExecPayload = {
  threadId: string;
  workflowHash: string;
  steps: Array<{
    head: string;
    status: string;
    currentRole: string | null;
    done: boolean;
    role: string | null;
    suspendedRole: string | null;
    suspendMessage: string | null;
  }>;
};

export function toThreadExecPayload(results: StepOutput[]): ThreadExecPayload {
  const first = results[0];
  return {
    threadId: first?.thread ?? "",
    workflowHash: first?.workflow ?? "",
    steps: results.map((r) => ({
      head: r.head,
      status: r.status,
      currentRole: r.currentRole,
      done: r.done,
      role: r.currentRole ?? r.suspendedRole ?? null,
      suspendedRole: r.suspendedRole,
      suspendMessage: r.suspendMessage,
    })),
  };
}

export type StepDetailPayload = {
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

export function toStepDetailPayload(stepHash: CasRef, raw: unknown): StepDetailPayload {
  const r = (raw ?? {}) as Record<string, unknown>;
  const turnsIn = Array.isArray(r.turns) ? (r.turns as unknown[]) : [];
  const startedAtMs = numericOrNull(r.startedAtMs);
  const completedAtMs = numericOrNull(r.completedAtMs);
  const durationMs =
    startedAtMs !== null && completedAtMs !== null && completedAtMs >= startedAtMs
      ? completedAtMs - startedAtMs
      : null;
  const frontmatter =
    r.frontmatter !== null && typeof r.frontmatter === "object" && !Array.isArray(r.frontmatter)
      ? (r.frontmatter as Record<string, unknown>)
      : {};
  const status =
    typeof frontmatter.$status === "string"
      ? (frontmatter.$status as string)
      : typeof r.status === "string"
        ? (r.status as string)
        : "";
  return {
    hash: stepHash,
    role: typeof r.role === "string" ? r.role : "",
    agent: typeof r.agent === "string" ? r.agent : "",
    status,
    startedAtMs,
    completedAtMs,
    durationMs,
    frontmatter,
    turns: turnsIn.map((t) => {
      const o = (t ?? {}) as Record<string, unknown>;
      return {
        role: typeof o.role === "string" ? o.role : "",
        content: typeof o.content === "string" ? o.content : "",
        timestamp: numericOrNull(o.timestamp),
      };
    }),
  };
}

function numericOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type StepListPayload = {
  threadId: string;
  items: Array<{ hash: string; role: string; durationMs: number | null }>;
};

type StepsLikeOutput = {
  thread: string;
  steps: Array<{
    hash: CasRef;
    role?: string;
    durationMs?: number;
  }>;
};

export function toStepListPayload(out: StepsLikeOutput): StepListPayload {
  return {
    threadId: out.thread,
    items: out.steps
      .filter((s) => typeof s.role === "string")
      .map((s) => ({
        hash: s.hash,
        role: s.role ?? "",
        durationMs: typeof s.durationMs === "number" ? s.durationMs : null,
      })),
  };
}

export type WorkflowDetailPayload = {
  name: string;
  hash: string;
  version: number;
  description: string;
  roles: Record<string, { description: string; goal: string }>;
  graph: Record<string, Record<string, { role: string; prompt: string }>>;
};

export function toWorkflowDetailPayload(out: WorkflowShowOutput): WorkflowDetailPayload {
  const roles: Record<string, { description: string; goal: string }> = {};
  for (const [name, def] of Object.entries(out.payload.roles)) {
    roles[name] = { description: def.description, goal: def.goal };
  }
  const graph: Record<string, Record<string, { role: string; prompt: string }>> = {};
  for (const [from, transitions] of Object.entries(out.payload.graph)) {
    const t: Record<string, { role: string; prompt: string }> = {};
    for (const [status, target] of Object.entries(transitions)) {
      t[status] = { role: target.role, prompt: target.prompt };
    }
    graph[from] = t;
  }
  return {
    name: out.name ?? out.payload.name,
    hash: out.hash,
    version: out.payload.version,
    description: out.payload.description,
    roles,
    graph,
  };
}

export type WorkflowListPayload = {
  items: Array<{ name: string; hash: string; source: string; description: string }>;
};

export function toWorkflowListPayload(entries: WorkflowListEntry[]): WorkflowListPayload {
  return {
    items: entries.map((e) => ({
      name: e.name,
      hash: e.hash,
      source:
        e.origin === "local" ? ".workflows" : e.origin === "paths" ? "workflowPaths" : "registry",
      description: "",
    })),
  };
}

export type WorkflowAddPayload = {
  name: string;
  hash: string;
};

export function toWorkflowAddPayload(out: WorkflowAddOutput): WorkflowAddPayload {
  return { name: out.name, hash: out.hash };
}

export type ValidateResultPayload = {
  valid: boolean;
  errors: string[];
};

export function toValidateResultPayload(errors: string[]): ValidateResultPayload {
  return { valid: errors.length === 0, errors };
}
