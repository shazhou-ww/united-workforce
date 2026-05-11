import type { CasStore } from "@uncaged/workflow-cas";
import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
import type { LlmProvider } from "@uncaged/workflow-runtime";
import type { LogFn } from "@uncaged/workflow-util";
import * as z from "zod/v4";

import { extractFunctionToolFromZodSchema } from "../extract/index.js";

const SUMMARIZER_MAX_REACT_ROUNDS = 4;
const SUMMARIZER_RECENT_STEP_LIMIT = 20;

const summarySchema = z.object({ summary: z.string() }).meta({
  title: "workflow_summary",
  description: "A concise summary of the completed workflow's results and outcome.",
});

type SummarizerThreadContext = {
  cas: CasStore;
};

const CAS_GET_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "cas_get",
    description:
      "Read a Merkle DAG node from content-addressed storage by its hash. Returns YAML-formatted node with type, payload, and refs.",
    parameters: {
      type: "object",
      properties: {
        hash: { type: "string", description: "The CAS hash to retrieve" },
      },
      required: ["hash"],
    },
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
  const reactor = createThreadReactor<SummarizerThreadContext>({
    llm: createLlmFn(provider),
    maxRounds: SUMMARIZER_MAX_REACT_ROUNDS,
    staticTools: [CAS_GET_TOOL_DEFINITION],
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
      `You summarize completed workflow threads. You have access to cas_get to read step content by hash. After reviewing the steps, call the ${structuredToolName} tool with a concise summary of the workflow outcome and results. Or reply with only a JSON object such as {"summary":"..."}.`,
    toolHandler: async (call, thread) => {
      if (call.function.name !== "cas_get") {
        return `Unknown tool: ${call.function.name}`;
      }
      let hash: string;
      try {
        const ta = JSON.parse(call.function.arguments) as unknown;
        if (!isRecord(ta) || typeof ta.hash !== "string") {
          return 'cas_get requires {"hash": "<cas-hash>"}.';
        }
        hash = ta.hash;
      } catch {
        return "cas_get arguments were not valid JSON.";
      }
      const blob = await thread.cas.get(hash);
      return blob === null ? "null" : blob;
    },
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
