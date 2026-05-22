import type { CasRef, WorkflowPayload } from "@uncaged/workflow-protocol";

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
  const meta = value.meta;
  const metaOk = isRecord(meta) && typeof meta.type === "string";
  const capabilities = value.capabilities;
  const capabilitiesOk =
    Array.isArray(capabilities) && capabilities.every((c) => typeof c === "string");
  return (
    typeof value.description === "string" &&
    typeof value.goal === "string" &&
    capabilitiesOk &&
    typeof value.procedure === "string" &&
    typeof value.output === "string" &&
    metaOk
  );
}

function isConditionDefinition(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  return typeof value.description === "string" && typeof value.expression === "string";
}

function isTransition(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const condition = value.condition;
  return typeof value.role === "string" && (condition === null || typeof condition === "string");
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
    (transitions) => Array.isArray(transitions) && transitions.every((t) => isTransition(t)),
  );
}

/** Validate YAML-parsed workflow document shape (outputSchema may be inline JSON Schema). */
export function parseWorkflowPayload(raw: unknown): WorkflowPayload | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (typeof raw.name !== "string" || typeof raw.description !== "string") {
    return null;
  }
  if (
    !isStringRecord(raw.roles, isRoleDefinition) ||
    !isStringRecord(raw.conditions, isConditionDefinition) ||
    !isGraph(raw.graph)
  ) {
    return null;
  }
  return raw as WorkflowPayload;
}
