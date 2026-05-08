const BASE = "/api";

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

export function getHealth(): Promise<{ ok: boolean }> {
  return fetchJson("/healthz");
}
