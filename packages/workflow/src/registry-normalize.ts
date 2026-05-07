import type {
  ExtractProviderConfig,
  WorkflowConfig,
  WorkflowHistoryEntry,
  WorkflowRegistryEntry,
  WorkflowRegistryFile,
} from "./registry-types.js";
import { err, ok, type Result } from "./result.js";

function resolveRegistryApiKey(raw: string): Result<string, Error> {
  if (raw.startsWith("env:")) {
    const name = raw.slice("env:".length);
    if (name === "") {
      return err(new Error('config.extract.apiKey "env:" reference must name a variable'));
    }
    const value = process.env[name];
    if (value === undefined) {
      return err(new Error(`config.extract.apiKey: environment variable "${name}" is not set`));
    }
    return ok(value);
  }
  return ok(raw);
}

function normalizeExtractProviderConfig(raw: unknown): Result<ExtractProviderConfig, Error> {
  if (raw === null || typeof raw !== "object") {
    return err(new Error('registry config must contain an "extract" mapping'));
  }
  const e = raw as Record<string, unknown>;
  const baseUrl = e.baseUrl;
  const model = e.model;
  const apiKeyRaw = e.apiKey;
  if (typeof baseUrl !== "string" || baseUrl === "") {
    return err(new Error("config.extract.baseUrl must be a non-empty string"));
  }
  if (typeof model !== "string" || model === "") {
    return err(new Error("config.extract.model must be a non-empty string"));
  }
  if (typeof apiKeyRaw !== "string" || apiKeyRaw === "") {
    return err(new Error("config.extract.apiKey must be a non-empty string"));
  }
  const apiKeyResult = resolveRegistryApiKey(apiKeyRaw);
  if (!apiKeyResult.ok) {
    return apiKeyResult;
  }
  return ok({ baseUrl, model, apiKey: apiKeyResult.value });
}

function normalizeWorkflowConfig(raw: unknown): Result<WorkflowConfig, Error> {
  if (raw === null || typeof raw !== "object") {
    return err(new Error('registry "config" must be a mapping'));
  }
  const c = raw as Record<string, unknown>;
  const maxDepth = c.maxDepth;
  const extractRaw = c.extract;
  if (typeof maxDepth !== "number" || !Number.isInteger(maxDepth) || maxDepth < 0) {
    return err(new Error("config.maxDepth must be a non-negative integer"));
  }
  const extractResult = normalizeExtractProviderConfig(extractRaw);
  if (!extractResult.ok) {
    return extractResult;
  }
  return ok({ maxDepth, extract: extractResult.value });
}

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
  const configRaw = root.config;
  let config: WorkflowConfig | null = null;
  if (configRaw !== undefined && configRaw !== null) {
    const configResult = normalizeWorkflowConfig(configRaw);
    if (!configResult.ok) {
      return configResult;
    }
    config = configResult.value;
  }
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
  return ok({ config, workflows });
}
