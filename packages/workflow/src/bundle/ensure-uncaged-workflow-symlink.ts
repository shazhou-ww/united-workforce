import { mkdir, readlink, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This module lives in `@uncaged/workflow/src/bundle`; grandparent dir is the package root. */
function installedWorkflowPackageDir(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

/**
 * Ensures `<storageRoot>/node_modules/@uncaged/workflow` points at the installed `@uncaged/workflow`
 * package so workflow bundles loaded from `<storageRoot>/bundles/*.esm.js` can resolve `import "@uncaged/workflow"`.
 */
export async function ensureUncagedWorkflowSymlink(storageRoot: string): Promise<void> {
  const target = installedWorkflowPackageDir();
  const linkDir = path.join(storageRoot, "node_modules", "@uncaged");
  const linkPath = path.join(linkDir, "workflow");
  await mkdir(linkDir, { recursive: true });

  try {
    const existing = await readlink(linkPath);
    const normalizedExisting = path.resolve(linkDir, existing);
    if (normalizedExisting === target) {
      return;
    }
    await unlink(linkPath);
  } catch (e) {
    const errObj = e as NodeJS.ErrnoException;
    if (errObj.code !== "ENOENT" && errObj.code !== "EINVAL") {
      throw e;
    }
  }

  const linkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(target, linkPath, linkType);
}
