const GATEWAY_URL = import.meta.env.VITE_GATEWAY_URL || "";

export function getApiKey(): string | null {
  try {
    return localStorage.getItem("workflow-api-key");
  } catch {
    return null;
  }
}

export function setApiKey(key: string): void {
  localStorage.setItem("workflow-api-key", key);
}

export function clearApiKey(): void {
  localStorage.removeItem("workflow-api-key");
}

export function hasApiKey(): boolean {
  return getApiKey() !== null && getApiKey() !== "";
}

function authHeaders(): Record<string, string> {
  const key = getApiKey();
  if (key) return { Authorization: `Bearer ${key}` };
  return {};
}

function clientBase(client: string): string {
  if (GATEWAY_URL) {
    return `${GATEWAY_URL}/api/clients/${client}`;
  }
  // Local dev: proxy via vite, no client prefix
  return "/api";
}

async function postJson<T>(base: string, path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: res.statusText }))) as { error: string };
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchJson<T>(base: string, path: string): Promise<T> {
  const res = await fetch(`${base}${path}`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

// ── Endpoint types ──────────────────────────────────────────────────

export type ClientEndpoint = {
  name: string;
  url: string;
  status: string;
  lastHeartbeat: number;
};

export type WorkflowSummary = {
  name: string;
  hash: string | null;
  timestamp: number | null;
};

export type WorkflowHistoryEntry = {
  hash: string;
  timestamp: number;
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

export type WorkflowGraphEdge = {
  from: string;
  to: string;
  condition: string;
  conditionDescription: string | null;
};

export type WorkflowGraph = {
  edges: readonly WorkflowGraphEdge[];
};

export type WorkflowRoleDescriptor = {
  description: string;
  systemPrompt: string;
  schema: Record<string, unknown>;
};

export type WorkflowDescriptor = {
  description: string;
  roles: Record<string, WorkflowRoleDescriptor>;
  graph: WorkflowGraph;
};

export type WorkflowDetail = {
  name: string;
  hash: string;
  timestamp: number;
  history: readonly WorkflowHistoryEntry[];
  descriptor: WorkflowDescriptor | null;
};

// ── Gateway endpoints ───────────────────────────────────────────────

export function listClients(): Promise<ClientEndpoint[]> {
  const url = GATEWAY_URL || "";
  return fetchJson(url, "/api/gateway/endpoints");
}

// ── Client-scoped endpoints ──────────────────────────────────────────

export function listWorkflows(client: string): Promise<{ workflows: WorkflowSummary[] }> {
  return fetchJson(clientBase(client), "/workflows");
}

export async function getWorkflowDetail(client: string, name: string): Promise<WorkflowDetail> {
  return fetchJson<WorkflowDetail>(clientBase(client), `/workflows/${encodeURIComponent(name)}`);
}

export async function getWorkflowDescriptor(
  client: string,
  name: string,
): Promise<WorkflowDescriptor | null> {
  const res = await getWorkflowDetail(client, name);
  return res.descriptor;
}

export function listThreads(client: string): Promise<{ threads: ThreadSummary[] }> {
  return fetchJson(clientBase(client), "/threads");
}

export function listRunningThreads(client: string): Promise<{ threads: ThreadSummary[] }> {
  return fetchJson(clientBase(client), "/threads/running");
}

export function getThread(client: string, id: string): Promise<{ records: ThreadRecord[] }> {
  return fetchJson(clientBase(client), `/threads/${id}`);
}

export function runThread(
  client: string,
  workflow: string,
  prompt: string,
): Promise<{ threadId: string }> {
  return postJson(clientBase(client), "/threads", { workflow, prompt });
}

export function killThread(client: string, threadId: string): Promise<{ ok: boolean }> {
  return postJson(clientBase(client), `/threads/${threadId}/kill`, {});
}

export function pauseThread(client: string, threadId: string): Promise<{ ok: boolean }> {
  return postJson(clientBase(client), `/threads/${threadId}/pause`, {});
}

export function resumeThread(client: string, threadId: string): Promise<{ ok: boolean }> {
  return postJson(clientBase(client), `/threads/${threadId}/resume`, {});
}

export function getClientHealth(client: string): Promise<{ ok: boolean }> {
  return fetchJson(clientBase(client), "/healthz");
}
