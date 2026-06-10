import type { WorkflowPayload } from "@united-workforce/protocol";
import { Liquid } from "liquidjs";

type SchemaObj = Record<string, unknown>;

const RESERVED_NAMES = new Set(["$START", "$END", "$SUSPEND"]);
const PSEUDO_TARGETS = new Set(["$END"]);
const SUSPEND_TARGET = "$SUSPEND";

/** Check if a frontmatter schema is a oneOf (multi-exit) type. */
function isOneOfSchema(fm: unknown): fm is SchemaObj & { oneOf: SchemaObj[] } {
  if (typeof fm !== "object" || fm === null) return false;
  const obj = fm as SchemaObj;
  return Array.isArray(obj.oneOf);
}

/** Check if a frontmatter schema declares "$status" as const (flat schema form). */
function hasStatusConst(fm: unknown): boolean {
  if (typeof fm !== "object" || fm === null) return false;
  const obj = fm as SchemaObj;
  const props = obj.properties as Record<string, SchemaObj> | undefined;
  if (!props?.$status) return false;
  return typeof props.$status.const === "string";
}

/** Extract status values from a const-based $status field. */
function getConstStatuses(fm: SchemaObj): string[] {
  const props = fm.properties as Record<string, SchemaObj> | undefined;
  if (!props?.$status) return [];
  const statusDef = props.$status;
  if (typeof statusDef.const === "string") return [statusDef.const];
  return [];
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

/** Generate mock data from schema property names for template rendering. */
function generateMockData(schema: SchemaObj): Record<string, string> {
  const mock: Record<string, string> = {};
  const props = schema.properties as Record<string, SchemaObj> | undefined;
  if (!props) return mock;
  for (const key of Object.keys(props)) {
    mock[key] = `mock_${key}`;
  }
  return mock;
}

/**
 * Pre-process a template to replace `$`-prefixed variables (like `$status`)
 * which are invalid in LiquidJS syntax but always valid at runtime.
 * Replaces `{{ $varName }}` with a literal placeholder so the strict render
 * does not reject them.
 */
function sanitizeReservedVars(template: string): string {
  return template.replace(/\{\{\s*\$\w+\s*\}\}/g, "RESERVED");
}

/** Extract variable name from a LiquidJS UndefinedVariableError message. */
function extractVarName(err: unknown): string {
  const msg = String(err);
  const match = msg.match(/undefined variable: ([^,\s]+)/);
  return match ? match[1] : "unknown";
}

/** Validate edge templates using LiquidJS strict-render for a multi-exit role. */
function validateMultiExitTemplates(
  roleName: string,
  graphEntry: Record<string, { role: string; prompt: string }>,
  variants: SchemaObj[],
  errors: string[],
): void {
  const strictEngine = new Liquid({ strictVariables: true });

  for (const [status, target] of Object.entries(graphEntry)) {
    const variant = variants.find((v) => {
      const props = v.properties as Record<string, SchemaObj> | undefined;
      return props?.$status?.const === status;
    });
    if (!variant) continue;
    const mockData = generateMockData(variant);
    try {
      strictEngine.parseAndRenderSync(sanitizeReservedVars(target.prompt), mockData);
    } catch (err) {
      const varName = extractVarName(err);
      errors.push(
        `template variable "${varName}" not found in role "${roleName}" variant "${status}"`,
      );
    }
  }
}

/** Validate edge templates using LiquidJS strict-render for a flat schema. */
function validateFlatTemplates(
  roleName: string,
  graphEntry: Record<string, { role: string; prompt: string }>,
  fm: SchemaObj,
  errors: string[],
): void {
  const strictEngine = new Liquid({ strictVariables: true });
  const mockData = generateMockData(fm);

  for (const [status, target] of Object.entries(graphEntry)) {
    try {
      strictEngine.parseAndRenderSync(sanitizeReservedVars(target.prompt), mockData);
    } catch (err) {
      const varName = extractVarName(err);
      errors.push(
        `template variable "${varName}" in graph[${roleName}][${status}] not found in role "${roleName}" frontmatter`,
      );
    }
  }
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

/** Validate each graph edge's target role, including the removed $SUSPEND target. */
function checkEdgeTargets(
  payload: WorkflowPayload,
  roleNames: Set<string>,
  errors: string[],
): void {
  for (const [node, statusMap] of Object.entries(payload.graph)) {
    for (const [status, target] of Object.entries(statusMap)) {
      if (target.role === SUSPEND_TARGET) {
        errors.push(
          `edge ${node}→${status}: "${SUSPEND_TARGET}" is no longer a valid graph target. Emit $status: "${SUSPEND_TARGET}" from the "${node}" role output instead.`,
        );
        continue;
      }
      if (!PSEUDO_TARGETS.has(target.role) && !roleNames.has(target.role)) {
        errors.push(`edge ${node}→${status}: unknown target role "${target.role}"`);
      }
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

  if (graphNodes.has(SUSPEND_TARGET)) {
    errors.push(
      `"${SUSPEND_TARGET}" is no longer a valid graph node — it is now an engine-level reserved $status. Emit $status: "${SUSPEND_TARGET}" from a role output instead.`,
    );
  }

  checkEdgeTargets(payload, roleNames, errors);

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

/** Check status-edge consistency and template vars for each role. */
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
      validateMultiExitTemplates(roleName, graphEntry, variants, errors);
    } else if (hasStatusConst(fm)) {
      const statuses = getConstStatuses(fm as SchemaObj);
      checkStatusEdges(roleName, graphKeys, new Set(statuses), errors);
      validateFlatTemplates(roleName, graphEntry, fm as SchemaObj, errors);
    } else {
      errors.push(
        `role "${roleName}" must define "$status" as const (or oneOf with const) in frontmatter`,
      );
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
