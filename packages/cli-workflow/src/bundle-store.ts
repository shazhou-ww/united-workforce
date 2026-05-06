import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export async function storeWorkflowBundleCopy(
  storageRoot: string,
  hash: string,
  resolvedSourcePath: string,
  sourceText: string,
): Promise<Result<void, string>> {
  const bundlesDir = join(storageRoot, "bundles");
  const destPath = join(bundlesDir, `${hash}.esm.js`);

  try {
    await mkdir(bundlesDir, { recursive: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to store bundle: ${message}`);
  }

  if (!(await pathExists(destPath))) {
    try {
      await copyFile(resolvedSourcePath, destPath);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(`failed to store bundle: ${message}`);
    }
    return ok(undefined);
  }

  let existing: string;
  try {
    existing = await readFile(destPath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to store bundle: ${message}`);
  }
  if (existing !== sourceText) {
    return err(`bundle hash ${hash} already exists with different contents; refusing to overwrite`);
  }
  return ok(undefined);
}
