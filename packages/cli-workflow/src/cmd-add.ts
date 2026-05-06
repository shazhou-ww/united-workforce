import { readFile, stat } from "node:fs/promises";
import { basename, resolve } from "node:path";

import {
  err,
  hashWorkflowBundleBytes,
  ok,
  type Result,
  readWorkflowRegistry,
  registerWorkflowVersion,
  validateWorkflowBundle,
  writeWorkflowRegistry,
} from "@uncaged/workflow";

import { storeWorkflowBundleCopy } from "./bundle-store.js";
import { validateCliWorkflowName } from "./workflow-name.js";

export async function cmdAdd(
  storageRoot: string,
  name: string,
  filePath: string,
): Promise<Result<{ hash: string }, string>> {
  const nameOk = validateCliWorkflowName(name);
  if (!nameOk.ok) {
    return nameOk;
  }

  let resolvedPath: string;
  try {
    resolvedPath = resolve(filePath);
    await stat(resolvedPath);
  } catch {
    return err(`bundle file not found: ${filePath}`);
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

  const encoder = new TextEncoder();
  const bytes = encoder.encode(source);
  const hash = hashWorkflowBundleBytes(bytes);

  const stored = await storeWorkflowBundleCopy(storageRoot, hash, resolvedPath, source);
  if (!stored.ok) {
    return stored;
  }

  const reg = await readWorkflowRegistry(storageRoot);
  if (!reg.ok) {
    return err(reg.error.message);
  }

  const next = registerWorkflowVersion(reg.value, name, hash, Date.now());
  const written = await writeWorkflowRegistry(storageRoot, next);
  if (!written.ok) {
    return err(written.error.message);
  }

  return ok({ hash });
}

export function formatAddSuccess(name: string, filePath: string, hash: string): string {
  return `registered workflow "${name}" from ${basename(filePath)} as ${hash}`;
}
