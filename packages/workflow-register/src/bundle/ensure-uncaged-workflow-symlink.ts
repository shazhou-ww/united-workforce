import { mkdir, readlink, symlink, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** This module lives in `@uncaged/workflow-register/src/bundle`; grandparent dir is the package root. */
function installedWorkflowPackageDir(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

/**
 * Resolve sibling @uncaged/* package directory relative to workflow-register.
 * In a monorepo workspace layout the sibling packages live next to workflow-register.
 */
function siblingPackageDir(packageName: string): string {
  const registerRoot = installedWorkflowPackageDir();
  return path.resolve(registerRoot, "..", packageName);
}

async function ensureSymlink(linkDir: string, name: string, target: string): Promise<void> {
  const linkPath = path.join(linkDir, name);
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

/**
 * Ensures `<storageRoot>/node_modules/@uncaged/*` symlinks point at installed packages
 * so workflow bundles loaded from `<storageRoot>/bundles/*.esm.js` can resolve their imports.
 */
export async function ensureUncagedWorkflowSymlink(storageRoot: string): Promise<void> {
  const linkDir = path.join(storageRoot, "node_modules", "@uncaged");

  const packages = [
    { name: "workflow", dir: siblingPackageDir("workflow") },
    { name: "workflow-runtime", dir: siblingPackageDir("workflow-runtime") },
    { name: "workflow-cas", dir: siblingPackageDir("workflow-cas") },
    { name: "workflow-protocol", dir: siblingPackageDir("workflow-protocol") },
  ];

  for (const pkg of packages) {
    await ensureSymlink(linkDir, pkg.name, pkg.dir);
  }
}
