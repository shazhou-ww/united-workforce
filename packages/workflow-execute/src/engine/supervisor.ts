import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
import type { WorkflowConfig } from "@uncaged/workflow-register";
import { resolveModel } from "@uncaged/workflow-register";
import { err, type LogFn, ok, type Result } from "@uncaged/workflow-util";
import * as z from "zod/v4";
import { extractFunctionToolFromZodSchema } from "../extract/index.js";

import type { SupervisorDecision } from "./types.js";

const SUPERVISOR_RECENT_STEP_LIMIT = 12;
const SUPERVISOR_MAX_REACT_ROUNDS = 4;

const supervisorDecisionSchema = z
  .object({
    decision: z.enum(["continue", "stop"]),
  })
  .meta({
    title: "supervisor_decision",
    description:
      'Workflow supervisor decision. "continue" when the thread is making progress; "stop" when done, looping, or stuck.',
  });

type SupervisorThreadContext = Record<string, never>;

type RunSupervisorArgs = {
  config: WorkflowConfig;
  prompt: string;
  recentSteps: readonly { role: string; summary: string }[];
  logger: LogFn;
};

function buildSupervisorInput(args: RunSupervisorArgs): string {
  const recent = args.recentSteps.slice(-SUPERVISOR_RECENT_STEP_LIMIT);
  const stepsBlock = recent.map((s, index) => `${index + 1}. [${s.role}] ${s.summary}`).join("\n");
  return `Original task:\n${args.prompt}\n\nRecent steps (oldest first):\n${stepsBlock === "" ? "(none)" : stepsBlock}`;
}

/** Calls the `supervisor` scene via {@link createThreadReactor}; opt-out when {@link resolveModel} fails (returns ok(`continue`)). */
export async function runSupervisor(
  args: RunSupervisorArgs,
): Promise<Result<SupervisorDecision, string>> {
  const resolved = resolveModel(args.config, "supervisor");
  if (!resolved.ok) {
    return ok("continue");
  }

  const reactor = createThreadReactor<SupervisorThreadContext>({
    llm: createLlmFn(resolved.value),
    maxRounds: SUPERVISOR_MAX_REACT_ROUNDS,
    staticTools: [],
    structuredToolFromSchema: (schema) => {
      const t = extractFunctionToolFromZodSchema(schema);
      return {
        name: t.name,
        tool: {
          type: "function" as const,
          function: {
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          },
        },
      };
    },
    systemPromptForStructuredTool: (structuredToolName) =>
      `You supervise a multi-step workflow. Decide whether the thread should keep running or halt. Reply with "continue" when the thread is making progress toward the task, or "stop" when it is finished, looping, or no longer making progress. Call the ${structuredToolName} tool with JSON arguments matching the schema, or reply with only a JSON object such as {"decision":"stop"}.`,
    toolHandler: async (call) => `Unknown tool: ${call.function.name}`,
  });

  const result = await reactor({
    thread: {} as SupervisorThreadContext,
    input: buildSupervisorInput(args),
    schema: supervisorDecisionSchema,
  });

  if (!result.ok) {
    args.logger("R9CW4PHM", `supervisor failed: ${result.error}`);
    return err(`supervisor: ${result.error}`);
  }

  const decision: SupervisorDecision = result.value.decision;
  args.logger("Z8KM5QWT", `supervisor says ${decision}`);
  return ok(decision);
}
