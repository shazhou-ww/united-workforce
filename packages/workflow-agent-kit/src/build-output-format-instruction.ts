import type { JSONSchema } from "@uncaged/json-cas";

/**
 * Extract top-level property names from a JSON Schema object.
 *
 * Handles:
 * - Object schemas with a `properties` key
 * - Union schemas via `anyOf` / `oneOf` — union of all variant property names
 *
 * Returns an empty array for schemas with no inspectable property definitions.
 */
export function extractSchemaFields(schema: JSONSchema): string[] {
  if (typeof schema.properties === "object" && schema.properties !== null) {
    return Object.keys(schema.properties as Record<string, unknown>);
  }

  const unionKey = Array.isArray(schema.anyOf)
    ? "anyOf"
    : Array.isArray(schema.oneOf)
      ? "oneOf"
      : null;

  if (unionKey !== null) {
    const variants = schema[unionKey] as JSONSchema[];
    const fieldSet = new Set<string>();
    for (const variant of variants) {
      for (const field of extractSchemaFields(variant)) {
        fieldSet.add(field);
      }
    }
    return [...fieldSet];
  }

  return [];
}

/**
 * Build a concise output format instruction block for an agent role.
 *
 * The instruction describes the expected frontmatter markdown format and lists
 * the meta fields derived from the JSON Schema.  It is prepended to the agent's
 * system prompt so the deliverable format is the first thing the agent sees.
 */
export function buildOutputFormatInstruction(schema: JSONSchema): string {
  const fields = extractSchemaFields(schema);

  const fieldList =
    fields.length > 0
      ? fields.map((f) => `  - \`${f}\``).join("\n")
      : "  (schema fields will be extracted automatically)";

  return `## Deliverable Format

Your response MUST begin with a YAML frontmatter block followed by your markdown work:

\`\`\`
---
status: done          # done | needs_input | in_progress | failed
next: <role-name>     # suggested next role, or omit
confidence: 0.9       # 0.0–1.0, your self-assessed confidence
artifacts:            # list of file paths or CAS hashes you produced
  - path/to/file.ts
scope: role           # role | thread
---

... your markdown work here ...
\`\`\`

The frontmatter is the **primary deliverable** — the engine reads it directly.
Your meta output must satisfy these fields:

${fieldList}

Focus exclusively on YOUR role's deliverable. Do not perform actions outside your role's scope.`;
}
