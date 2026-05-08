import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  err,
  extractBundleExports,
  hashWorkflowBundleBytes,
  ok,
  type Result,
  readWorkflowRegistry,
  registerWorkflowVersion,
  stringifyWorkflowDescriptor,
  validateWorkflowBundle,
  writeWorkflowRegistry,
} from "@uncaged/workflow";

import { storeWorkflowBundleArtifacts } from "../../bundle-store.js";
import { validateCliWorkflowName } from "../../workflow-name.js";

import type { CmdAddSuccess, ParsedAddArgv } from "./types.js";

function isEsmBundle(path: string): boolean {
  return path.endsWith(".esm.js");
}

function defaultTypesPath(bundlePath: string): string {
  return bundlePath.replace(/\.esm\.js$/i, ".d.ts");
}

async function registerHash(
  storageRoot: string,
  name: string,
  hash: string,
): Promise<Result<void, string>> {
  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    return err(reg.error.message);
  }

  const next = registerWorkflowVersion(reg.value, name, hash, Date.now());
  const written = await writeWorkflowRegistry(storageRoot, next);
  if (!written.ok) {
    return err(written.error.message);
  }
  return ok(undefined);
}

async function resolveOptionalTypes(
  typesPathFlag: string | null,
  resolvedBundlePath: string,
): Promise<Result<{ dtsText: string | null; warnings: string[] }, string>> {
  const warnings: string[] = [];
  let dtsText: string | null = null;

  if (typesPathFlag !== null) {
    const typesResolved = resolve(typesPathFlag);
    try {
      dtsText = await readFile(typesResolved, "utf8");
    } catch {
      return err(`types file not found: ${typesResolved}`);
    }
    return ok({ dtsText, warnings });
  }

  const typesDefault = defaultTypesPath(resolvedBundlePath);
  try {
    dtsText = await readFile(typesDefault, "utf8");
  } catch {
    warnings.push(`optional types file not found (${basename(typesDefault)}); skipped`);
  }

  return ok({ dtsText, warnings });
}

export async function cmdAdd(
  storageRoot: string,
  args: ParsedAddArgv,
): Promise<Result<CmdAddSuccess, string>> {
  const nameOk = validateCliWorkflowName(args.name);
  if (!nameOk.ok) {
    return nameOk;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolve(args.filePath);
    await stat(resolvedPath);
  } catch {
    return err(`file not found: ${args.filePath}`);
  }

  if (resolvedPath.endsWith(".ts")) {
    return err("build your .ts file first, then add the .esm.js");
  }

  if (!isEsmBundle(resolvedPath)) {
    return err('workflow file must end with ".esm.js"');
  }

  let source: string;
  try {
    source = await readFile(resolvedPath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to read bundle: ${message}`);
  }

  const validated = validateWorkflowBundle({
    filePath: resolvedPath,
    source,
  });
  if (!validated.ok) {
    return validated;
  }

  const extracted = await extractBundleExports(resolvedPath, { storageRoot });
  if (!extracted.ok) {
    return extracted;
  }

  const yamlSource = stringifyWorkflowDescriptor(extracted.value.descriptor);

  const companions = await resolveOptionalTypes(args.typesPath, resolvedPath);
  if (!companions.ok) {
    return companions;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(source);
  const hash = hashWorkflowBundleBytes(bytes);

  const dts =
    companions.value.dtsText === null
      ? null
      : { kind: "text" as const, text: companions.value.dtsText };

  const stored = await storeWorkflowBundleArtifacts(storageRoot, hash, {
    esmJs: { kind: "text", text: source },
    yaml: { kind: "text", text: yamlSource },
    dts,
  });
  if (!stored.ok) {
    return stored;
  }

  const regResult = await registerHash(storageRoot, args.name, hash);
  if (!regResult.ok) {
    return regResult;
  }

  return ok({ hash, warnings: companions.value.warnings });
}

export function formatAddSuccess(name: string, filePath: string, hash: string): string {
  return `registered workflow "${name}" from ${basename(filePath)} as ${hash}`;
}
