import { isAbsolute, relative, resolve } from "node:path";

/** Reject paths that escape the workspace root via `..` segments. */
export function resolvePathInWorkspace(cwd: string, inputPath: string): string | null {
  const root = resolve(cwd);
  const target = resolve(root, inputPath);
  const rel = relative(root, target);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    return null;
  }
  return target;
}
