import type * as z from "zod/v4";

type ZodSchema = z.ZodType;

/**
 * Extract the top-level field names from a Zod schema.
 *
 * Handles:
 * - ZodObject → its `.shape` keys
 * - ZodDiscriminatedUnion / ZodUnion → union of all variant shapes
 *
 * Returns an empty array for schemas that have no inspectable shape
 * (e.g. primitives, ZodAny).
 */
function extractSchemaFields(schema: ZodSchema): string[] {
  const def = schema.def as {
    type: string;
    shape?: Record<string, ZodSchema>;
    options?: ZodSchema[];
  };

  if (def.type === "object" && def.shape !== undefined) {
    return Object.keys(def.shape);
  }

  if ((def.type === "discriminated_union" || def.type === "union") && Array.isArray(def.options)) {
    const fieldSet = new Set<string>();
    for (const option of def.options) {
      for (const field of extractSchemaFields(option as ZodSchema)) {
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
 * the meta fields derived from `schema`. It is injected at the top of the
 * system prompt so the deliverable format is the first thing the agent sees.
 *
 * Focus on YOUR role's deliverable. Do not perform actions outside your role's scope.
 */
export function buildOutputFormatInstruction(schema: ZodSchema): string {
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
