import { getDefaultWorkflowStorageRoot } from "@uncaged/workflow";

/**
 * Resolve storage root with env var override support.
 *
 * Priority (highest first):
 *  1. `UNCAGED_WORKFLOW_STORAGE_ROOT` — internal/test override
 *  2. `WORKFLOW_STORAGE_ROOT` — user-facing override
 *  3. Default (`~/.uncaged/workflow`)
 */
export function resolveWorkflowStorageRoot(): string {
  const internal = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
  if (internal !== undefined && internal !== "") {
    return internal;
  }
  const userOverride = process.env.WORKFLOW_STORAGE_ROOT;
  if (userOverride !== undefined && userOverride !== "") {
    return userOverride;
  }
  return getDefaultWorkflowStorageRoot();
}
