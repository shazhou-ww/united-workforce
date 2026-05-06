import { err, ok, type Result } from "@uncaged/workflow";

import type { HermesAgentConfig } from "./types.js";

export function validateHermesAgentConfig(config: HermesAgentConfig): Result<void, string> {
  if (config.timeout !== null && config.timeout < 0) {
    return err("timeout must be null or a non-negative number (milliseconds)");
  }
  return ok(undefined);
}
