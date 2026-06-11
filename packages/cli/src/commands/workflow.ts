import { access, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve as resolvePath } from "node:path";

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

/**
 * Check if a workflow file exists at the given path.
 */
async function workflowFileExists(dir: string, name: string, ext: string): Promise<string | null> {
  const candidate = resolvePath(dir, `${name}${ext}`);
  try {
    await access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Search for a workflow file in a given directory (checks both .workflows/ and .workflow/).
 * `.workflows/` (primary) takes priority over `.workflow/` (legacy fallback).
 */
async function findWorkflowInDir(dir: string, name: string): Promise<string | null> {
  // Check .workflows/ directory first (primary)
  for (const ext of [".yaml", ".yml"]) {
    const result = await workflowFileExists(resolvePath(dir, ".workflows"), name, ext);
    if (result !== null) {
      return result;
    }
  }
  for (const indexName of ["index.yaml", "index.yml"]) {
    const candidate = resolvePath(dir, ".workflows", name, indexName);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* not found */
    }
  }

  // Check .workflow/ directory as fallback (legacy)
  for (const ext of [".yaml", ".yml"]) {
    const result = await workflowFileExists(resolvePath(dir, ".workflow"), name, ext);
    if (result !== null) {
      return result;
    }
  }
  for (const indexName of ["index.yaml", "index.yml"]) {
    const candidate = resolvePath(dir, ".workflow", name, indexName);
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* not found */
    }
  }

  return null;
}

/** Check if a directory contains a .git marker (directory or file). */
async function hasGitMarker(dir: string): Promise<boolean> {
  try {
    await access(join(dir, ".git"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Traverse parent directories looking for a workflow named `name` under
 * `.workflows/` (primary) or `.workflow/` (legacy fallback). Within each
 * directory the lookup checks flat YAML files (`<name>.yaml`/`.yml`) and
 * folder-based layouts (`<name>/index.yaml`/`.yml`).
 * Returns the absolute path if found, otherwise null.
 * Stops at filesystem root or .git directory.
 */
async function findWorkflowInParents(startDir: string, name: string): Promise<string | null> {
  let currentDir = resolvePath(startDir);
  const root = resolvePath("/");

  while (true) {
    const found = await findWorkflowInDir(currentDir, name);
    if (found !== null) {
      return found;
    }

    // Stop at .git boundary (repo root)
    if (await hasGitMarker(currentDir)) {
      break;
    }

    // Stop at filesystem root
    if (currentDir === root) {
      break;
    }

    // Move to parent directory
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) {
      // Reached filesystem root
      break;
    }
    currentDir = parentDir;
  }

  return null;
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

  // Strategy 3: Local discovery (parent directory traversal)
  const localPath = await findWorkflowInParents(projectRoot, trimmed);
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
