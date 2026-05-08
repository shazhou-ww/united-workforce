import type { ProviderConfig } from "../config/index.js";
import { err, ok, type Result } from "../util/index.js";
import type {
  WorkflowConfig,
  WorkflowHistoryEntry,
  WorkflowRegistryEntry,
  WorkflowRegistryFile,
} from "./types.js";

function resolveRegistryApiKey(raw: string, ctx: string): Result<string, Error> {
  if (raw.startsWith("env:")) {
    const name = raw.slice("env:".length);
    if (name === "") {
      return err(new Error(`${ctx}: "env:" apiKey reference must name a variable`));
    }
    const value = process.env[name];
    if (value === undefined) {
      return err(new Error(`${ctx}: environment variable "${name}" is not set`));
    }
    return ok(value);
  }
  return ok(raw);
}

function parseModelProviderRef(
  ref: string,
  ctx: string,
): Result<{ providerName: string; modelName: string }, Error> {
  const idx = ref.indexOf("/");
  if (idx <= 0 || idx === ref.length - 1) {
    return err(new Error(`${ctx}: expected providerName/modelName, got "${ref}"`));
  }
  const providerName = ref.slice(0, idx);
  const modelName = ref.slice(idx + 1);
  if (providerName === "" || modelName === "") {
    return err(new Error(`${ctx}: expected providerName/modelName, got "${ref}"`));
  }
  return ok({ providerName, modelName });
}

function normalizeProviderEntry(name: string, entryRaw: unknown): Result<ProviderConfig, Error> {
  if (name === "") {
    return err(new Error("config.providers must not contain an empty provider name"));
  }
  if (entryRaw === null || typeof entryRaw !== "object" || Array.isArray(entryRaw)) {
    return err(new Error(`config.providers.${name} must be a mapping`));
  }
  const e = entryRaw as Record<string, unknown>;
  const baseUrl = e.baseUrl;
  const apiKeyRaw = e.apiKey;
  if (typeof baseUrl !== "string" || baseUrl === "") {
    return err(new Error(`config.providers.${name}.baseUrl must be a non-empty string`));
  }
  if (typeof apiKeyRaw !== "string" || apiKeyRaw === "") {
    return err(new Error(`config.providers.${name}.apiKey must be a non-empty string`));
  }
  const apiKeyCtx = `config.providers.${name}.apiKey`;
  const apiKeyResult = resolveRegistryApiKey(apiKeyRaw, apiKeyCtx);
  if (!apiKeyResult.ok) {
    return apiKeyResult;
  }
  return ok({ baseUrl, apiKey: apiKeyResult.value });
}

function normalizeProviders(raw: unknown): Result<Record<string, ProviderConfig>, Error> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return err(new Error('registry config must contain a "providers" mapping'));
  }
  const root = raw as Record<string, unknown>;
  const providers: Record<string, ProviderConfig> = {};
  for (const [name, entryRaw] of Object.entries(root)) {
    const next = normalizeProviderEntry(name, entryRaw);
    if (!next.ok) {
      return next;
    }
    providers[name] = next.value;
  }
  return ok(providers);
}

function normalizeModels(
  raw: unknown,
  providers: Record<string, ProviderConfig>,
): Result<Record<string, string>, Error> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return err(new Error('registry config must contain a "models" mapping'));
  }
  const root = raw as Record<string, unknown>;
  const models: Record<string, string> = {};
  const providerKeys = new Set(Object.keys(providers));
  for (const [scene, refRaw] of Object.entries(root)) {
    if (scene === "") {
      return err(new Error("config.models must not contain an empty scene name"));
    }
    if (typeof refRaw !== "string" || refRaw === "") {
      return err(new Error(`config.models.${scene} must be a non-empty string (provider/model)`));
    }
    const ctx = `config.models.${scene}`;
    const parsed = parseModelProviderRef(refRaw, ctx);
    if (!parsed.ok) {
      return parsed;
    }
    if (!providerKeys.has(parsed.value.providerName)) {
      return err(
        new Error(
          `${ctx}: unknown provider "${parsed.value.providerName}" (not listed under config.providers)`,
        ),
      );
    }
    models[scene] = refRaw;
  }
  return ok(models);
}

function normalizeWorkflowConfig(raw: unknown): Result<WorkflowConfig, Error> {
  if (raw === null || typeof raw !== "object") {
    return err(new Error('registry "config" must be a mapping'));
  }
  const c = raw as Record<string, unknown>;
  const maxDepth = c.maxDepth;
  const providersRaw = c.providers;
  const modelsRaw = c.models;
  if (typeof maxDepth !== "number" || !Number.isInteger(maxDepth) || maxDepth < 0) {
    return err(new Error("config.maxDepth must be a non-negative integer"));
  }
  const providersResult = normalizeProviders(providersRaw);
  if (!providersResult.ok) {
    return providersResult;
  }
  const modelsResult = normalizeModels(modelsRaw, providersResult.value);
  if (!modelsResult.ok) {
    return modelsResult;
  }
  return ok({
    maxDepth,
    providers: providersResult.value,
    models: modelsResult.value,
  });
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
