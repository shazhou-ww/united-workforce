import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  buildWorkflowFromTypeScript,
  err,
  hashWorkflowBundleBytes,
  ok,
  type Result,
  readWorkflowRegistry,
  registerWorkflowVersion,
  validateWorkflowBundle,
  writeWorkflowRegistry,
} from "@uncaged/workflow";

import type { ParsedAddArgv } from "./add-argv.js";
import { storeWorkflowBundleArtifacts } from "./bundle-store.js";
import { validateCliWorkflowName } from "./workflow-name.js";

export type CmdAddSuccess = {
  hash: string;
  warnings: ReadonlyArray<string>;
};

function isTypeScriptWorkflow(path: string): boolean {
  return path.endsWith(".ts");
}

function isEsmBundle(path: string): boolean {
  return path.endsWith(".esm.js");
}

function defaultDescriptorPath(bundlePath: string): string {
  return bundlePath.replace(/\.esm\.js$/i, ".yaml");
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

async function addFromTypeScript(
  storageRoot: string,
  workflowName: string,
  resolvedTsPath: string,
): Promise<Result<CmdAddSuccess, string>> {
  const built = await buildWorkflowFromTypeScript(resolvedTsPath);
  if (!built.ok) {
    return built;
  }

  const encoder = new TextEncoder();
  const bytes = encoder.encode(built.value.esmJsSource);
  const hash = hashWorkflowBundleBytes(bytes);

  const stored = await storeWorkflowBundleArtifacts(storageRoot, hash, {
    esmJs: { kind: "text", text: built.value.esmJsSource },
    yaml: { kind: "text", text: built.value.yamlSource },
    dts: { kind: "text", text: built.value.dtsSource },
  });
  if (!stored.ok) {
    return stored;
  }

  const regResult = await registerHash(storageRoot, workflowName, hash);
  if (!regResult.ok) {
    return regResult;
  }

  return ok({ hash, warnings: [] });
}

async function resolveYamlAndOptionalTypes(
  args: ParsedAddArgv,
  resolvedBundlePath: string,
): Promise<Result<{ yamlText: string; dtsText: string | null; warnings: string[] }, string>> {
  const warnings: string[] = [];
  const yamlResolved =
    args.descriptorPath !== null
      ? resolve(args.descriptorPath)
      : defaultDescriptorPath(resolvedBundlePath);

  let yamlText: string;
  try {
    yamlText = await readFile(yamlResolved, "utf8");
  } catch {
    return err(`descriptor YAML not found: ${yamlResolved}`);
  }

  let dtsText: string | null = null;
  if (args.typesPath !== null) {
    const typesResolved = resolve(args.typesPath);
    try {
      dtsText = await readFile(typesResolved, "utf8");
    } catch {
      return err(`types file not found: ${typesResolved}`);
    }
  } else {
    const typesDefault = defaultTypesPath(resolvedBundlePath);
    try {
      dtsText = await readFile(typesDefault, "utf8");
    } catch {
      warnings.push(`optional types file not found (${basename(typesDefault)}); skipped`);
    }
  }

  return ok({ yamlText, dtsText, warnings });
}

async function addFromEsmJs(
  storageRoot: string,
  workflowName: string,
  args: ParsedAddArgv,
  resolvedBundlePath: string,
): Promise<Result<CmdAddSuccess, string>> {
  let source: string;
  try {
    source = await readFile(resolvedBundlePath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to read bundle: ${message}`);
  }

  const validated = validateWorkflowBundle({
    filePath: resolvedBundlePath,
    source,
  });
  if (!validated.ok) {
    return validated;
  }

  const companions = await resolveYamlAndOptionalTypes(args, resolvedBundlePath);
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
    yaml: { kind: "text", text: companions.value.yamlText },
    dts,
  });
  if (!stored.ok) {
    return stored;
  }

  const regResult = await registerHash(storageRoot, workflowName, hash);
  if (!regResult.ok) {
    return regResult;
  }

  return ok({ hash, warnings: companions.value.warnings });
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

  if (isTypeScriptWorkflow(resolvedPath)) {
    return addFromTypeScript(storageRoot, args.name, resolvedPath);
  }

  if (!isEsmBundle(resolvedPath)) {
    return err('workflow file must be ".ts" or end with ".esm.js"');
  }

  return addFromEsmJs(storageRoot, args.name, args, resolvedPath);
}

export function formatAddSuccess(name: string, filePath: string, hash: string): string {
  return `registered workflow "${name}" from ${basename(filePath)} as ${hash}`;
}
