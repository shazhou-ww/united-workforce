import { isAbsolute } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow-runtime";

import type { HermesAgentConfig } from "./types.js";

export function validateHermesAgentConfig(config: HermesAgentConfig): Result<void, string> {
  if (!isAbsolute(config.command)) {
    return err("command must be an absolute path to the hermes CLI binary");
  }
  if (config.timeout !== null && config.timeout < 0) {
    return err("timeout must be null or a non-negative number (milliseconds)");
  }
  return ok(undefined);
}
