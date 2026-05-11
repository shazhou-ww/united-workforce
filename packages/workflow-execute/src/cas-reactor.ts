import type { CasStore } from "@uncaged/workflow-cas";
import type { ThreadReactorFn } from "@uncaged/workflow-reactor";
import { createLlmFn, createThreadReactor } from "@uncaged/workflow-reactor";
import type { LlmProvider } from "@uncaged/workflow-runtime";

import { extractFunctionToolFromZodSchema } from "./extract/index.js";

export type CasReactorThread = {
  cas: CasStore;
};

const CAS_GET_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "cas_get",
    description:
      "Read a Merkle DAG node from content-addressed storage by its hash. Returns YAML-formatted node with type, payload, and refs or children fields (content nodes use refs).",
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

export type CasReactorOpts = {
  maxRounds: number;
  systemPromptForStructuredTool: (structuredToolName: string) => string;
};

export function createCasReactor(
  provider: LlmProvider,
  cas: CasStore,
  opts: CasReactorOpts,
): ThreadReactorFn<CasReactorThread> {
  return createThreadReactor<CasReactorThread>({
    llm: createLlmFn(provider),
    maxRounds: opts.maxRounds,
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
    systemPromptForStructuredTool: opts.systemPromptForStructuredTool,
    toolHandler: async (call, _thread) => {
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
      const blob = await cas.get(hash);
      return blob === null ? "null" : blob;
    },
  });
}
