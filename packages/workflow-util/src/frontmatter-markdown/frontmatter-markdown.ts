import type {
  AgentFrontmatter,
  FrontmatterScope,
  FrontmatterStatus,
  FrontmatterValidationError,
  ParsedFrontmatterMarkdown,
} from "./types.js";

// ── YAML frontmatter extractor ───────────────────────────────────────────────

const FENCE = "---";

/**
 * Split a raw agent response into a YAML string (or null) and a markdown body.
 *
 * A frontmatter block MUST:
 *   1. Start at character position 0 with `---` (no leading whitespace / BOM).
 *   2. Be closed by a second `---` on its own line.
 *
 * Anything that doesn't match this shape is returned verbatim as the body.
 */
function splitFrontmatter(raw: string): { yaml: string | null; body: string } {
  if (!raw.startsWith(FENCE)) {
    return { yaml: null, body: raw };
  }

  const rest = raw.slice(FENCE.length);
  // The opening `---` must be followed immediately by a newline (or end-of-string).
  if (rest.length > 0 && rest[0] !== "\n" && rest[0] !== "\r") {
    return { yaml: null, body: raw };
  }
  // Consume the newline after the opening fence so that `afterOpen` starts at the
  // first line of YAML content (not a leading empty line).
  const afterOpen = rest.startsWith("\n") ? rest.slice(1) : rest;

  const closeIndex = afterOpen.indexOf(`\n${FENCE}`);
  if (closeIndex === -1) {
    // Also handle the edge case where frontmatter is empty: `---\n---`
    if (afterOpen.startsWith(FENCE)) {
      const afterClose = afterOpen.slice(FENCE.length);
      const body = afterClose.replace(/^\n+/, "");
      return { yaml: "", body };
    }
    return { yaml: null, body: raw };
  }

  const yaml = afterOpen.slice(0, closeIndex);
  // Skip past `\n---` and strip any leading blank separator lines from the body.
  const afterClose = afterOpen.slice(closeIndex + 1 + FENCE.length);
  const body = afterClose.replace(/^\n+/, "");

  return { yaml, body };
}

// ── Minimal YAML scalar parser ───────────────────────────────────────────────
//
// We intentionally avoid a full YAML library dependency inside workflow-util.
// The frontmatter schema is flat and uses only scalars + simple string lists.
// This parser handles exactly what the spec needs and nothing more.

type YamlValue = string | number | boolean | null | string[];

function parseYamlScalar(raw: string): YamlValue {
  const trimmed = raw.trim();

  // Quoted string
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  const lower = trimmed.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null" || lower === "~" || lower === "") return null;

  const num = Number(trimmed);
  if (!Number.isNaN(num) && trimmed !== "") return num;

  return trimmed;
}

function collectBlockSequence(
  lines: string[],
  startIdx: number,
): { items: string[]; nextIdx: number } {
  const items: string[] = [];
  let i = startIdx;
  while (i < lines.length) {
    const itemTrimmed = (lines[i] ?? "").trimStart();
    if (!itemTrimmed.startsWith("- ")) break;
    items.push(itemTrimmed.slice(2).trim());
    i++;
  }
  return { items, nextIdx: i };
}

function parseInlineSequence(restTrimmed: string): string[] {
  const inner = restTrimmed.slice(1, -1);
  return inner
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

function parseKeyValue(
  lines: string[],
  i: number,
): { key: string; value: YamlValue; nextIdx: number } | null {
  const line = lines[i] ?? "";
  if (line.trim() === "" || line.trimStart().startsWith("#")) {
    return null;
  }
  const colonIdx = line.indexOf(":");
  if (colonIdx === -1) {
    return null;
  }
  const key = line.slice(0, colonIdx).trim();
  const restTrimmed = line.slice(colonIdx + 1).trim();

  if (restTrimmed === "") {
    const { items, nextIdx } = collectBlockSequence(lines, i + 1);
    return { key, value: items, nextIdx };
  }
  if (restTrimmed.startsWith("[") && restTrimmed.endsWith("]")) {
    return { key, value: parseInlineSequence(restTrimmed), nextIdx: i + 1 };
  }
  return { key, value: parseYamlScalar(restTrimmed), nextIdx: i + 1 };
}

/**
 * Parse a minimal flat YAML document.  Only supports:
 * - Scalar key: value pairs
 * - Block sequences under a key (items prefixed with `  - `)
 *
 * Returns a plain object.  Throws on structural errors.
 */
function parseMinimalYaml(yaml: string): Record<string, YamlValue> {
  const result: Record<string, YamlValue> = {};
  const lines = yaml.split("\n");

  let i = 0;
  while (i < lines.length) {
    const entry = parseKeyValue(lines, i);
    if (entry === null) {
      i++;
      continue;
    }
    result[entry.key] = entry.value;
    i = entry.nextIdx;
  }

  return result;
}

// ── Field coercers ───────────────────────────────────────────────────────────

const VALID_STATUS: readonly FrontmatterStatus[] = ["done", "needs_input", "in_progress", "failed"];

const VALID_SCOPE: readonly FrontmatterScope[] = ["role", "thread"];

function coerceStatus(raw: YamlValue): FrontmatterStatus | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  return VALID_STATUS.includes(s as FrontmatterStatus) ? (s as FrontmatterStatus) : null;
}

function coerceNext(raw: YamlValue): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  return s === "" ? null : s;
}

function coerceConfidence(raw: YamlValue): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(String(raw).trim());
  if (Number.isNaN(n)) return null;
  return n;
}

function coerceArtifacts(raw: YamlValue): readonly string[] {
  if (raw === null || raw === undefined) return [];
  if (Array.isArray(raw)) return raw.map(String).filter((s) => s !== "");
  const s = String(raw).trim();
  return s === "" ? [] : [s];
}

function coerceScope(raw: YamlValue): FrontmatterScope {
  if (raw === null || raw === undefined) return "role";
  const s = String(raw).trim().toLowerCase();
  return VALID_SCOPE.includes(s as FrontmatterScope) ? (s as FrontmatterScope) : "role";
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Parse a raw agent response string into structured frontmatter + body.
 *
 * - Never throws: malformed YAML is silently treated as "no frontmatter".
 * - The returned `frontmatter` is `null` when no valid `---…---` block was found.
 * - Unknown YAML keys are silently ignored.
 * - Invalid scalar values for known keys are coerced to their null/default.
 */
export function parseFrontmatterMarkdown(raw: string): ParsedFrontmatterMarkdown {
  const { yaml, body } = splitFrontmatter(raw);

  if (yaml === null) {
    return { frontmatter: null, body };
  }

  let fields: Record<string, YamlValue>;
  try {
    fields = parseMinimalYaml(yaml);
  } catch {
    // Unparseable YAML → treat as no frontmatter; keep full raw as body.
    return { frontmatter: null, body: raw };
  }

  const frontmatter: AgentFrontmatter = {
    status: coerceStatus(fields.status ?? null),
    next: coerceNext(fields.next ?? null),
    confidence: coerceConfidence(fields.confidence ?? null),
    artifacts: coerceArtifacts(fields.artifacts ?? null),
    scope: coerceScope(fields.scope ?? null),
  };

  return { frontmatter, body };
}

/**
 * Validate a parsed `AgentFrontmatter` and return a list of violations.
 *
 * An empty array means the frontmatter is valid.
 *
 * Validated constraints:
 * - `status`     — must be one of the FrontmatterStatus literals (if non-null)
 * - `confidence` — must be in [0.0, 1.0] (if non-null)
 * - `next`       — must be a non-empty string with no whitespace (if non-null)
 * - `artifacts`  — each entry must be a non-empty string
 * - `scope`      — must be one of the FrontmatterScope literals
 */
export function validateFrontmatter(
  frontmatter: AgentFrontmatter,
): readonly FrontmatterValidationError[] {
  const errors: FrontmatterValidationError[] = [];

  if (frontmatter.status !== null && !VALID_STATUS.includes(frontmatter.status)) {
    errors.push({
      field: "status",
      message: `invalid status "${frontmatter.status}"; must be one of: ${VALID_STATUS.join(", ")}`,
    });
  }

  if (frontmatter.confidence !== null) {
    if (frontmatter.confidence < 0 || frontmatter.confidence > 1) {
      errors.push({
        field: "confidence",
        message: `confidence ${frontmatter.confidence} is out of range; must be between 0.0 and 1.0 inclusive`,
      });
    }
  }

  if (frontmatter.next !== null) {
    if (frontmatter.next.trim() === "") {
      errors.push({ field: "next", message: "next must be a non-empty string when present" });
    } else if (/\s/.test(frontmatter.next)) {
      errors.push({
        field: "next",
        message: `next "${frontmatter.next}" must not contain whitespace`,
      });
    }
  }

  for (const artifact of frontmatter.artifacts) {
    if (artifact.trim() === "") {
      errors.push({ field: "artifacts", message: "artifact entries must be non-empty strings" });
      break;
    }
  }

  if (!VALID_SCOPE.includes(frontmatter.scope)) {
    errors.push({
      field: "scope",
      message: `invalid scope "${frontmatter.scope}"; must be one of: ${VALID_SCOPE.join(", ")}`,
    });
  }

  return errors;
}
