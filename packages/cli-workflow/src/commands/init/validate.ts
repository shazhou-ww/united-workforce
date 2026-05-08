import { err, ok, type Result } from "@uncaged/workflow";

/** Validates a single path segment for workspace / template names (no separators, not `.` / `..`). */
export function validateWorkspaceSegment(name: string): Result<void, string> {
  if (name.length === 0) {
    return err("workspace name must not be empty");
  }
  if (name === "." || name === "..") {
    return err("invalid workspace name");
  }
  if (name.includes("/") || name.includes("\\")) {
    return err("workspace name must not contain path separators");
  }
  return ok(undefined);
}
