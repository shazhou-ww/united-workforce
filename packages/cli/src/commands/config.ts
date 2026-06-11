import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse, stringify } from "yaml";

/**
 * Valid configuration key schema. Engine config is LLM-free — providers,
 * models, defaultModel, and modelOverrides are no longer accepted here.
 * Each adapter owns its own LLM configuration.
 */
const VALID_CONFIG_KEYS: Record<
  string,
  { nested: boolean; knownFields?: string[]; minDepth?: number }
> = {
  agents: {
    nested: true,
    knownFields: ["command", "args"],
  },
  agentOverrides: {
    nested: true,
    // agentOverrides.<workflowName>.<roleName> = agentAlias (string value)
    // No knownFields — workflow/role names are user-defined
  },
  defaultAgent: { nested: false },
  concurrency: {
    nested: true,
    knownFields: ["maxRunning"],
    minDepth: 2,
  },
};

/**
 * Validate a config key path against the known schema
 */
function validateConfigKey(path: string[]): void {
  if (path.length === 0) {
    throw new Error("Path cannot be empty");
  }

  const topLevel = path[0];
  const schema = VALID_CONFIG_KEYS[topLevel];

  if (!schema) {
    const validKeys = Object.keys(VALID_CONFIG_KEYS).join(", ");
    throw new Error(`Unknown config key: ${topLevel}. Valid top-level keys are: ${validKeys}`);
  }

  // Scalar keys cannot have nested paths
  if (!schema.nested && path.length > 1) {
    throw new Error(`${topLevel} is a scalar key and cannot have nested properties`);
  }

  // Nested keys must have at least minDepth segments (default 3)
  const minDepth = schema.minDepth ?? 3;
  if (schema.nested && path.length < minDepth) {
    const fields = schema.knownFields?.join(", ") ?? "";
    throw new Error(
      `Incomplete path for ${topLevel}. Must specify a field (e.g., ${topLevel}.<name>.<field>). Valid fields: ${fields}`,
    );
  }

  // Validate the field name for nested keys
  if (schema.nested && path.length >= 3 && schema.knownFields) {
    const field = path[path.length - 1];
    if (!schema.knownFields.includes(field)) {
      throw new Error(
        `Unknown field '${field}' in ${topLevel}. Valid fields are: ${schema.knownFields.join(", ")}`,
      );
    }
  }
}

/**
 * Returns the path to the config.yaml file
 */
export function getConfigPath(storageRoot: string): string {
  return join(storageRoot, "config.yaml");
}

/**
 * Load and parse YAML config file
 */
export function loadConfig(configPath: string): Record<string, unknown> {
  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }
  const content = readFileSync(configPath, "utf8");
  if (!content.trim()) {
    return {};
  }
  try {
    const parsed = parse(content);
    return (parsed ?? {}) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `Invalid YAML in config file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Save config as YAML
 */
export function saveConfig(configPath: string, config: Record<string, unknown>): void {
  const dir = join(configPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const yaml = stringify(config);
  writeFileSync(configPath, yaml, "utf8");
}

/**
 * Parse dot-notation key into path segments
 */
export function parseDotPath(key: string): string[] {
  return key.split(".");
}

/**
 * Get nested value from object using path array
 */
export function getNestedValue(obj: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = obj;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Set nested value in object using path array (mutates obj)
 */
export function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  if (path.length === 0) {
    throw new Error("Path cannot be empty");
  }

  let current: Record<string, unknown> = obj;

  // Navigate/create to the parent of the target
  for (let i = 0; i < path.length - 1; i++) {
    const segment = path[i];
    const next = current[segment];

    if (next === null || next === undefined) {
      // Create intermediate object
      const newObj: Record<string, unknown> = {};
      current[segment] = newObj;
      current = newObj;
    } else if (typeof next === "object" && !Array.isArray(next)) {
      // Navigate into existing object
      current = next as Record<string, unknown>;
    } else {
      // Cannot navigate into non-object
      throw new Error(
        `Cannot set property '${path[i + 1]}' on non-object at path '${path.slice(0, i + 1).join(".")}'`,
      );
    }
  }

  // Set the final value
  const lastSegment = path[path.length - 1];
  current[lastSegment] = value;
}

/**
 * Deep clone the config. Engine config is LLM-free, so there are no apiKey
 * fields to mask — this function is preserved as a defensive deep-clone
 * boundary used by `cmdConfigList`.
 */
export function maskApiKeys(config: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

/**
 * List all configuration values (masks API keys)
 */
export async function cmdConfigList(storageRoot: string): Promise<unknown> {
  const configPath = getConfigPath(storageRoot);
  const config = loadConfig(configPath);
  const masked = maskApiKeys(config);
  return masked;
}

/**
 * Get a specific configuration value
 */
export async function cmdConfigGet(storageRoot: string, key: string): Promise<unknown> {
  const configPath = getConfigPath(storageRoot);
  const config = loadConfig(configPath);
  const path = parseDotPath(key);
  const value = getNestedValue(config, path);

  if (value === undefined) {
    throw new Error(`Key not found: ${key}`);
  }

  return value;
}

/**
 * Parse value for args key (must be JSON array)
 */
function parseArgsValue(value: string): unknown {
  if (value.startsWith("[")) {
    try {
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed)) {
        throw new Error("Value must be an array");
      }
      return parsed;
    } catch (error) {
      throw new Error(
        `Invalid JSON array for args key: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error("Value for 'args' key must be a JSON array starting with '['");
}

/**
 * Validate that we're not setting a property on a non-object
 */
function validateParentPath(
  config: Record<string, unknown>,
  path: string[],
  lastSegment: string,
): void {
  if (path.length > 1) {
    const parentPath = path.slice(0, -1);
    const parent = getNestedValue(config, parentPath);
    if (parent !== null && parent !== undefined && typeof parent !== "object") {
      throw new Error(
        `Cannot set property '${lastSegment}' on non-object at path '${parentPath.join(".")}'`,
      );
    }
  }
}

/**
 * Set a specific configuration value
 */
export async function cmdConfigSet(
  storageRoot: string,
  key: string,
  value: string,
): Promise<unknown> {
  const configPath = getConfigPath(storageRoot);

  // Load existing config or create empty one
  let config: Record<string, unknown>;
  if (existsSync(configPath)) {
    config = loadConfig(configPath);
  } else {
    config = {};
  }

  const path = parseDotPath(key);

  // Validate the key path
  validateConfigKey(path);

  const lastSegment = path[path.length - 1];

  // Parse value if it's for an array key (args)
  let parsedValue: unknown = value;
  if (lastSegment === "args") {
    parsedValue = parseArgsValue(value);
  } else if (lastSegment === "maxRunning") {
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1) {
      throw new Error("Value for 'maxRunning' must be a positive integer");
    }
    parsedValue = num;
  }

  // Validate we're not setting a property on a non-object
  validateParentPath(config, path, lastSegment);

  setNestedValue(config, path, parsedValue);
  saveConfig(configPath, config);

  return { key, value: parsedValue };
}
