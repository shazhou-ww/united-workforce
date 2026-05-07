import { err, ok, type Result } from "@uncaged/workflow";

import type { CursorAgentConfig } from "./types.js";

export function validateCursorAgentConfig(config: CursorAgentConfig): Result<void, string> {
  if (typeof config.extract !== "function") {
    return err("extract must be a function");
  }
  if (config.timeout < 0) {
    return err("timeout must be a non-negative number (milliseconds); use 0 for no limit");
  }
  return ok(undefined);
}
