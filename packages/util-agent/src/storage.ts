import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { bootstrap, type Store } from "@ocas/core";
import { createFsStore, createSqliteVarStore } from "@ocas/fs";
import type {
  AgentAlias,
  AgentConfig,
  CasRef,
  ThreadId,
  ThreadIndexEntry,
  WorkflowConfig,
  WorkflowName,
} from "@united-workforce/protocol";
import { parse } from "yaml";

import { registerAgentSchemas } from "./schemas.js";

/** Default filesystem root for uwf data (`~/.uwf`). */
export function getDefaultStorageRoot(): string {
  return join(homedir(), ".uwf");
}

/**
 * Resolve storage root from an explicit override (e.g. the `UWF_HOME` value
 * read by the CLI entry point).  Library code must not read `process.env`.
 */
export function resolveStorageRoot(override: string | null): string {
  if (override !== null && override !== "") {
    return override;
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

const THREAD_VAR_PREFIX = "@uwf/thread/";

/**
 * Resolve the global CAS directory from an explicit override (e.g. the
 * `OCAS_HOME` value read by the CLI entry point).  Library code must not read
 * `process.env`.  Defaults to `~/.ocas`.
 */
export function getGlobalCasDir(override: string | null): string {
  if (override !== null && override !== "") {
    return override;
  }
  return join(homedir(), ".ocas");
}

function threadVarName(threadId: ThreadId): string {
  return `${THREAD_VAR_PREFIX}${threadId}`;
}

/** Read active thread head + suspend metadata from ocas variable store. */
export async function getActiveThreadEntry(
  casDir: string,
  threadId: ThreadId,
): Promise<ThreadIndexEntry | null> {
  const cas = createFsStore(casDir);
  const { var: varStore } = createSqliteVarStore(join(casDir, "vars"), cas);
  const vars = varStore.list({ exactName: threadVarName(threadId) });
  const v = vars[0];
  if (v === undefined) {
    return null;
  }
  return {
    head: v.value as CasRef,
    status: (v.tags.status ?? "idle") as ThreadIndexEntry["status"],
    suspendedRole: v.tags.suspendedRole ?? null,
    suspendMessage: v.tags.suspendMessage ?? null,
    completedAt: v.tags.completedAt !== undefined ? Number(v.tags.completedAt) : null,
  };
}

export type AgentStore = {
  storageRoot: string;
  store: Store;
  schemas: Awaited<ReturnType<typeof registerAgentSchemas>>;
};

export async function createAgentStore(storageRoot: string, casDir: string): Promise<AgentStore> {
  const cas = createFsStore(casDir);
  const { var: varSub, tag } = createSqliteVarStore(join(casDir, "vars"), cas);
  const store: Store = { cas, var: varSub, tag };
  bootstrap(store);
  const schemas = await registerAgentSchemas(store);
  return { storageRoot, store, schemas };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeAgents(raw: unknown): Record<AgentAlias, AgentConfig> {
  if (raw === undefined || raw === null) {
    return {};
  }
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

/**
 * Normalize raw config into the engine-only WorkflowConfig shape.
 *
 * Engine config is LLM-free — providers/models/defaultModel/modelOverrides are
 * silently ignored if present (legacy compatibility). Each adapter is
 * responsible for loading its own LLM configuration.
 */
export function normalizeWorkflowConfig(raw: unknown): WorkflowConfig {
  if (!isRecord(raw)) {
    throw new Error("config.yaml root must be a mapping");
  }
  const defaultAgent = raw.defaultAgent;
  if (typeof defaultAgent !== "string") {
    throw new Error("config requires defaultAgent");
  }
  const agents = normalizeAgents(raw.agents);
  if (!(defaultAgent in agents)) {
    const available = Object.keys(agents);
    throw new Error(
      available.length === 0
        ? `config.defaultAgent is "${defaultAgent}" but config.agents is empty — define at least the default agent`
        : `config.defaultAgent "${defaultAgent}" not found in config.agents (available: ${available.join(", ")})`,
    );
  }
  return {
    agents,
    defaultAgent,
    agentOverrides: normalizeAgentOverrides(raw.agentOverrides),
  };
}

export async function loadWorkflowConfig(storageRoot: string): Promise<WorkflowConfig> {
  const path = getConfigPath(storageRoot);
  const text = await readFile(path, "utf8");
  const raw = parse(text) as unknown;
  return normalizeWorkflowConfig(raw);
}
