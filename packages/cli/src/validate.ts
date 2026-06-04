import { basename, dirname } from "node:path";
import type { CasRef, WorkflowPayload } from "@united-workforce/protocol";

const CAS_REF_PATTERN = /^[0-9A-HJKMNP-TV-Z]{13}$/;

export function isCasRef(value: string): value is CasRef {
  return CAS_REF_PATTERN.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRoleDefinition(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const frontmatter = value.frontmatter;
  const frontmatterOk =
    isRecord(frontmatter) &&
    (typeof frontmatter.type === "string" || Array.isArray(frontmatter.oneOf));
  const capabilities = value.capabilities;
  const capabilitiesOk =
    Array.isArray(capabilities) && capabilities.every((c) => typeof c === "string");
  return (
    typeof value.description === "string" &&
    typeof value.goal === "string" &&
    capabilitiesOk &&
    typeof value.procedure === "string" &&
    typeof value.output === "string" &&
    frontmatterOk
  );
}

function isTarget(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const hasValidLocation =
    value.location === undefined || value.location === null || typeof value.location === "string";
  return (
    typeof value.role === "string" &&
    typeof value.prompt === "string" &&
    value.prompt.trim() !== "" &&
    hasValidLocation
  );
}

function isStringRecord(value: unknown, itemCheck: (item: unknown) => boolean): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(itemCheck);
}

function isGraph(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return Object.values(value).every(
    (statusMap) => isRecord(statusMap) && Object.values(statusMap).every((t) => isTarget(t)),
  );
}

/**
 * Derive the expected workflow name from a file path (stem without extension).
 * Returns the stem for `.yaml` / `.yml` files.
 */
export function workflowNameFromPath(filePath: string): string {
  const base = basename(filePath);
  const stem = base.endsWith(".yaml")
    ? base.slice(0, -5)
    : base.endsWith(".yml")
      ? base.slice(0, -4)
      : base;
  if (stem === "index") {
    return basename(dirname(filePath));
  }
  return stem;
}

/**
 * Check that the `name` field in a parsed payload matches the expected name
 * derived from the file path.  Returns an error message string on mismatch,
 * or null when the names are consistent.
 */
export function checkWorkflowFilenameConsistency(
  filePath: string,
  payload: WorkflowPayload,
): string | null {
  const expected = workflowNameFromPath(filePath);
  if (payload.name !== expected) {
    return `workflow name mismatch: file "${basename(filePath)}" implies name "${expected}" but YAML declares name "${payload.name}"`;
  }
  return null;
}

/** Validate YAML-parsed workflow document shape (outputSchema may be inline JSON Schema). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: validation function with many field checks
export function parseWorkflowPayload(raw: unknown): WorkflowPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.name !== "string" || typeof raw.description !== "string") {
    return null;
  }
  if (!isStringRecord(raw.roles, isRoleDefinition) || !isGraph(raw.graph)) {
    return null;
  }

  // Normalize location field: undefined → null
  const normalized = { ...raw } as WorkflowPayload;
  for (const roleName of Object.keys(normalized.graph)) {
    const statusMap = normalized.graph[roleName];
    if (statusMap !== undefined) {
      for (const status of Object.keys(statusMap)) {
        const target = statusMap[status];
        if (target !== undefined) {
          if (target.location === undefined) {
            target.location = null;
          }
        }
      }
    }
  }

  return normalized;
}
