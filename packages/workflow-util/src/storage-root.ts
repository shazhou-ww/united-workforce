import { homedir } from "node:os";
import { join } from "node:path";

/** Default filesystem root for workflow data (`~/.uncaged/workflow`). */
export function getDefaultWorkflowStorageRoot(): string {
  return join(homedir(), ".uncaged", "workflow");
}

/** Global content-addressed store directory under the workflow storage root (`<root>/cas`). */
export function getGlobalCasDir(storageRoot: string | undefined): string {
  const root = storageRoot ?? getDefaultWorkflowStorageRoot();
  return join(root, "cas");
}
