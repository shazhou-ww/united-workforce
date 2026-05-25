// Re-export session cache from the shared agent-kit package with agent name injected.

import {
  getCachedSessionId as getCachedSessionIdBase,
  setCachedSessionId as setCachedSessionIdBase,
} from "@uncaged/workflow-util-agent";
import type { ThreadId } from "@uncaged/workflow-protocol";

export async function getCachedSessionId(threadId: ThreadId, role: string): Promise<string | null> {
  return getCachedSessionIdBase("hermes", threadId, role);
}

export async function setCachedSessionId(
  threadId: ThreadId,
  role: string,
  sessionId: string,
): Promise<void> {
  return setCachedSessionIdBase("hermes", threadId, role, sessionId);
}

export function isResumeDisabled(): boolean {
  // Hermes ACP session/resume is broken: _restore fails for custom providers
  // because resolve_runtime_provider("custom") throws and base_url/api_mode
  // are lost in the fallback path.  Resume silently creates a new session
  // (different sessionId, no history), causing empty-text responses.
  // See: https://github.com/NousResearch/hermes-agent/issues/13489
  // Disable by default until upstream fixes the bug.  Set UWF_HERMES_RESUME=1
  // to opt back in.
  const enableFlag = process.env.UWF_HERMES_RESUME;
  if (enableFlag === "1" || enableFlag === "true") {
    return false;
  }
  return true;
}
