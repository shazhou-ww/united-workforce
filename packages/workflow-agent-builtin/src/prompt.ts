import { type AgentContext, buildRolePrompt } from "@uncaged/workflow-agent-kit";

function buildHistorySummary(steps: AgentContext["steps"]): string {
  if (steps.length === 0) {
    return "";
  }

  const lines: string[] = ["## Previous Steps"];
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === undefined) {
      continue;
    }
    lines.push("");
    lines.push(`### Step ${i + 1}: ${step.role}`);
    lines.push(`Output: ${JSON.stringify(step.output)}`);
    lines.push(`Agent: ${step.agent}`);
  }
  return lines.join("\n");
}

export type BuiltinPromptParts = {
  system: string;
  user: string;
};

/** Assemble system prompt (role + format) and user prompt (task + edge + history). */
export function buildBuiltinPrompt(ctx: AgentContext): BuiltinPromptParts {
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  const systemParts: string[] = [];
  if (ctx.outputFormatInstruction !== "") {
    systemParts.push(ctx.outputFormatInstruction, "");
  }
  systemParts.push(rolePrompt);

  const userParts: string[] = ["## Task", ctx.start.prompt];
  if (ctx.edgePrompt !== "") {
    userParts.push("", "## Current Step Instruction", ctx.edgePrompt);
  }
  const historyBlock = buildHistorySummary(ctx.steps);
  if (historyBlock !== "") {
    userParts.push("", historyBlock);
  }

  return {
    system: systemParts.join("\n"),
    user: userParts.join("\n"),
  };
}
