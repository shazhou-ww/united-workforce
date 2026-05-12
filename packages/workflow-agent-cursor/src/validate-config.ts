import { isAbsolute } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow-protocol";

import type { CursorAgentConfig } from "./types.js";

export function validateCursorAgentConfig(config: CursorAgentConfig): Result<void, string> {
  if (!isAbsolute(config.command)) {
    return err("command must be an absolute path to the cursor-agent CLI binary");
  }
  if (config.workspace !== null && config.workspace.length === 0) {
    return err("workspace must be a non-empty string (absolute path) or null for auto-detection");
  }
  if (config.workspace === null && config.llmProvider === null) {
    return err("llmProvider is required when workspace is null (needed for workspace extraction)");
  }
  if (config.timeout < 0) {
    return err("timeout must be a non-negative number (milliseconds); use 0 for no limit");
  }
  return ok(undefined);
}
