import type { WorkflowPayload } from "@united-workforce/protocol";

type SchemaObj = Record<string, unknown>;

const RESERVED_NAMES = new Set(["$START", "$END", "$SUSPEND"]);
const PSEUDO_TARGETS = new Set(["$END", "$SUSPEND"]);

/** Extract mustache variable names from a prompt string. */
function extractMustacheVars(prompt: string): string[] {
  const vars: string[] = [];
  const re = /\{\{\{?([^}]+)\}\}\}?/g;
  let m: RegExpExecArray | null = re.exec(prompt);
  while (m !== null) {
    vars.push(m[1]);
    m = re.exec(prompt);
  }
  return vars;
}

/** Check if a frontmatter schema is a oneOf (multi-exit) type. */
function isOneOfSchema(fm: unknown): fm is SchemaObj & { oneOf: SchemaObj[] } {
  if (typeof fm !== "object" || fm === null) return false;
  const obj = fm as SchemaObj;
  return Array.isArray(obj.oneOf);
}

/** Check if a frontmatter schema declares "$status" as an enum (the required form for user roles). */
function hasStatusEnum(fm: unknown): boolean {
  if (typeof fm !== "object" || fm === null) return false;
  const obj = fm as SchemaObj;
  const props = obj.properties as Record<string, SchemaObj> | undefined;
  if (!props?.$status) return false;
  return Array.isArray(props.$status.enum);
}

/** Extract status values from an enum-based $status field. */
function getEnumStatuses(fm: SchemaObj): string[] {
  const props = fm.properties as Record<string, SchemaObj> | undefined;
  if (!props?.$status) return [];
  const statusDef = props.$status;
  if (!Array.isArray(statusDef.enum)) return [];
  return statusDef.enum as string[];
}

/** Get property names from a schema object. */
function getPropertyNames(schema: SchemaObj): Set<string> {
  const props = schema.properties;
  if (typeof props !== "object" || props === null) return new Set();
  return new Set(Object.keys(props as Record<string, unknown>));
}

/** Extract $status const values from oneOf variants. */
function getOneOfStatuses(variants: SchemaObj[]): string[] {
  const statuses: string[] = [];
  for (const variant of variants) {
    const props = variant.properties as Record<string, SchemaObj> | undefined;
    if (props?.$status) {
      const statusDef = props.$status;
      if (typeof statusDef.const === "string") {
        statuses.push(statusDef.const);
      }
    }
  }
  return statuses;
}

/** Check reserved names and role/graph reference integrity. */
function checkRoleReferences(payload: WorkflowPayload, errors: string[]): void {
  const roleNames = new Set(Object.keys(payload.roles));
  const graphNodes = new Set(Object.keys(payload.graph));

  for (const name of roleNames) {
    if (RESERVED_NAMES.has(name)) {
      errors.push(`reserved name "${name}" must not appear in roles`);
    }
  }

  for (const node of graphNodes) {
    if (!RESERVED_NAMES.has(node) && !roleNames.has(node)) {
      errors.push(`graph references unknown role "${node}"`);
    }
  }

  for (const name of roleNames) {
    if (RESERVED_NAMES.has(name)) continue;
    if (!graphNodes.has(name)) {
      errors.push(`role "${name}" is defined but not referenced in graph`);
    }
  }
}

/** Check $START/$END constraints, edge targets, and reachability. */
function checkGraphStructure(payload: WorkflowPayload, errors: string[]): void {
  const roleNames = new Set(Object.keys(payload.roles));
  const graphNodes = new Set(Object.keys(payload.graph));

  if (!graphNodes.has("$START")) {
    errors.push("$START must be defined in graph");
  } else {
    const startKeys = new Set(Object.keys(payload.graph.$START));
    if (!startKeys.has("new") || !startKeys.has("resume")) {
      errors.push('$START must have edges with statuses "new" and "resume"');
    }
  }

  if (graphNodes.has("$END")) {
    errors.push("$END must not have outgoing edges");
  }

  if (graphNodes.has("$SUSPEND")) {
    errors.push("$SUSPEND must not have outgoing edges");
  }

  for (const [node, statusMap] of Object.entries(payload.graph)) {
    for (const [status, target] of Object.entries(statusMap)) {
      if (!PSEUDO_TARGETS.has(target.role) && !roleNames.has(target.role)) {
        errors.push(`edge ${node}→${status}: unknown target role "${target.role}"`);
      }
    }
  }

  checkReachability(roleNames, collectReachableRoles(payload.graph), errors);
}

/** BFS to collect all roles reachable from $START. */
function collectReachableRoles(graph: WorkflowPayload["graph"]): Set<string> {
  const reachable = new Set<string>();
  const startEdges = graph.$START;
  if (!startEdges) return reachable;

  const queue: string[] = [];
  for (const target of Object.values(startEdges)) {
    if (!PSEUDO_TARGETS.has(target.role) && !reachable.has(target.role)) {
      reachable.add(target.role);
      queue.push(target.role);
    }
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const edges = graph[current];
    if (!edges) continue;
    for (const target of Object.values(edges)) {
      if (!PSEUDO_TARGETS.has(target.role) && !reachable.has(target.role)) {
        reachable.add(target.role);
        queue.push(target.role);
      }
    }
  }

  return reachable;
}

/** Check that all defined roles are reachable from $START. */
function checkReachability(roleNames: Set<string>, reachable: Set<string>, errors: string[]): void {
  for (const name of roleNames) {
    if (RESERVED_NAMES.has(name)) continue;
    if (!reachable.has(name)) {
      errors.push(`role "${name}" is not reachable from $START`);
    }
  }
}

/** Check oneOf discriminant validity for a role. */
function checkOneOfDiscriminant(
  roleName: string,
  variants: SchemaObj[],
  statuses: string[],
  errors: string[],
): void {
  if (statuses.length === variants.length) return;

  let foundMissing = false;
  for (const variant of variants) {
    const props = variant.properties as Record<string, SchemaObj> | undefined;
    if (!props?.$status) {
      errors.push(`role "${roleName}": oneOf variants must have "$status" as const discriminant`);
      foundMissing = true;
      break;
    }
    if (typeof props.$status.const !== "string") {
      errors.push(`role "${roleName}": oneOf variant $status must be a const value`);
      foundMissing = true;
      break;
    }
  }

  if (!foundMissing) {
    errors.push(`role "${roleName}": oneOf variant $status must be a const value`);
  }
}

/** Check status-edge consistency for a user role. */
function checkStatusEdges(
  roleName: string,
  graphKeys: Set<string>,
  statusSet: Set<string>,
  errors: string[],
): void {
  const extraKeys = [...graphKeys].filter((k) => !statusSet.has(k));
  const missingKeys = [...statusSet].filter((k) => !graphKeys.has(k));
  if (extraKeys.length > 0) {
    errors.push(`role "${roleName}" graph has extra status keys: ${extraKeys.join(", ")}`);
  }
  if (missingKeys.length > 0) {
    errors.push(`role "${roleName}" graph is missing status keys: ${missingKeys.join(", ")}`);
  }
}

/** Check mustache variables for multi-exit role. */
function checkMultiExitMustache(
  roleName: string,
  graphEntry: Record<string, { role: string; prompt: string }>,
  variants: SchemaObj[],
  errors: string[],
): void {
  for (const [status, target] of Object.entries(graphEntry)) {
    const vars = extractMustacheVars(target.prompt);
    const variant = variants.find((v) => {
      const props = v.properties as Record<string, SchemaObj> | undefined;
      return props?.$status?.const === status;
    });
    if (!variant) continue;
    const propNames = getPropertyNames(variant);
    for (const v of vars) {
      if (v === "$status") continue;
      if (!propNames.has(v)) {
        errors.push(`prompt variable "${v}" not found in role "${roleName}" variant "${status}"`);
      }
    }
  }
}

/** Check status-edge consistency and mustache for each role. */
function checkRoleConsistency(payload: WorkflowPayload, errors: string[]): void {
  for (const [roleName, role] of Object.entries(payload.roles)) {
    if (RESERVED_NAMES.has(roleName)) continue;
    const graphEntry = payload.graph[roleName];
    if (!graphEntry) continue;

    const fm = role.frontmatter as unknown;
    const graphKeys = new Set(Object.keys(graphEntry));

    if (isOneOfSchema(fm)) {
      const variants = fm.oneOf as SchemaObj[];
      const statuses = getOneOfStatuses(variants);

      checkOneOfDiscriminant(roleName, variants, statuses, errors);
      checkStatusEdges(roleName, graphKeys, new Set(statuses), errors);
      checkMultiExitMustache(roleName, graphEntry, variants, errors);
    } else if (hasStatusEnum(fm)) {
      const statuses = getEnumStatuses(fm as SchemaObj);
      checkStatusEdges(roleName, graphKeys, new Set(statuses), errors);
      // For enum-based schemas, mustache vars come from the flat properties
      checkEnumMustache(roleName, graphEntry, fm as SchemaObj, errors);
    } else {
      errors.push(
        `role "${roleName}" must define "$status" as an enum (or oneOf const) in frontmatter`,
      );
    }
  }
}

/** Check mustache vars in all edge prompts against flat schema properties. */
function checkEnumMustache(
  roleName: string,
  graphEntry: Record<string, { role: string; prompt: string }>,
  fm: SchemaObj,
  errors: string[],
): void {
  const propNames = getPropertyNames(fm);
  for (const [status, target] of Object.entries(graphEntry)) {
    const vars = extractMustacheVars(target.prompt);
    for (const v of vars) {
      if (v === "$status") continue;
      if (!propNames.has(v)) {
        errors.push(
          `prompt variable "${v}" in graph[${roleName}][${status}] not found in role "${roleName}" frontmatter`,
        );
      }
    }
  }
}

/**
 * Validate a parsed WorkflowPayload for semantic correctness.
 * Returns an array of error messages. Empty array = valid.
 */
export function validateWorkflow(payload: WorkflowPayload): string[] {
  const errors: string[] = [];
  checkRoleReferences(payload, errors);
  checkGraphStructure(payload, errors);
  checkRoleConsistency(payload, errors);
  return errors;
}
