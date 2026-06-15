import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { parse } from "yaml";

import type { Result, SumeruConfig, SumeruInstance } from "./types.js";

/**
 * Path to the sumeru adapter's own config file inside a uwf storage root.
 * The adapter loads this file lazily on first use.
 */
export function getSumeruConfigPath(storageRoot: string): string {
  return join(storageRoot, "agents", "sumeru.yaml");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function trimTrailingSlash(url: string): string {
  let end = url.length;
  while (end > 0 && url.charAt(end - 1) === "/") {
    end -= 1;
  }
  return url.slice(0, end);
}

type ParsedInstances = {
  instances: Record<string, SumeruInstance>;
  defaultMarked: string[];
};

/** Parse one `[name, entry]` tuple — returns the instance or an error message. */
function parseInstanceEntry(
  name: string,
  entry: unknown,
): Result<{ instance: SumeruInstance; isDefault: boolean }, string> {
  if (!isRecord(entry)) {
    return { ok: false, error: `instance '${name}' must be a mapping` };
  }
  const url = entry.url;
  if (typeof url !== "string" || url.trim() === "") {
    return {
      ok: false,
      error: `instance '${name}' requires a non-empty 'url' string`,
    };
  }
  return {
    ok: true,
    value: {
      instance: { url: trimTrailingSlash(url.trim()) },
      isDefault: entry.default === true,
    },
  };
}

/** Parse the `instances` mapping into a normalised collection. */
function parseInstancesMap(instancesRaw: Record<string, unknown>): Result<ParsedInstances, string> {
  const entries = Object.entries(instancesRaw);
  if (entries.length === 0) {
    return {
      ok: false,
      error: "has no instances; declare at least one under 'instances:'",
    };
  }
  const instances: Record<string, SumeruInstance> = {};
  const defaultMarked: string[] = [];
  for (const [name, entry] of entries) {
    const result = parseInstanceEntry(name, entry);
    if (!result.ok) return result;
    instances[name] = result.value.instance;
    if (result.value.isDefault) {
      defaultMarked.push(name);
    }
  }
  return { ok: true, value: { instances, defaultMarked } };
}

/** Resolve which instance name should be the default. */
function resolveDefaultInstanceName(parsed: ParsedInstances): Result<string, string> {
  const { instances, defaultMarked } = parsed;
  const names = Object.keys(instances);
  if (defaultMarked.length > 1) {
    return {
      ok: false,
      error: "has multiple instances marked default: true; mark exactly one",
    };
  }
  if (defaultMarked.length === 1) {
    return { ok: true, value: defaultMarked[0] as string };
  }
  // No defaults marked — accept N=1 as implicit default.
  if (names.length === 1) {
    return { ok: true, value: names[0] as string };
  }
  return {
    ok: false,
    error: `has ${names.length} instances but none is marked default: true; mark exactly one`,
  };
}

/**
 * Pure helper: parse a YAML string into a `SumeruConfig` or a descriptive
 * error message. No filesystem I/O — safe to unit-test by passing raw YAML.
 *
 * Error messages mirror the format expected by the loader so callers can
 * forward them verbatim to stderr.
 */
export function parseSumeruConfig(yamlText: string): Result<SumeruConfig, string> {
  let raw: unknown;
  try {
    raw = parse(yamlText) as unknown;
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return { ok: false, error: `is not valid YAML: ${detail}` };
  }

  if (!isRecord(raw)) {
    return { ok: false, error: "root must be a mapping" };
  }

  const instancesRaw = raw.instances;
  if (!isRecord(instancesRaw)) {
    return {
      ok: false,
      error: "has no instances; declare at least one under 'instances:'",
    };
  }

  const instancesResult = parseInstancesMap(instancesRaw);
  if (!instancesResult.ok) return instancesResult;

  const defaultNameResult = resolveDefaultInstanceName(instancesResult.value);
  if (!defaultNameResult.ok) return defaultNameResult;

  const defaultGateway = raw.defaultGateway;
  if (typeof defaultGateway !== "string" || defaultGateway.trim() === "") {
    return { ok: false, error: "is missing 'defaultGateway'" };
  }

  return {
    ok: true,
    value: {
      instances: instancesResult.value.instances,
      defaultInstanceName: defaultNameResult.value,
      defaultGateway: defaultGateway.trim(),
    },
  };
}

/**
 * Load the sumeru adapter config from disk.
 *
 * Throws an `Error` with a CLI-ready message on every failure (missing file,
 * invalid YAML, schema violations). Callers should catch and propagate the
 * message through `fail()` in the CLI entry point.
 *
 * The path used is `getSumeruConfigPath(storageRoot)` — storage root must be
 * resolved by the caller (the CLI binary reads `UWF_HOME` once and threads
 * the value through; library code never reads `process.env`).
 */
export async function loadSumeruConfig(storageRoot: string): Promise<SumeruConfig> {
  const path = getSumeruConfigPath(storageRoot);
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (cause) {
    const err = cause as NodeJS.ErrnoException;
    if (err.code === "ENOENT") {
      throw new Error(
        `sumeru adapter config not found: ${path}. Create it with at least one instance and a defaultGateway.`,
      );
    }
    const detail = err.message ?? String(cause);
    throw new Error(`sumeru adapter config ${path} could not be read: ${detail}`);
  }

  const result = parseSumeruConfig(text);
  if (!result.ok) {
    throw new Error(`sumeru adapter config ${path} ${result.error}`);
  }
  return result.value;
}

/**
 * Helper: factory that memoises the first successful load so `run()` and
 * `continue()` within a single CLI invocation share the same parsed config.
 *
 * The first call performs I/O; subsequent calls return the cached value.
 */
export function createSumeruConfigLoader(storageRoot: string): () => Promise<SumeruConfig> {
  let cached: SumeruConfig | null = null;
  return async () => {
    if (cached !== null) {
      return cached;
    }
    cached = await loadSumeruConfig(storageRoot);
    return cached;
  };
}

/** Resolve the URL of the default instance from a parsed config. */
export function resolveDefaultInstanceUrl(config: SumeruConfig): string {
  const inst = config.instances[config.defaultInstanceName];
  if (inst === undefined) {
    throw new Error(`sumeru adapter config has no instance named '${config.defaultInstanceName}'`);
  }
  return inst.url;
}
