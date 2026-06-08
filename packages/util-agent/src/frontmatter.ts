import type { Store } from "@ocas/core";
import { getSchema, validate } from "@ocas/core";
import type { CasRef } from "@united-workforce/protocol";
import { SUSPEND_STATUS } from "@united-workforce/protocol";
import {
  type AgentFrontmatter,
  createLogger,
  parseFrontmatterMarkdown,
  validateFrontmatter,
} from "@united-workforce/util";
import { parse as parseYaml } from "yaml";

import { extractSchemaFields } from "./build-output-format-instruction.js";

const log = createLogger({ sink: { kind: "stderr" } });

const STANDARD_KEYS = ["status"] as const;

type StandardKey = (typeof STANDARD_KEYS)[number];

export type FrontmatterFastPathResult = {
  body: string;
  outputHash: CasRef;
  frontmatter: Record<string, unknown>;
};

function extractYamlBlock(raw: string): string | null {
  const fence = "---";
  if (!raw.startsWith(fence)) {
    return null;
  }

  const rest = raw.slice(fence.length);
  if (rest.length > 0 && rest[0] !== "\n" && rest[0] !== "\r") {
    return null;
  }

  const afterOpen = rest.startsWith("\n") ? rest.slice(1) : rest;
  const closeIndex = afterOpen.indexOf(`\n${fence}`);
  if (closeIndex === -1) {
    return null;
  }

  return afterOpen.slice(0, closeIndex);
}

function parseRawFrontmatterFields(raw: string): Record<string, unknown> {
  const yamlText = extractYamlBlock(raw);
  if (yamlText === null) {
    return {};
  }

  try {
    const parsed = parseYaml(yamlText);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return {};
    }
    return parsed as Record<string, unknown>;
  } catch {
    return {};
  }
}

function defaultCandidate(frontmatter: AgentFrontmatter): Record<string, unknown> {
  return {
    status: frontmatter.status,
  };
}

function pickStandardField(frontmatter: AgentFrontmatter, key: StandardKey): unknown {
  switch (key) {
    case "status":
      return frontmatter.status;
  }
}

function isStandardKey(key: string): key is StandardKey {
  return (STANDARD_KEYS as readonly string[]).includes(key);
}

function pickFieldValue(
  field: string,
  frontmatter: AgentFrontmatter,
  rawFields: Record<string, unknown>,
): unknown | undefined {
  if (!isStandardKey(field)) {
    return Object.hasOwn(rawFields, field) ? rawFields[field] : undefined;
  }

  const coerced = pickStandardField(frontmatter, field);
  if (coerced !== null) {
    return coerced;
  }
  return Object.hasOwn(rawFields, field) ? rawFields[field] : coerced;
}

/**
 * Build a CAS candidate object from schema property keys and parsed frontmatter.
 *
 * When the schema has no inspectable properties, falls back to the standard
 * agent frontmatter field (status only).
 */
function buildCandidate(
  frontmatter: AgentFrontmatter,
  rawFields: Record<string, unknown>,
  schemaFields: string[],
): Record<string, unknown> {
  if (schemaFields.length === 0) {
    return defaultCandidate(frontmatter);
  }

  const candidate: Record<string, unknown> = {};

  for (const field of schemaFields) {
    const value = pickFieldValue(field, frontmatter, rawFields);
    if (value !== undefined) {
      candidate[field] = value;
    }
  }

  return candidate;
}

/**
 * Try to satisfy `outputSchema` from frontmatter fields alone.
 *
 * Returns a result containing the stored CAS hash and stripped body on success,
 * or `null` when frontmatter is absent, invalid, or does not satisfy the schema.
 * Never throws.
 *
 * The candidate object is put into the real CAS store (idempotent content-addressed
 * write) and validated against the output schema.  If validation fails the node
 * is orphaned — it will be GC'd on the next collection pass.
 */
export async function tryFrontmatterFastPath(
  raw: string,
  outputSchema: CasRef,
  store: Store,
): Promise<FrontmatterFastPathResult | null> {
  const { frontmatter, body } = parseFrontmatterMarkdown(raw);

  if (frontmatter === null) {
    return null;
  }

  const validationErrors = validateFrontmatter(frontmatter);
  if (validationErrors.length > 0) {
    log(
      "9GNPS4WY",
      `frontmatter validation errors: ${validationErrors.map((e) => e.message).join("; ")}`,
    );
    return null;
  }

  const schema = getSchema(store, outputSchema);
  if (schema === null) {
    log("8FHMR2QX", `output schema not found in CAS: ${outputSchema}`);
    return null;
  }

  const schemaFields = extractSchemaFields(schema);
  const rawFields = parseRawFrontmatterFields(raw);
  const candidate = buildCandidate(frontmatter, rawFields, schemaFields);

  let outputHash: CasRef;
  let node: ReturnType<Store["cas"]["get"]>;

  try {
    outputHash = await store.cas.put(outputSchema, candidate);
    node = store.cas.get(outputHash);
  } catch (e) {
    log("2KMQT7NR", `failed to store frontmatter candidate in CAS: ${e}`);
    return null;
  }

  if (node === null || !validate(store, node)) {
    log("2KMQT7NR", "stored frontmatter candidate failed schema validation");
    return null;
  }

  return { body, outputHash, frontmatter: candidate };
}

/**
 * Build a frontmatter suspend output (coroutine yield). The engine intercepts
 * `$status: "$SUSPEND"` before the moderator, writes the step to CAS, and marks
 * the thread suspended — preserving all turns and usage from the run.
 *
 * Adapter packages (e.g. `agent-claude-code`, `agent-hermes`) import this helper
 * to emit a consistent wire format that round-trips through
 * {@link trySuspendFastPath}.
 */
export function buildSuspendOutput(reason: string): string {
  return `---\n$status: ${SUSPEND_STATUS}\nreason: ${reason}\n---\n`;
}

/**
 * Try to interpret the agent output as an engine-level suspend (coroutine yield).
 *
 * When the frontmatter declares `$status: "$SUSPEND"`, store the output against
 * the reserved {@link SUSPEND_OUTPUT_SCHEMA} instead of the role's own schema —
 * any role may yield regardless of its declared output type. The engine
 * intercepts this status before the moderator and marks the thread suspended.
 *
 * Returns `null` (so the caller falls back to the role-schema fast path) when
 * the output is not a suspend. Never throws.
 */
export async function trySuspendFastPath(
  raw: string,
  suspendSchema: CasRef,
  store: Store,
): Promise<FrontmatterFastPathResult | null> {
  const { frontmatter, body } = parseFrontmatterMarkdown(raw);
  if (frontmatter === null) {
    return null;
  }

  const rawFields = parseRawFrontmatterFields(raw);
  if (rawFields.$status !== SUSPEND_STATUS) {
    return null;
  }

  const reason = typeof rawFields.reason === "string" ? rawFields.reason : "";
  const candidate = { $status: SUSPEND_STATUS, reason };

  let outputHash: CasRef;
  let node: ReturnType<Store["cas"]["get"]>;
  try {
    outputHash = await store.cas.put(suspendSchema, candidate);
    node = store.cas.get(outputHash);
  } catch (e) {
    log("3WQT8KMR", `failed to store suspend candidate in CAS: ${e}`);
    return null;
  }

  if (node === null || !validate(store, node)) {
    log("6PNV4RQX", "stored suspend candidate failed schema validation");
    return null;
  }

  return { body, outputHash, frontmatter: candidate };
}
