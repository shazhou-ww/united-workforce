import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve as resolvePath } from "node:path";

import type { JSONSchema } from "@ocas/core";
import { putSchema, validate } from "@ocas/core";
import type { CasRef, RoleDefinition, Target, WorkflowPayload } from "@united-workforce/protocol";
import { parse } from "yaml";
import { createIncludeTag } from "../include.js";

import {
  createUwfStore,
  discoverProjectWorkflows,
  findRegistryName,
  loadWorkflowRegistry,
  resolveProjectWorkflowFile,
  resolveWorkflowHash,
  saveWorkflowRegistry,
  type UwfStore,
} from "../store.js";
import { checkWorkflowFilenameConsistency, isCasRef, parseWorkflowPayload } from "../validate.js";
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
        location: target.location ?? null,
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

/**
 * Validate a workflow YAML file without registering it.
 *
 * CI-friendly: does not touch CAS or the workflow registry. On success,
 * returns silently (no stdout/stderr) and exits 0. On any error, writes a
 * single message to stderr and exits 1.
 */
export async function cmdWorkflowValidate(filePath: string): Promise<void> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    fail(`file not found: ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = parse(text, {
      customTags: [createIncludeTag(dirname(resolvePath(filePath)))],
    }) as unknown;
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
  // success: silent return
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
    raw = parse(text, {
      customTags: [createIncludeTag(dirname(resolvePath(filePath)))],
    }) as unknown;
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

  const hash = await uwf.store.cas.put(uwf.schemas.workflow, materialized);
  const node = uwf.store.cas.get(hash);
  if (node === null || !validate(uwf.store, node)) {
    fail("stored workflow failed schema validation");
  }

  saveWorkflowRegistry(uwf.varStore, materialized.name, hash);

  return { name: materialized.name, hash };
}

// ── workflow show resolution helpers ──────────────────────────────────────────

function isFilePath(input: string): boolean {
  return (
    input.includes("/") || input.includes("\\") || input.endsWith(".yaml") || input.endsWith(".yml")
  );
}

async function materializeLocalWorkflowForShow(uwf: UwfStore, filePath: string): Promise<CasRef> {
  let text: string;
  try {
    text = await readFile(filePath, "utf8");
  } catch {
    fail(`project workflow file not found: ${filePath}`);
  }

  let raw: unknown;
  try {
    raw = parse(text, { customTags: [createIncludeTag(dirname(filePath))] }) as unknown;
  } catch (e) {
    fail(`invalid YAML in ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const payload = parseWorkflowPayload(raw);
  if (payload === null) {
    fail(`invalid workflow YAML in ${filePath}: expected WorkflowPayload shape`);
  }

  const filenameError = checkWorkflowFilenameConsistency(filePath, payload);
  if (filenameError !== null) {
    fail(filenameError);
  }

  const semanticErrors = validateWorkflow(payload);
  if (semanticErrors.length > 0) {
    fail(`workflow validation failed:\n${semanticErrors.map((e) => `  - ${e}`).join("\n")}`);
  }

  const materialized = await materializeWorkflowPayload(uwf, payload);
  const hash = await uwf.store.cas.put(uwf.schemas.workflow, materialized);
  const stored = uwf.store.cas.get(hash);
  if (stored === null || !validate(uwf.store, stored)) {
    fail("stored local workflow failed schema validation");
  }

  return hash;
}

async function resolveWorkflowCasRefForShow(
  uwf: UwfStore,
  workflowId: string,
  projectRoot: string,
): Promise<CasRef> {
  // Validate input
  const trimmed = workflowId.trim();
  if (trimmed === "") {
    fail("workflow ID cannot be empty");
  }

  // Strategy 1: Direct CAS hash
  if (isCasRef(trimmed)) {
    const node = uwf.store.cas.get(trimmed);
    if (node === null) {
      fail(`CAS node not found: ${trimmed}`);
    }
    if (node.type !== uwf.schemas.workflow) {
      fail(`node ${trimmed} is not a Workflow (type ${node.type})`);
    }
    return trimmed;
  }

  // Strategy 2: Explicit file path (relative or absolute)
  if (isFilePath(trimmed)) {
    const absolutePath = isAbsolute(trimmed) ? trimmed : resolvePath(projectRoot, trimmed);
    return materializeLocalWorkflowForShow(uwf, absolutePath);
  }

  // Strategy 3: Local discovery (reuses discoverProjectWorkflows from store.ts)
  const localEntries = await discoverProjectWorkflows(projectRoot);
  const localPath = resolveProjectWorkflowFile(localEntries, trimmed);
  if (localPath !== null) {
    return materializeLocalWorkflowForShow(uwf, localPath);
  }

  // Strategy 4: Global registry fallback
  const registry = loadWorkflowRegistry(uwf.varStore);
  const hash = resolveWorkflowHash(registry, trimmed);
  if (!isCasRef(hash)) {
    fail(`workflow not found: ${trimmed}`);
  }
  const node = uwf.store.cas.get(hash);
  if (node === null) {
    fail(`CAS node not found: ${hash}`);
  }
  if (node.type !== uwf.schemas.workflow) {
    fail(`node ${hash} is not a Workflow (type ${node.type})`);
  }
  return hash;
}

export async function cmdWorkflowShow(
  storageRoot: string,
  id: string,
  projectRoot: string,
): Promise<WorkflowShowOutput> {
  const uwf = await createUwfStore(storageRoot);
  const hash = await resolveWorkflowCasRefForShow(uwf, id, projectRoot);

  const node = uwf.store.cas.get(hash);
  if (node === null) {
    fail(`CAS node not found: ${hash}`);
  }
  if (node.type !== uwf.schemas.workflow) {
    fail(`node ${hash} is not a Workflow (type ${node.type})`);
  }

  const payload = node.payload as WorkflowPayload;
  const registry = loadWorkflowRegistry(uwf.varStore);
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
  const uwf = await createUwfStore(storageRoot);
  const localEntries = await discoverProjectWorkflows(projectRoot);
  const registry = loadWorkflowRegistry(uwf.varStore);

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
