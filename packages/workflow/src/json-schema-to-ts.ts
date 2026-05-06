/**
 * Convert a JSON Schema subset (object / string / number / integer / boolean / array)
 * into a TypeScript type string for generated `.d.ts` files.
 */
export function jsonSchemaToTypeString(schema: unknown): string {
  return schemaToTs(schema);
}

function schemaToTs(schema: unknown): string {
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    return "unknown";
  }
  const s = schema as Record<string, unknown>;

  if ("enum" in s && Array.isArray(s.enum) && s.enum.length > 0) {
    const literals = s.enum
      .filter((v): v is string | number | boolean => v !== null && v !== undefined)
      .map((v) => (typeof v === "string" ? JSON.stringify(v) : String(v)));
    if (literals.length === 0) {
      return "unknown";
    }
    return literals.join(" | ");
  }

  const t = s.type;
  if (t === "string") {
    return "string";
  }
  if (t === "number" || t === "integer") {
    return "number";
  }
  if (t === "boolean") {
    return "boolean";
  }
  if (t === "array") {
    const items = s.items;
    if (items === undefined || items === null) {
      return "unknown[]";
    }
    if (Array.isArray(items)) {
      if (items.length === 0) {
        return "unknown[]";
      }
      const parts = items.map((it) => schemaToTs(it));
      return `[${parts.join(", ")}]`;
    }
    return `${schemaToTs(items)}[]`;
  }
  if (t === "object") {
    const propsRaw = s.properties;
    const requiredRaw = s.required;
    const required = new Set<string>(
      Array.isArray(requiredRaw)
        ? requiredRaw.filter((x): x is string => typeof x === "string")
        : [],
    );

    if (propsRaw === null || propsRaw === undefined) {
      return "Record<string, unknown>";
    }
    if (typeof propsRaw !== "object" || Array.isArray(propsRaw)) {
      return "Record<string, unknown>";
    }

    const props = propsRaw as Record<string, unknown>;
    const entries = Object.entries(props);
    if (entries.length === 0) {
      return "{}";
    }

    const parts: string[] = [];
    for (const [key, subSchema] of entries) {
      const optional = !required.has(key);
      const ts = schemaToTs(subSchema);
      const safeKey = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
      const suffix = optional ? " | null" : "";
      parts.push(`${safeKey}: ${ts}${suffix}`);
    }
    return `{ ${parts.join("; ")} }`;
  }

  return "unknown";
}
