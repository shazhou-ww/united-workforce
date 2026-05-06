import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseDocument, stringify } from "yaml";

import { err, ok, type Result } from "./result.js";

export type WorkflowHistoryEntry = {
  hash: string;
  timestamp: number;
};

export type WorkflowRegistryEntry = {
  hash: string;
  timestamp: number;
  history: WorkflowHistoryEntry[];
};

export type WorkflowRegistryFile = {
  workflows: Record<string, WorkflowRegistryEntry>;
};

export function workflowRegistryPath(storageRoot: string): string {
  return join(storageRoot, "workflow.yaml");
}

function emptyRegistry(): WorkflowRegistryFile {
  return { workflows: {} };
}

function normalizeRegistry(raw: unknown): Result<WorkflowRegistryFile, Error> {
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
    if (entryRaw === null || typeof entryRaw !== "object") {
      return err(new Error(`workflow "${name}" must be a mapping`));
    }
    const e = entryRaw as Record<string, unknown>;
    const hash = e.hash;
    const timestamp = e.timestamp;
    const historyRaw = e.history;
    if (typeof hash !== "string") {
      return err(new Error(`workflow "${name}" must have a string hash`));
    }
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) {
      return err(new Error(`workflow "${name}" must have a finite numeric timestamp`));
    }
    if (!Array.isArray(historyRaw)) {
      return err(new Error(`workflow "${name}" must have a history array`));
    }
    const history: WorkflowHistoryEntry[] = [];
    for (let i = 0; i < historyRaw.length; i++) {
      const h = historyRaw[i];
      if (h === null || typeof h !== "object") {
        return err(new Error(`workflow "${name}" history[${i}] must be a mapping`));
      }
      const he = h as Record<string, unknown>;
      if (typeof he.hash !== "string" || typeof he.timestamp !== "number" || !Number.isFinite(he.timestamp)) {
        return err(new Error(`workflow "${name}" history[${i}] must have hash and timestamp`));
      }
      history.push({ hash: he.hash, timestamp: he.timestamp });
    }
    workflows[name] = { hash, timestamp, history };
  }
  return ok({ workflows });
}

export function parseWorkflowRegistryYaml(text: string): Result<WorkflowRegistryFile, Error> {
  if (text.trim() === "") {
    return ok(emptyRegistry());
  }
  let doc: unknown;
  try {
    doc = parseDocument(text).toJSON();
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
  return normalizeRegistry(doc);
}

export function stringifyWorkflowRegistryYaml(registry: WorkflowRegistryFile): string {
  return `${stringify(registry, { indent: 2 })}\n`;
}

export async function readWorkflowRegistry(storageRoot: string): Promise<Result<WorkflowRegistryFile, Error>> {
  const path = workflowRegistryPath(storageRoot);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code === "ENOENT") {
      return ok(emptyRegistry());
    }
    return err(errObj instanceof Error ? errObj : new Error(String(e)));
  }
  return parseWorkflowRegistryYaml(text);
}

export async function writeWorkflowRegistry(
  storageRoot: string,
  registry: WorkflowRegistryFile,
): Promise<Result<void, Error>> {
  const path = workflowRegistryPath(storageRoot);
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, stringifyWorkflowRegistryYaml(registry), "utf8");
  } catch (e) {
    return err(e instanceof Error ? e : new Error(String(e)));
  }
  return ok(undefined);
}

export function listRegisteredWorkflowNames(registry: WorkflowRegistryFile): string[] {
  return Object.keys(registry.workflows).sort();
}

export function getRegisteredWorkflow(
  registry: WorkflowRegistryFile,
  name: string,
): WorkflowRegistryEntry | null {
  const entry = registry.workflows[name];
  if (entry === undefined) {
    return null;
  }
  return entry;
}

/** Register or upgrade a workflow version, moving the previous head into `history`. */
export function registerWorkflowVersion(
  registry: WorkflowRegistryFile,
  name: string,
  hash: string,
  timestamp: number,
): WorkflowRegistryFile {
  const prev = registry.workflows[name];
  const baseHistory = prev === undefined ? [] : prev.history;
  const history: WorkflowHistoryEntry[] =
    prev === undefined
      ? baseHistory
      : [{ hash: prev.hash, timestamp: prev.timestamp }, ...baseHistory];
  const next: WorkflowRegistryEntry = { hash, timestamp, history };
  return {
    workflows: { ...registry.workflows, [name]: next },
  };
}

export function unregisterWorkflow(
  registry: WorkflowRegistryFile,
  name: string,
): Result<WorkflowRegistryFile, Error> {
  if (registry.workflows[name] === undefined) {
    return err(new Error(`workflow not registered: ${name}`));
  }
  const { [name]: _removed, ...rest } = registry.workflows;
  return ok({ workflows: rest });
}
