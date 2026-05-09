const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "";

function agentBase(agent: string): string {
  if (GATEWAY_URL) {
    return `${GATEWAY_URL}/api/${agent}`;
  }
  // Local dev: proxy via vite, no agent prefix
  return "/api";
}

async function postJson<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// ── Endpoint types ──────────────────────────────────────────────────

export type AgentEndpoint = {
  name: string;
  url: string;
  status: string;
  lastHeartbeat: number;
};

export type WorkflowSummary = {
  name: string;
  currentHash: string;
  versions: number;
};

export type ThreadSummary = {
  threadId: string;
  workflow: string | null;
  hash: string | null;
  startedAt: string | null;
  status: string | null;
};

export type ThreadStartRecord = {
  type: "thread-start";
  workflow: string;
  prompt: string | null;
  threadId: string;
  status: string;
  timestamp: null;
};

export type RoleRecord = {
  type: "role";
  role: string;
  content: string;
  timestamp: number | null;
  meta: Record<string, unknown>;
};

export type WorkflowResultRecord = {
  type: "workflow-result";
  returnCode: number;
  content: string;
  timestamp: number | null;
};

export type ThreadRecord = ThreadStartRecord | RoleRecord | WorkflowResultRecord;

// ── Gateway endpoints ───────────────────────────────────────────────

export function listAgents(): Promise<AgentEndpoint[]> {
  const url = GATEWAY_URL || "";
  return fetchJson(url, "/endpoints");
}

// ── Agent-scoped endpoints ──────────────────────────────────────────

export function listWorkflows(agent: string): Promise<{ workflows: WorkflowSummary[] }> {
  return fetchJson(agentBase(agent), "/workflows");
}

export function listThreads(agent: string): Promise<{ threads: ThreadSummary[] }> {
  return fetchJson(agentBase(agent), "/threads");
}

export function listRunningThreads(agent: string): Promise<{ threads: ThreadSummary[] }> {
  return fetchJson(agentBase(agent), "/threads/running");
}

export function getThread(agent: string, id: string): Promise<{ records: ThreadRecord[] }> {
  return fetchJson(agentBase(agent), `/threads/${id}`);
}

export function runThread(
  agent: string,
  workflow: string,
  prompt: string,
  maxRounds: number = 10,
): Promise<{ threadId: string }> {
  return postJson(agentBase(agent), "/threads", { workflow, prompt, maxRounds });
}

export function killThread(agent: string, threadId: string): Promise<{ ok: boolean }> {
  return postJson(agentBase(agent), `/threads/${threadId}/kill`, {});
}

export function pauseThread(agent: string, threadId: string): Promise<{ ok: boolean }> {
  return postJson(agentBase(agent), `/threads/${threadId}/pause`, {});
}

export function resumeThread(agent: string, threadId: string): Promise<{ ok: boolean }> {
  return postJson(agentBase(agent), `/threads/${threadId}/resume`, {});
}

export function getAgentHealth(agent: string): Promise<{ ok: boolean }> {
  return fetchJson(agentBase(agent), "/healthz");
}
