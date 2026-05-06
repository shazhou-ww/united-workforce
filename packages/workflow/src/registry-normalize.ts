import type {
  WorkflowHistoryEntry,
  WorkflowRegistryEntry,
  WorkflowRegistryFile,
} from "./registry-types.js";
import { err, ok, type Result } from "./result.js";

export function normalizeWorkflowHistoryEntry(
  workflowName: string,
  index: number,
  raw: unknown,
): Result<WorkflowHistoryEntry, Error> {
  if (raw === null || typeof raw !== "object") {
    return err(new Error(`workflow "${workflowName}" history[${index}] must be a mapping`));
  }
  const he = raw as Record<string, unknown>;
  const hash = he.hash;
  const timestamp = he.timestamp;
  if (typeof hash !== "string" || typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return err(
      new Error(`workflow "${workflowName}" history[${index}] must have hash and timestamp`),
    );
  }
  return ok({ hash, timestamp });
}

export function normalizeWorkflowRegistryEntry(
  workflowName: string,
  raw: unknown,
): Result<WorkflowRegistryEntry, Error> {
  if (raw === null || typeof raw !== "object") {
    return err(new Error(`workflow "${workflowName}" must be a mapping`));
  }
  const e = raw as Record<string, unknown>;
  const hash = e.hash;
  const timestamp = e.timestamp;
  const historyRaw = e.history;
  if (typeof hash !== "string") {
    return err(new Error(`workflow "${workflowName}" must have a string hash`));
  }
  if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
    return err(new Error(`workflow "${workflowName}" must have a finite numeric timestamp`));
  }
  if (!Array.isArray(historyRaw)) {
    return err(new Error(`workflow "${workflowName}" must have a history array`));
  }
  const history: WorkflowHistoryEntry[] = [];
  for (let i = 0; i < historyRaw.length; i++) {
    const item = historyRaw[i];
    const next = normalizeWorkflowHistoryEntry(workflowName, i, item);
    if (!next.ok) {
      return next;
    }
    history.push(next.value);
  }
  return ok({ hash, timestamp, history });
}

export function normalizeWorkflowRegistryRoot(raw: unknown): Result<WorkflowRegistryFile, Error> {
  if (raw === null || typeof raw !== "object") {
    return err(new Error("registry root must be a mapping"));
  }
  const root = raw as Record<string, unknown>;
  const workflowsRaw = root.workflows;
  if (workflowsRaw === null || workflowsRaw === undefined || typeof workflowsRaw !== "object") {
    return err(new Error('registry must contain a "workflows" mapping'));
  }
  const workflows: Record<string, WorkflowRegistryEntry> = {};
  for (const [name, entryRaw] of Object.entries(workflowsRaw)) {
    const entryResult = normalizeWorkflowRegistryEntry(name, entryRaw);
    if (!entryResult.ok) {
      return entryResult;
    }
    workflows[name] = entryResult.value;
  }
  return ok({ workflows });
}
