// Re-export session cache from the shared agent-kit package with agent name injected.

import type { ThreadId } from "@united-workforce/protocol";
import {
  getCachedSessionId as getCachedSessionIdBase,
  setCachedSessionId as setCachedSessionIdBase,
} from "@united-workforce/util-agent";

export async function getCachedSessionId(
  threadId: ThreadId,
  role: string,
  storageRoot: string,
): Promise<string | null> {
  return getCachedSessionIdBase("hermes", threadId, role, storageRoot);
}

export async function setCachedSessionId(
  threadId: ThreadId,
  role: string,
  sessionId: string,
  storageRoot: string,
): Promise<void> {
  return setCachedSessionIdBase("hermes", threadId, role, sessionId, storageRoot);
}

/**
 * Decide whether Hermes session resume is disabled, given the raw
 * `UWF_HERMES_RESUME` flag (read by the CLI entry point — library code must
 * not read `process.env`).
 *
 * Hermes ACP session/resume is broken: _restore fails for custom providers
 * because resolve_runtime_provider("custom") throws and base_url/api_mode
 * are lost in the fallback path.  Resume silently creates a new session
 * (different sessionId, no history), causing empty-text responses.
 * See: https://github.com/NousResearch/hermes-agent/issues/13489
 * Disable by default until upstream fixes the bug.  Set UWF_HERMES_RESUME=1
 * to opt back in.
 */
export function isResumeDisabled(resumeFlag: string | null): boolean {
  if (resumeFlag === "1" || resumeFlag === "true") {
    return false;
  }
  return true;
}
