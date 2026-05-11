import type { CasStore } from "@uncaged/workflow-cas";
import type { LlmProvider } from "@uncaged/workflow-runtime";
import type { LogFn } from "@uncaged/workflow-util";
import * as z from "zod/v4";

import { createCasReactor } from "../cas-reactor.js";

const SUMMARIZER_MAX_REACT_ROUNDS = 4;
const SUMMARIZER_RECENT_STEP_LIMIT = 20;

const summarySchema = z.object({ summary: z.string() }).meta({
  title: "workflow_summary",
  description: "A concise summary of the completed workflow's results and outcome.",
});

function buildSummarizerInput(args: {
  prompt: string;
  recentSteps: readonly { role: string; contentHash: string }[];
}): string {
  const recent = args.recentSteps.slice(-SUMMARIZER_RECENT_STEP_LIMIT);
  const stepsBlock = recent
    .map((s, i) => `${i + 1}. [${s.role}] contentHash: ${s.contentHash}`)
    .join("\n");
  return `Original task:\n${args.prompt}\n\nCompleted steps (oldest first):\n${stepsBlock === "" ? "(none)" : stepsBlock}\n\nUse cas_get to read step content if needed. Summarize the workflow outcome concisely.`;
}

export type SummarizeFn = (args: {
  prompt: string;
  recentSteps: readonly { role: string; contentHash: string }[];
  fallback: string;
  logger: LogFn;
}) => Promise<string>;

export function createSummarizer(provider: LlmProvider, cas: CasStore): SummarizeFn {
  const reactor = createCasReactor(provider, cas, {
    maxRounds: SUMMARIZER_MAX_REACT_ROUNDS,
    systemPromptForStructuredTool: (structuredToolName) =>
      `You summarize completed workflow threads. You have access to cas_get to read step content by hash. After reviewing the steps, call the ${structuredToolName} tool with a concise summary of the workflow outcome and results. Or reply with only a JSON object such as {"summary":"..."}.`,
  });

  return async (args) => {
    const result = await reactor({
      thread: { cas },
      input: buildSummarizerInput(args),
      schema: summarySchema,
    });
    if (!result.ok) {
      args.logger("P2WX7KNR", `summarizer failed: ${result.error}`);
      return args.fallback;
    }
    args.logger("Q5MT3VBF", "summarizer produced workflow summary");
    return result.value.summary;
  };
}
