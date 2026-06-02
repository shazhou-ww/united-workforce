import { resolve } from "node:path";

/** Resolve a path relative to the working directory. */
export function resolvePath(cwd: string, inputPath: string): string {
  return resolve(cwd, inputPath);
}
