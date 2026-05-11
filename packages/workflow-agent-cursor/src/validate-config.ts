import { err, ok, type Result } from "@uncaged/workflow-runtime";

import type { CursorAgentConfig } from "./types.js";

export function validateCursorAgentConfig(config: CursorAgentConfig): Result<void, string> {
  if (typeof config.workspace !== "string" || config.workspace.length === 0) {
    return err("workspace must be a non-empty string (absolute path)");
  }
  if (config.timeout < 0) {
    return err("timeout must be a non-negative number (milliseconds); use 0 for no limit");
  }
  return ok(undefined);
}
