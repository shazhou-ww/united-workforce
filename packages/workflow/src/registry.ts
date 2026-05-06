import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { parseDocument, stringify } from "yaml";

import { normalizeWorkflowRegistryRoot } from "./registry-normalize.js";
import type {
  WorkflowHistoryEntry,
  WorkflowRegistryEntry,
  WorkflowRegistryFile,
} from "./registry-types.js";
import { err, ok, type Result } from "./result.js";

export type {
  WorkflowHistoryEntry,
  WorkflowRegistryEntry,
  WorkflowRegistryFile,
} from "./registry-types.js";

export function workflowRegistryPath(storageRoot: string): string {
  return join(storageRoot, "workflow.yaml");
}

function emptyRegistry(): WorkflowRegistryFile {
  return { workflows: {} };
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
  return normalizeWorkflowRegistryRoot(doc);
}

export function stringifyWorkflowRegistryYaml(registry: WorkflowRegistryFile): string {
  return `${stringify(registry, { indent: 2, defaultStringType: "QUOTE_DOUBLE" })}\n`;
}

export async function readWorkflowRegistry(
  storageRoot: string,
): Promise<Result<WorkflowRegistryFile, Error>> {
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
