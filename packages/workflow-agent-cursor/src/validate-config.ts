import { err, ok, type Result } from "@uncaged/workflow";

import type { CursorAgentConfig } from "./types.js";

export function validateCursorAgentConfig(config: CursorAgentConfig): Result<void, string> {
  if (config.workdir.trim() === "") {
    return err("workdir must be a non-empty string");
  }
  if (config.timeout !== null && config.timeout < 0) {
    return err("timeout must be null or a non-negative number (milliseconds)");
  }
  return ok(undefined);
}
