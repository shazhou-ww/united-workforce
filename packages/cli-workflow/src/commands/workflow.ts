import { readFile } from "node:fs/promises";

import type { JSONSchema } from "@uncaged/json-cas";
import { putSchema, validate } from "@uncaged/json-cas";
import type { CasRef, RoleDefinition, WorkflowPayload } from "@uncaged/workflow-protocol";
import { parse } from "yaml";

import {
  createUwfStore,
  findRegistryName,
  loadWorkflowRegistry,
  resolveWorkflowHash,
  saveWorkflowRegistry,
  type UwfStore,
} from "../store.js";
import { parseWorkflowPayload } from "../validate.js";

export type WorkflowListEntry = {
  name: string;
  hash: CasRef;
};

export type WorkflowPutOutput = {
  name: string;
  hash: CasRef;
};

export type WorkflowShowOutput = {
  hash: CasRef;
  name: string | null;
  type: CasRef;
  payload: WorkflowPayload;
  timestamp: number;
};

function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function isJsonSchema(value: unknown): value is JSONSchema {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function resolveMetaRef(
  uwf: UwfStore,
  roleName: string,
  meta: unknown,
): Promise<CasRef> {
  if (!isJsonSchema(meta)) {
    fail(`role "${roleName}": meta must be a JSON Schema object`);
  }
  const schema: JSONSchema = meta.title === undefined
    ? { ...meta, title: roleName }
    : meta;
  return putSchema(uwf.store, schema);
}

async function materializeWorkflowPayload(
  uwf: UwfStore,
  raw: WorkflowPayload,
): Promise<WorkflowPayload> {
  const roles: Record<string, RoleDefinition> = {};
  for (const [roleName, role] of Object.entries(raw.roles)) {
    const meta = await resolveMetaRef(
      uwf,
      `${raw.name}.${roleName}`,
      role.meta,
    );
    roles[roleName] = {
      description: role.description,
      goal: role.goal,
      capabilities: role.capabilities,
      procedure: role.procedure,
      output: role.output,
      meta,
    };
  }
  return {
    name: raw.name,
    description: raw.description,
    roles,
    conditions: raw.conditions,
    graph: raw.graph,
  };
}

export async function cmdWorkflowPut(
  storageRoot: string,
  filePath: string,
): Promise<WorkflowPutOutput> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    fail(`file not found: ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = parse(text) as unknown;
  } catch (e) {
    fail(`invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }

  const payload = parseWorkflowPayload(raw);
  if (payload === null) {
    fail("invalid workflow YAML: expected WorkflowPayload shape");
  }

  const uwf = await createUwfStore(storageRoot);
  const materialized = await materializeWorkflowPayload(uwf, payload);

  const hash = await uwf.store.put(uwf.schemas.workflow, materialized);
  const node = uwf.store.get(hash);
  if (node === null || !validate(uwf.store, node)) {
    fail("stored workflow failed schema validation");
  }

  const registry = await loadWorkflowRegistry(storageRoot);
  registry[materialized.name] = hash;
  await saveWorkflowRegistry(storageRoot, registry);

  return { name: materialized.name, hash };
}

export async function cmdWorkflowShow(
  storageRoot: string,
  id: string,
): Promise<WorkflowShowOutput> {
  const uwf = await createUwfStore(storageRoot);
  const registry = await loadWorkflowRegistry(storageRoot);
  const hash = resolveWorkflowHash(registry, id);

  const node = uwf.store.get(hash);
  if (node === null) {
    fail(`CAS node not found: ${hash}`);
  }
  if (node.type !== uwf.schemas.workflow) {
    fail(`node ${hash} is not a Workflow (type ${node.type})`);
  }

  const payload = node.payload as WorkflowPayload;
  return {
    hash,
    name: findRegistryName(registry, hash),
    type: node.type,
    payload,
    timestamp: node.timestamp,
  };
}

export async function cmdWorkflowList(storageRoot: string): Promise<WorkflowListEntry[]> {
  const registry = await loadWorkflowRegistry(storageRoot);
  return Object.entries(registry).map(([name, hash]) => ({ name, hash }));
}
