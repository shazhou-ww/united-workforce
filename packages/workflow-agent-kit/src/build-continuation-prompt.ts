import type { StepContext } from "@uncaged/workflow-protocol";

function formatStep(step: StepContext, stepNumber: number): string {
  return [
    `### Step ${stepNumber}: ${step.role}`,
    `Output: ${JSON.stringify(step.output)}`,
    `Agent: ${step.agent}`,
  ].join("\n");
}

function findLastRoleIndex(steps: StepContext[], role: string): number {
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step !== undefined && step.role === role) {
      return i;
    }
  }
  return -1;
}

/**
 * Build a continuation prompt for a role re-entry.
 *
 * Finds the most recent step for `role`, collects everything after it as context,
 * and appends the moderator edge prompt as the instruction.
 */
export function buildContinuationPrompt(
  steps: StepContext[],
  role: string,
  edgePrompt: string,
): string {
  const lastIndex = findLastRoleIndex(steps, role);
  const sinceSteps = lastIndex >= 0 ? steps.slice(lastIndex + 1) : steps;

  const parts: string[] = [];

  if (sinceSteps.length > 0) {
    parts.push("## What Happened Since Your Last Turn");
    const baseStepNumber = lastIndex >= 0 ? lastIndex + 2 : 1;
    for (let i = 0; i < sinceSteps.length; i++) {
      const step = sinceSteps[i];
      if (step === undefined) {
        continue;
      }
      parts.push("");
      parts.push(formatStep(step, baseStepNumber + i));
    }
    parts.push("");
  }

  parts.push("## Moderator Instruction", "", edgePrompt);
  return parts.join("\n");
}
