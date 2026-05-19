import { isAbsolute } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import type { CursorAgentConfig } from "./types.js";

export function validateCursorAgentConfig(config: CursorAgentConfig): Result<void, string> {
  if (!isAbsolute(config.command)) {
    return err("command must be an absolute path to the cursor-agent CLI binary");
  }
  if (config.timeout < 0) {
    return err("timeout must be a non-negative number (milliseconds); use 0 for no limit");
  }
  if (config.workspace !== null && !isAbsolute(config.workspace)) {
    return err("workspace must be an absolute filesystem path when set");
  }
  return ok(undefined);
}
