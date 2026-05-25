import { readFile } from "node:fs/promises";

import type { JSONSchema } from "@uncaged/json-cas";
import { putSchema, validate } from "@uncaged/json-cas";
import type { CasRef, RoleDefinition, Target, WorkflowPayload } from "@uncaged/workflow-protocol";
import { parse } from "yaml";

import {
  createUwfStore,
  discoverProjectWorkflows,
  findRegistryName,
  loadWorkflowRegistry,
  resolveWorkflowHash,
  saveWorkflowRegistry,
  type UwfStore,
} from "../store.js";
import { checkWorkflowFilenameConsistency, parseWorkflowPayload } from "../validate.js";
import { validateWorkflow } from "../validate-semantic.js";

export type WorkflowOrigin = "local" | "global";

export type WorkflowListEntry = {
  name: string;
  hash: CasRef;
  origin: WorkflowOrigin;
};

export type WorkflowAddOutput = {
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

/** Normalize graph: validate each status → target mapping. */
function normalizeGraph(
  graph: Record<string, Record<string, Target>>,
): Record<string, Record<string, Target>> {
  const result: Record<string, Record<string, Target>> = {};
  for (const [node, statusMap] of Object.entries(graph)) {
    const normalized: Record<string, Target> = {};
    for (const [status, target] of Object.entries(statusMap)) {
      if (typeof target.prompt !== "string" || target.prompt.trim() === "") {
        fail(`graph[${node}][${status}] → "${target.role}": prompt is required (non-empty string)`);
      }
      normalized[status] = {
        role: target.role,
        prompt: target.prompt,
      };
    }
    result[node] = normalized;
  }
  return result;
}

async function resolveFrontmatterRef(
  uwf: UwfStore,
  roleName: string,
  frontmatter: unknown,
): Promise<CasRef> {
  if (!isJsonSchema(frontmatter)) {
    fail(`role "${roleName}": frontmatter must be a JSON Schema object`);
  }
  const schema: JSONSchema =
    frontmatter.title === undefined ? { ...frontmatter, title: roleName } : frontmatter;
  return putSchema(uwf.store, schema);
}

export async function materializeWorkflowPayload(
  uwf: UwfStore,
  raw: WorkflowPayload,
): Promise<WorkflowPayload> {
  const roles: Record<string, RoleDefinition> = {};
  for (const [roleName, role] of Object.entries(raw.roles)) {
    const frontmatter = await resolveFrontmatterRef(
      uwf,
      `${raw.name}.${roleName}`,
      role.frontmatter,
    );
    roles[roleName] = {
      description: role.description,
      goal: role.goal,
      capabilities: role.capabilities,
      procedure: role.procedure,
      output: role.output,
      frontmatter,
    };
  }
  return {
    name: raw.name,
    description: raw.description,
    roles,
    graph: normalizeGraph(raw.graph),
  };
}

export async function cmdWorkflowAdd(
  storageRoot: string,
  filePath: string,
): Promise<WorkflowAddOutput> {
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

  const filenameError = checkWorkflowFilenameConsistency(filePath, payload);
  if (filenameError !== null) {
    fail(filenameError);
  }

  const semanticErrors = validateWorkflow(payload);
  if (semanticErrors.length > 0) {
    fail(`workflow validation failed:\n${semanticErrors.map((e) => `  - ${e}`).join("\n")}`);
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

export async function cmdWorkflowList(
  storageRoot: string,
  projectRoot: string,
): Promise<WorkflowListEntry[]> {
  const localEntries = await discoverProjectWorkflows(projectRoot);
  const registry = await loadWorkflowRegistry(storageRoot);

  const result: WorkflowListEntry[] = [];
  const localNames = new Set<string>();

  for (const entry of localEntries) {
    localNames.add(entry.name);
    result.push({ name: entry.name, hash: "(local)", origin: "local" });
  }

  for (const [name, hash] of Object.entries(registry)) {
    if (!localNames.has(name)) {
      result.push({ name, hash, origin: "global" });
    }
  }

  return result;
}
