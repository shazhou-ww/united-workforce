import type { StepContext } from "@united-workforce/protocol";

function formatStep(step: StepContext, stepNumber: number, includeContent: boolean): string {
  const lines = [
    `### Step ${stepNumber}: ${step.role}`,
    `Output: ${JSON.stringify(step.output)}`,
    `Agent: ${step.agent}`,
  ];

  if (includeContent && step.content !== null) {
    lines.push("");
    lines.push("#### Step Content");
    lines.push("");
    lines.push(step.content);
  }

  return lines.join("\n");
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

function selectStepsWithinQuota(steps: StepContext[], quota: number): StepContext[] {
  const selected: StepContext[] = [];
  let totalChars = 0;

  // Work backwards (newest first)
  for (let i = steps.length - 1; i >= 0; i--) {
    const step = steps[i];
    if (step === undefined) continue;

    // Estimate size: meta + content
    const metaSize = JSON.stringify({
      role: step.role,
      output: step.output,
      agent: step.agent,
    }).length;
    const contentSize = step.content?.length ?? 0;
    const stepSize = metaSize + contentSize;

    if (totalChars + stepSize > quota && selected.length > 0) {
      // Stop adding steps but keep at least 1
      break;
    }

    selected.unshift(step); // Keep chronological order
    totalChars += stepSize;

    if (totalChars >= quota) {
      break;
    }
  }

  return selected;
}

type BuildContinuationPromptOptions = {
  includeContent?: boolean;
  quota?: number;
};

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
  options?: BuildContinuationPromptOptions,
): string {
  const includeContent = options?.includeContent ?? false;
  const quota = options?.quota ?? Number.POSITIVE_INFINITY;

  const lastIndex = findLastRoleIndex(steps, role);
  const sinceSteps = lastIndex >= 0 ? steps.slice(lastIndex + 1) : steps;

  const parts: string[] = [];

  if (sinceSteps.length > 0) {
    parts.push("## What Happened Since Your Last Turn");
    const baseStepNumber = lastIndex >= 0 ? lastIndex + 2 : 1;

    // Select steps within quota (newest-first if includeContent = true)
    const selectedSteps = includeContent ? selectStepsWithinQuota(sinceSteps, quota) : sinceSteps;

    const skippedCount = sinceSteps.length - selectedSteps.length;
    if (skippedCount > 0) {
      parts.push("");
      parts.push(
        `_Showing ${selectedSteps.length} of ${sinceSteps.length} steps (${skippedCount} omitted due to quota)_`,
      );
    }

    for (let i = 0; i < selectedSteps.length; i++) {
      const step = selectedSteps[i];
      if (step === undefined) {
        continue;
      }
      parts.push("");
      parts.push(formatStep(step, baseStepNumber + i, includeContent));
    }
    parts.push("");
  }

  parts.push("## Moderator Instruction", "", edgePrompt);
  return parts.join("\n");
}
