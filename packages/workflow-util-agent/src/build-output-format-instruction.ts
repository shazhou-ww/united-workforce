import type { JSONSchema } from "@uncaged/json-cas";

type SchemaProperty = {
  name: string;
  schema: JSONSchema;
  required: boolean;
};

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
  return extractSchemaProperties(schema).map((p) => p.name);
}

function extractSchemaProperties(schema: JSONSchema): SchemaProperty[] {
  const objectSchemas = collectObjectSchemas(schema);
  if (objectSchemas.length === 0) {
    return [];
  }

  const byName = new Map<string, SchemaProperty>();

  for (const objectSchema of objectSchemas) {
    const requiredSet = new Set(
      Array.isArray(objectSchema.required) ? (objectSchema.required as string[]) : [],
    );
    const properties = objectSchema.properties as Record<string, JSONSchema> | null | undefined;
    if (typeof properties !== "object" || properties === null) {
      continue;
    }

    for (const [name, propSchema] of Object.entries(properties)) {
      const required = requiredSet.has(name);
      const existing = byName.get(name);
      if (existing === undefined) {
        byName.set(name, { name, schema: propSchema, required });
      } else if (required) {
        byName.set(name, { ...existing, required: true });
      }
    }
  }

  return [...byName.values()];
}

function collectObjectSchemas(schema: JSONSchema): JSONSchema[] {
  if (typeof schema.properties === "object" && schema.properties !== null) {
    return [schema];
  }

  const unionKey = Array.isArray(schema.anyOf)
    ? "anyOf"
    : Array.isArray(schema.oneOf)
      ? "oneOf"
      : null;

  if (unionKey === null) {
    return [];
  }

  const variants = schema[unionKey] as JSONSchema[];
  const result: JSONSchema[] = [];
  for (const variant of variants) {
    result.push(...collectObjectSchemas(variant));
  }
  return result;
}

function resolvePropertySchema(prop: JSONSchema): JSONSchema {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    return prop;
  }

  const unionKey = Array.isArray(prop.anyOf) ? "anyOf" : Array.isArray(prop.oneOf) ? "oneOf" : null;

  if (unionKey !== null) {
    const variants = prop[unionKey] as JSONSchema[];
    const nonNull = variants.filter((v) => v.type !== "null");
    if (nonNull.length === 1) {
      return nonNull[0];
    }
  }

  return prop;
}

function formatYamlScalar(value: unknown): string {
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "number") {
    return String(value);
  }
  return String(value);
}

function buildPropertyComment(parts: string[]): string {
  const filtered = parts.filter((p) => p.length > 0);
  return filtered.length > 0 ? `  # ${filtered.join(" | ")}` : "";
}

function buildPropertyExampleLine(prop: SchemaProperty): string {
  const resolved = resolvePropertySchema(prop.schema);
  const commentParts: string[] = [];
  if (prop.required) {
    commentParts.push("required");
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    const enumValues = resolved.enum.map((v) => String(v));
    commentParts.push(...enumValues);
    const first = resolved.enum[0];
    return `${prop.name}: ${formatYamlScalar(first)}${buildPropertyComment(commentParts)}`;
  }

  if (resolved.type === "boolean") {
    commentParts.push("true", "false");
    return `${prop.name}: true${buildPropertyComment(commentParts)}`;
  }

  if (resolved.type === "string") {
    return `${prop.name}: <string>${buildPropertyComment(commentParts)}`;
  }

  if (resolved.type === "number" || resolved.type === "integer") {
    return `${prop.name}: <number>${buildPropertyComment(commentParts)}`;
  }

  if (resolved.type === "array") {
    return `${prop.name}:\n  - <item>${buildPropertyComment(commentParts)}`;
  }

  if (resolved.type === "object") {
    return `${prop.name}: <object>${buildPropertyComment(commentParts)}`;
  }

  return `${prop.name}: <value>${buildPropertyComment(commentParts)}`;
}

function buildYamlExampleBlock(properties: SchemaProperty[]): string {
  if (properties.length === 0) {
    return "---\n\n... your markdown work here ...";
  }

  const lines = properties.map((p) => buildPropertyExampleLine(p));
  return `---\n${lines.join("\n")}\n---\n\n... your markdown work here ...`;
}

function buildFieldList(properties: SchemaProperty[]): string {
  if (properties.length === 0) {
    return "  (schema fields will be extracted automatically)";
  }

  return properties
    .map((p) => {
      const suffix = p.required ? " (required)" : "";
      return `  - \`${p.name}\`${suffix}`;
    })
    .join("\n");
}

/**
 * Detect the discriminant property name from a oneOf schema.
 * Returns the property name if all variants share a const/single-enum string property, else null.
 */
function detectDiscriminant(variants: JSONSchema[]): string | null {
  // Find property names that appear in ALL variants with const or single-enum
  const candidateNames = new Set<string>();

  for (const variant of variants) {
    const props = variant.properties as Record<string, JSONSchema> | null | undefined;
    if (typeof props !== "object" || props === null) return null;

    for (const [name, propSchema] of Object.entries(props)) {
      const isConst =
        propSchema.const !== undefined ||
        (Array.isArray(propSchema.enum) && propSchema.enum.length === 1);
      if (isConst) candidateNames.add(name);
    }
  }

  // Check which candidate appears in ALL variants
  for (const name of candidateNames) {
    const allHaveIt = variants.every((v) => {
      const props = v.properties as Record<string, JSONSchema> | null | undefined;
      if (typeof props !== "object" || props === null) return false;
      const propSchema = props[name];
      if (!propSchema) return false;
      return (
        propSchema.const !== undefined ||
        (Array.isArray(propSchema.enum) && propSchema.enum.length === 1)
      );
    });
    if (allHaveIt) return name;
  }

  return null;
}

function getConstValue(propSchema: JSONSchema): string {
  if (propSchema.const !== undefined) return String(propSchema.const);
  if (Array.isArray(propSchema.enum) && propSchema.enum.length === 1)
    return String(propSchema.enum[0]);
  return "<unknown>";
}

function buildVariantBlock(variant: JSONSchema, discriminant: string): string {
  const props = extractSchemaProperties(variant);
  const value = getConstValue(
    ((variant.properties as Record<string, JSONSchema>) ?? {})[discriminant] ?? {},
  );
  const yamlExample = buildYamlExampleBlock(props);
  const fieldList = buildFieldList(props);

  return `### When \`${discriminant}: ${value}\`

\`\`\`
${yamlExample}
\`\`\`

Fields:
${fieldList}`;
}

/**
 * Build a concise output format instruction block for an agent role.
 *
 * For discriminated union schemas (oneOf with a shared const/$status field),
 * renders per-variant instructions so the agent knows exactly which fields
 * belong to which outcome.
 *
 * For flat object schemas, renders a single YAML example block.
 */
export function buildOutputFormatInstruction(schema: JSONSchema): string {
  // Check for discriminated union (oneOf with shared discriminant)
  const unionKey = Array.isArray(schema.oneOf)
    ? "oneOf"
    : Array.isArray(schema.anyOf)
      ? "anyOf"
      : null;

  if (unionKey !== null) {
    const variants = schema[unionKey] as JSONSchema[];
    const discriminant = detectDiscriminant(variants);

    if (discriminant !== null && variants.length > 1) {
      const variantBlocks = variants.map((v) => buildVariantBlock(v, discriminant)).join("\n\n");

      return `## Deliverable Format

Your response MUST begin with a YAML frontmatter block followed by your markdown work.

Choose ONE of the following variants based on your outcome:

${variantBlocks}

The frontmatter is the **primary deliverable** — the engine reads it directly.
Output ONLY the fields listed for your chosen variant. Do not add extra fields that are not specified in the schema.

Focus exclusively on YOUR role's deliverable. Do not perform actions outside your role's scope.`;
    }
  }

  // Flat object schema fallback
  const properties = extractSchemaProperties(schema);
  const yamlExample = buildYamlExampleBlock(properties);
  const fieldList = buildFieldList(properties);

  return `## Deliverable Format

Your response MUST begin with a YAML frontmatter block followed by your markdown work:

\`\`\`
${yamlExample}
\`\`\`

The frontmatter is the **primary deliverable** — the engine reads it directly.
Your meta output must satisfy these fields:

${fieldList}

Output ONLY the fields listed above. Do not add extra fields that are not specified in the schema.

Focus exclusively on YOUR role's deliverable. Do not perform actions outside your role's scope.`;
}
