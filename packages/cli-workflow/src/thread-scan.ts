import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { pathExists, readTextFileIfExists } from "./fs-utils.js";

export type RunningThreadRow = {
  threadId: string;
  hash: string;
  workflowName: string | null;
};

export type HistoricalThreadRow = {
  threadId: string;
  hash: string;
  workflowName: string | null;
};

async function readWorkflowNameFromDataJsonl(dataPath: string): Promise<string | null> {
  const text = await readTextFileIfExists(dataPath);
  if (text === null) {
    return null;
  }
  const firstLine = text.split("\n")[0];
  if (firstLine === undefined || firstLine.trim() === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(firstLine) as unknown;
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object") {
    return null;
  }
  const name = (parsed as Record<string, unknown>).name;
  return typeof name === "string" ? name : null;
}

/** Threads currently executing — identified via `<threadId>.running` markers. */
export async function listRunningThreads(storageRoot: string): Promise<RunningThreadRow[]> {
  const logsRoot = join(storageRoot, "logs");
  if (!(await pathExists(logsRoot))) {
    return [];
  }

  const hashes = await readdir(logsRoot);
  const out: RunningThreadRow[] = [];

  for (const hash of hashes) {
    const dir = join(logsRoot, hash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      if (!fileName.endsWith(".running")) {
        continue;
      }
      const threadId = fileName.slice(0, -".running".length);
      const dataPath = join(dir, `${threadId}.data.jsonl`);
      const workflowName = await readWorkflowNameFromDataJsonl(dataPath);
      out.push({ threadId, hash, workflowName });
    }
  }

  out.sort((a, b) => {
    const ha = `${a.hash}/${a.threadId}`;
    const hb = `${b.hash}/${b.threadId}`;
    return ha.localeCompare(hb);
  });

  return out;
}

/**
 * Historical threads discovered via `*.data.jsonl`.
 * When `workflowNameFilter` is non-null, only threads whose start record `name` matches are returned.
 */
export async function listHistoricalThreads(
  storageRoot: string,
  workflowNameFilter: string | null,
): Promise<HistoricalThreadRow[]> {
  const logsRoot = join(storageRoot, "logs");
  if (!(await pathExists(logsRoot))) {
    return [];
  }

  const hashes = await readdir(logsRoot);
  const out: HistoricalThreadRow[] = [];

  for (const hash of hashes) {
    const dir = join(logsRoot, hash);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const fileName of entries) {
      if (!fileName.endsWith(".data.jsonl")) {
        continue;
      }
      const threadId = fileName.slice(0, -".data.jsonl".length);
      const dataPath = join(dir, fileName);
      const workflowName = await readWorkflowNameFromDataJsonl(dataPath);
      if (workflowNameFilter !== null && workflowName !== workflowNameFilter) {
        continue;
      }
      out.push({ threadId, hash, workflowName });
    }
  }

  out.sort((a, b) => {
    const ha = `${a.hash}/${a.threadId}`;
    const hb = `${b.hash}/${b.threadId}`;
    return ha.localeCompare(hb);
  });

  return out;
}

export async function resolveThreadDataPath(
  storageRoot: string,
  threadId: string,
): Promise<string | null> {
  const logsRoot = join(storageRoot, "logs");
  if (!(await pathExists(logsRoot))) {
    return null;
  }
  const hashes = await readdir(logsRoot);
  for (const hash of hashes) {
    const candidate = join(logsRoot, hash, `${threadId}.data.jsonl`);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }
  return null;
}
