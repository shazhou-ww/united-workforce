import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Store } from "@ocas/core";
import { createFsStore } from "@ocas/fs";
import type {
  AgentAlias,
  AgentConfig,
  ModelAlias,
  ModelConfig,
  ProviderAlias,
  ProviderConfig,
  Scenario,
  ThreadsIndex,
  WorkflowConfig,
  WorkflowName,
} from "@uncaged/workflow-protocol";
import { parseThreadsIndex } from "@uncaged/workflow-protocol";
import { parse } from "yaml";

import { registerAgentSchemas } from "./schemas.js";

/** Default filesystem root for uwf data (`~/.uncaged/workflow`). */
export function getDefaultStorageRoot(): string {
  return join(homedir(), ".uncaged", "workflow");
}

/**
 * Resolve storage root.
 * Priority: `UNCAGED_WORKFLOW_STORAGE_ROOT` → `WORKFLOW_STORAGE_ROOT` → default.
 */
export function resolveStorageRoot(): string {
  const internal = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
  if (internal !== undefined && internal !== "") {
    return internal;
  }
  const userOverride = process.env.WORKFLOW_STORAGE_ROOT;
  if (userOverride !== undefined && userOverride !== "") {
    return userOverride;
  }
  return getDefaultStorageRoot();
}

export function getCasDir(storageRoot: string): string {
  return join(storageRoot, "cas");
}

export function getConfigPath(storageRoot: string): string {
  return join(storageRoot, "config.yaml");
}

export function getEnvPath(storageRoot: string): string {
  return join(storageRoot, ".env");
}

export function getThreadsPath(storageRoot: string): string {
  return join(storageRoot, "threads.yaml");
}

export type AgentStore = {
  storageRoot: string;
  store: Store;
  schemas: Awaited<ReturnType<typeof registerAgentSchemas>>;
};

export async function createAgentStore(storageRoot: string): Promise<AgentStore> {
  const store = createFsStore(getCasDir(storageRoot));
  const schemas = await registerAgentSchemas(store);
  return { storageRoot, store, schemas };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeProviders(raw: unknown): Record<ProviderAlias, ProviderConfig> {
  if (!isRecord(raw)) {
    throw new Error("config.providers must be a mapping");
  }
  const providers: Record<ProviderAlias, ProviderConfig> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      throw new Error(`config.providers.${name} must be a mapping`);
    }
    const baseUrl = entry.baseUrl;
    const apiKey = entry.apiKey;
    if (typeof baseUrl !== "string" || typeof apiKey !== "string") {
      throw new Error(`config.providers.${name} requires baseUrl and apiKey`);
    }
    providers[name] = { baseUrl, apiKey };
  }
  return providers;
}

function normalizeModels(raw: unknown): Record<ModelAlias, ModelConfig> {
  if (!isRecord(raw)) {
    throw new Error("config.models must be a mapping");
  }
  const models: Record<ModelAlias, ModelConfig> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      throw new Error(`config.models.${name} must be a mapping`);
    }
    const provider = entry.provider;
    const modelName = entry.name;
    if (typeof provider !== "string" || typeof modelName !== "string") {
      throw new Error(`config.models.${name} requires provider and name`);
    }
    models[name] = { provider, name: modelName };
  }
  return models;
}

function normalizeAgents(raw: unknown): Record<AgentAlias, AgentConfig> {
  if (!isRecord(raw)) {
    throw new Error("config.agents must be a mapping");
  }
  const agents: Record<AgentAlias, AgentConfig> = {};
  for (const [name, entry] of Object.entries(raw)) {
    if (!isRecord(entry)) {
      throw new Error(`config.agents.${name} must be a mapping`);
    }
    const command = entry.command;
    const argsRaw = entry.args;
    if (typeof command !== "string") {
      throw new Error(`config.agents.${name} requires command`);
    }
    const args = Array.isArray(argsRaw)
      ? argsRaw.filter((a): a is string => typeof a === "string")
      : [];
    agents[name] = { command, args };
  }
  return agents;
}

function normalizeModelOverrides(raw: unknown): Record<Scenario, ModelAlias> | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (!isRecord(raw)) {
    throw new Error("config.modelOverrides must be a mapping or null");
  }
  const overrides: Record<Scenario, ModelAlias> = {};
  for (const [scene, alias] of Object.entries(raw)) {
    if (typeof alias === "string") {
      overrides[scene] = alias;
    }
  }
  return overrides;
}

function normalizeAgentOverrides(
  raw: unknown,
): Record<WorkflowName, Record<string, AgentAlias>> | null {
  if (raw === undefined || raw === null) {
    return null;
  }
  if (!isRecord(raw)) {
    throw new Error("config.agentOverrides must be a mapping or null");
  }
  const overrides: Record<WorkflowName, Record<string, AgentAlias>> = {};
  for (const [workflowName, rolesRaw] of Object.entries(raw)) {
    if (!isRecord(rolesRaw)) {
      continue;
    }
    const roles: Record<string, AgentAlias> = {};
    for (const [roleName, alias] of Object.entries(rolesRaw)) {
      if (typeof alias === "string") {
        roles[roleName] = alias;
      }
    }
    overrides[workflowName] = roles;
  }
  return overrides;
}

export function normalizeWorkflowConfig(raw: unknown): WorkflowConfig {
  if (!isRecord(raw)) {
    throw new Error("config.yaml root must be a mapping");
  }
  const defaultAgent = raw.defaultAgent;
  const defaultModel = raw.defaultModel;
  if (typeof defaultAgent !== "string" || typeof defaultModel !== "string") {
    throw new Error("config requires defaultAgent and defaultModel");
  }
  return {
    providers: normalizeProviders(raw.providers),
    models: normalizeModels(raw.models),
    agents: normalizeAgents(raw.agents),
    defaultAgent,
    agentOverrides: normalizeAgentOverrides(raw.agentOverrides),
    defaultModel,
    modelOverrides: normalizeModelOverrides(raw.modelOverrides),
  };
}

export async function loadWorkflowConfig(storageRoot: string): Promise<WorkflowConfig> {
  const path = getConfigPath(storageRoot);
  const text = await readFile(path, "utf8");
  const raw = parse(text) as unknown;
  return normalizeWorkflowConfig(raw);
}

export async function loadThreadsIndex(storageRoot: string): Promise<ThreadsIndex> {
  const path = getThreadsPath(storageRoot);
  try {
    const text = await readFile(path, "utf8");
    const raw = parse(text) as unknown;
    return parseThreadsIndex(raw);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      return {};
    }
    throw e;
  }
}
