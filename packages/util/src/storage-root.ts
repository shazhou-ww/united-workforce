import { homedir } from "node:os";
import { join } from "node:path";

/** Default filesystem root for workflow data (`~/.uwf`). */
export function getDefaultStorageRoot(): string {
  return join(homedir(), ".uwf");
}

/** @deprecated Use `getDefaultStorageRoot` instead. */
export function getDefaultWorkflowStorageRoot(): string {
  return getDefaultStorageRoot();
}

/** Global content-addressed store directory under the workflow storage root (`<root>/cas`). */
export function getGlobalCasDir(storageRoot: string | undefined): string {
  const root = storageRoot ?? getDefaultStorageRoot();
  return join(root, "cas");
}
