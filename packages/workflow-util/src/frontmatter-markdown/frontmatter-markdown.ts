import type {
  AgentFrontmatter,
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
 * Returns a plain object.  Never throws — unparseable lines are silently skipped.
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

function coerceStatus(raw: YamlValue): FrontmatterStatus | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toLowerCase();
  return VALID_STATUS.includes(s as FrontmatterStatus) ? (s as FrontmatterStatus) : null;
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
  };

  return { frontmatter, body };
}

/**
 * Validate a parsed `AgentFrontmatter` and return a list of violations.
 *
 * An empty array means the frontmatter is valid.
 *
 * Validated constraints:
 * - `status` — must be one of the FrontmatterStatus literals (if non-null)
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

  return errors;
}
