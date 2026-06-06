import type { StepContext } from "@united-workforce/protocol";

/**
 * Build a compact thread-progress summary so the agent knows where it is
 * in the conversation without making tool calls to count steps.
 *
 * Example output:
 *   ## Thread Progress
 *   Thread step 6. You (proponent) have spoken 2 times before this turn.
 */
export function buildThreadProgress(steps: StepContext[], role: string): string {
  const totalSteps = steps.length;
  const roleVisits = steps.filter((s) => s.role === role).length;

  const parts = [`## Thread Progress`];
  if (totalSteps === 0) {
    parts.push(
      `This is the first step of the thread. You (${role}) are speaking for the first time.`,
    );
  } else {
    parts.push(
      `Thread step ${totalSteps + 1}. You (${role}) have spoken ${roleVisits} time${roleVisits === 1 ? "" : "s"} before this turn.`,
    );
  }

  return parts.join("\n");
}
