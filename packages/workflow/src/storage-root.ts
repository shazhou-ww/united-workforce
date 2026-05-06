import { homedir } from "node:os";
import { join } from "node:path";

/** Default filesystem root for workflow data (`~/.uncaged/workflow`). */
export function getDefaultWorkflowStorageRoot(): string {
  return join(homedir(), ".uncaged", "workflow");
}
