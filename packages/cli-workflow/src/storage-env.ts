import { getDefaultWorkflowStorageRoot } from "@uncaged/workflow";

/** Resolve storage root, honoring `UNCAGED_WORKFLOW_STORAGE_ROOT` for tests/tools. */
export function resolveWorkflowStorageRoot(): string {
  const override = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
  if (override !== undefined && override !== "") {
    return override;
  }
  return getDefaultWorkflowStorageRoot();
}
