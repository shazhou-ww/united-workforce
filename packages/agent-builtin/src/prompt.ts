import { type AgentContext, buildRolePrompt } from "@united-workforce/util-agent";

import type { ChatMessage } from "./llm/index.js";

type StepContext = AgentContext["steps"][number];

function formatStep(step: StepContext, stepNumber: number): string {
  return [
    `### Step ${stepNumber}: ${step.role}`,
    `Output: ${JSON.stringify(step.output)}`,
    `Agent: ${step.agent}`,
  ].join("\n");
}

function buildStepsSummary(steps: StepContext[], fromIndex: number, toIndex: number): string {
  if (fromIndex >= toIndex) {
    return "";
  }

  const lines: string[] = ["## What Happened Since Your Last Turn"];
  for (let i = fromIndex; i < toIndex; i++) {
    const step = steps[i];
    if (step === undefined) {
      continue;
    }
    lines.push("");
    lines.push(formatStep(step, i + 1));
  }
  return lines.join("\n");
}

function buildUserTurnContent(edgePrompt: string, summary: string): string {
  const parts: string[] = [];
  if (edgePrompt !== "") {
    parts.push(edgePrompt);
  }
  if (summary !== "") {
    if (parts.length > 0) {
      parts.push("");
    }
    parts.push(summary);
  }
  return parts.join("\n");
}

/**
 * Reconstruct multi-turn chat messages from thread history for cache-friendly session resume.
 *
 * - system: role prompt + output format (stable prefix)
 * - For each prior visit of this role: user (edgePrompt + inter-step summary) + assistant (output JSON)
 * - Final user: current edgePrompt + summary since last visit of this role
 */
export function buildBuiltinMessages(ctx: AgentContext): ChatMessage[] {
  const roleDef = ctx.workflow.roles[ctx.role];
  const rolePrompt = roleDef !== undefined ? buildRolePrompt(roleDef) : "";
  const systemParts: string[] = [];
  if (ctx.outputFormatInstruction !== "") {
    systemParts.push(ctx.outputFormatInstruction, "");
  }
  systemParts.push(rolePrompt);

  systemParts.push(
    "",
    "## Workflow",
    "",
    `Your working directory is: ${process.cwd()}`,
    "",
    "You have tools available (read_file, write_file, run_command). " +
      "Use them to complete your task — read files, run commands, make changes as needed. " +
      "Your task is described in the user message below — do NOT use uwf or workflow CLI commands to discover your task. " +
      "When you are done, output your final response with the YAML frontmatter block as specified above. " +
      "Do NOT output the frontmatter until you have completed all necessary work. " +
      "If you are running low on turns and cannot finish, output the frontmatter with `$status: failed` and explain what remains in the body. " +
      "CRITICAL: Your final output MUST start with the `---` fence on the very first line — " +
      "no preamble text, no explanation before it. The parser requires `---` at position 0.",
  );

  const messages: ChatMessage[] = [{ role: "system", content: systemParts.join("\n") }];

  const roleVisitIndices: number[] = [];
  for (let i = 0; i < ctx.steps.length; i++) {
    const step = ctx.steps[i];
    if (step !== undefined && step.role === ctx.role) {
      roleVisitIndices.push(i);
    }
  }

  let prevVisitIndex = -1;
  for (const visitIndex of roleVisitIndices) {
    const visitStep = ctx.steps[visitIndex];
    if (visitStep === undefined) {
      continue;
    }

    const summary = buildStepsSummary(ctx.steps, prevVisitIndex + 1, visitIndex);
    messages.push({
      role: "user",
      content: buildUserTurnContent(visitStep.edgePrompt, summary),
    });
    messages.push({
      role: "assistant",
      content: JSON.stringify(visitStep.output),
      tool_calls: null,
    });
    prevVisitIndex = visitIndex;
  }

  const finalSummary = buildStepsSummary(ctx.steps, prevVisitIndex + 1, ctx.steps.length);
  messages.push({
    role: "user",
    content: buildUserTurnContent(ctx.edgePrompt, finalSummary),
  });

  return messages;
}
