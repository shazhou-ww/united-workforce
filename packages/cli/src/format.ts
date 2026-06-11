import { stringify } from "yaml";

export type OutputFormat = "json" | "yaml" | "text";

type TextRenderer = (data: unknown) => string;

/**
 * Flatten an object into dot-notation key-value lines.
 * Array values are rendered as JSON. Scalars are rendered as strings.
 */
function flattenObject(obj: Record<string, unknown>, prefix: string): string[] {
  const lines: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(value)) {
      lines.push(`${fullKey} ${JSON.stringify(value)}`);
    } else if (value !== null && typeof value === "object") {
      lines.push(...flattenObject(value as Record<string, unknown>, fullKey));
    } else {
      lines.push(`${fullKey} ${String(value)}`);
    }
  }
  return lines;
}

function renderConfigList(data: unknown): string {
  if (data === null || data === undefined || typeof data !== "object") {
    return "";
  }
  const lines = flattenObject(data as Record<string, unknown>, "");
  return lines.join("\n");
}

function renderConfigGet(data: unknown): string {
  if (data === null || data === undefined || typeof data !== "object") {
    return "";
  }
  const obj = data as Record<string, unknown>;
  const value = obj.value;
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    const lines = flattenObject(value as Record<string, unknown>, "");
    return lines.join("\n");
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  return String(value);
}

function renderConfigSet(data: unknown): string {
  if (data === null || data === undefined || typeof data !== "object") {
    return "";
  }
  const obj = data as Record<string, unknown>;
  const key = obj.key;
  const value = obj.value;
  if (key === undefined || key === null) {
    return "";
  }
  const valueStr = Array.isArray(value) ? JSON.stringify(value) : String(value ?? "");
  return `${String(key)} = ${valueStr}`;
}

const TEXT_RENDERERS: Record<string, TextRenderer> = {
  "config list": renderConfigList,
  "config get": renderConfigGet,
  "config set": renderConfigSet,
};

export function formatOutput(
  data: unknown,
  format: OutputFormat,
  commandPath?: string | null,
): string {
  switch (format) {
    case "json":
      return JSON.stringify(data);
    case "yaml":
      return stringify(data, { aliasDuplicateObjects: false }).trimEnd();
    case "text": {
      if (commandPath && TEXT_RENDERERS[commandPath]) {
        return TEXT_RENDERERS[commandPath](data);
      }
      return JSON.stringify(data, null, 2);
    }
  }
}
