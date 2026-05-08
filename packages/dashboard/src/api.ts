const BASE = "/api";

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error || `API ${res.status}`);
  }
  return res.json() as Promise<T>;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    throw new Error(`API ${res.status}: ${path}`);
  }
  return res.json() as Promise<T>;
}

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

export type ThreadRecord = {
  type: string;
  role: string | null;
  content: string | null;
  timestamp: number | null;
  [key: string]: unknown;
};

export function listWorkflows(): Promise<{ workflows: WorkflowSummary[] }> {
  return fetchJson("/workflows");
}

export function listThreads(): Promise<{ threads: ThreadSummary[] }> {
  return fetchJson("/threads");
}

export function listRunningThreads(): Promise<{ threads: ThreadSummary[] }> {
  return fetchJson("/threads/running");
}

export function getThread(id: string): Promise<{ records: ThreadRecord[] }> {
  return fetchJson(`/threads/${id}`);
}

export function runThread(workflow: string, prompt: string, maxRounds: number = 10): Promise<{ threadId: string }> {
  return postJson("/threads", { workflow, prompt, maxRounds });
}

export function killThread(threadId: string): Promise<{ ok: boolean }> {
  return postJson(`/threads/${threadId}/kill`, {});
}

export function pauseThread(threadId: string): Promise<{ ok: boolean }> {
  return postJson(`/threads/${threadId}/pause`, {});
}

export function resumeThread(threadId: string): Promise<{ ok: boolean }> {
  return postJson(`/threads/${threadId}/resume`, {});
}

export function getHealth(): Promise<{ ok: boolean }> {
  return fetchJson("/healthz");
}
