import type { ExtractContext, ExtractFn, LlmProvider } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { type CasStore, getContentMerklePayload } from "../cas/index.js";
import { createLlmFn, createThreadReactor } from "../reactor/index.js";
import { extractFunctionToolFromZodSchema } from "./llm-extract.js";

export type ExtractDeps = {
  cas: CasStore;
};

const MAX_REACT_ROUNDS = 10;

const CAS_GET_TOOL_DEFINITION = {
  type: "function" as const,
  function: {
    name: "cas_get",
    description:
      "Read a Merkle DAG node from content-addressed storage by its hash. Returns YAML-formatted node with type, payload, and children fields.",
    parameters: {
      type: "object",
      properties: {
        hash: { type: "string", description: "The CAS hash to retrieve" },
      },
      required: ["hash"],
    },
  },
};

export type ExtractThreadContext = {
  cas: CasStore;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Builds the user-side extraction prompt (thread + agent output + instruction). */
export async function buildExtractUserContent(
  ctx: ExtractContext,
  prompt: string,
  deps: ExtractDeps,
): Promise<string> {
  const lines: string[] = [];
  lines.push(`## Role: ${ctx.currentRole.name}`);
  lines.push(ctx.currentRole.systemPrompt);
  lines.push("");
  lines.push("## Task");
  lines.push(ctx.start.content);
  lines.push("");
  if (ctx.steps.length > 0) {
    lines.push("## Thread History");
    for (const step of ctx.steps) {
      const body = await getContentMerklePayload(deps.cas, step.contentHash);
      if (body === null) {
        throw new Error(`extract: missing CAS blob for step ${step.role}: ${step.contentHash}`);
      }
      lines.push(`### ${step.role}`);
      lines.push(body);
      lines.push(`Meta: ${JSON.stringify(step.meta)}`);
      lines.push("");
    }
  }
  lines.push("## Agent Output");
  lines.push(ctx.agentContent);
  lines.push("");
  lines.push("## Extraction Instruction");
  lines.push(prompt);

  return lines.join("\n");
}

/**
 * Create an ExtractFn backed by an LLM provider.
 *
 * Internally runs a multi-turn ReAct loop with two tools (`cas_get` for traversing the
 * Merkle DAG and a schema-shaped extract tool); the loop also accepts a plain-JSON
 * assistant reply as a short-circuit, which covers the legacy "single" extraction path.
 */
export function createExtract(provider: LlmProvider, deps: ExtractDeps): ExtractFn {
  const llm = createLlmFn(provider);
  const reactor = createThreadReactor<ExtractThreadContext>({
    llm,
    maxRounds: MAX_REACT_ROUNDS,
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
      `You extract structured metadata from the agent output below. Use cas_get to read Merkle DAG nodes from CAS (YAML: type, payload, children) when the agent output references hashes you must traverse. When you have the complete structured object, call the ${structuredToolName} tool with JSON arguments matching the schema. You may instead reply with only a JSON object (no prose) when no tools are needed.`,
    toolHandler: async (call, thread) => {
      if (call.function.name !== "cas_get") {
        return `Unexpected tool routed to handler: ${call.function.name}`;
      }
      let hash: string;
      try {
        const ta = JSON.parse(call.function.arguments) as unknown;
        if (!isRecord(ta) || typeof ta.hash !== "string") {
          return 'cas_get requires a JSON object with a string "hash" field.';
        }
        hash = ta.hash;
      } catch {
        return 'cas_get arguments were not valid JSON. Provide {"hash": "<cas-hash>"}.';
      }
      const blob = await thread.cas.get(hash);
      return blob === null ? "null" : blob;
    },
  });

  return async <T extends Record<string, unknown>>(
    schema: z.ZodType<T>,
    prompt: string,
    ctx: ExtractContext,
  ): Promise<T> => {
    const text = await buildExtractUserContent(ctx, prompt, deps);
    const result = await reactor({
      thread: { cas: deps.cas },
      input: text,
      schema,
    });
    if (!result.ok) {
      throw new Error(`extract failed: ${result.error}`);
    }
    return result.value;
  };
}
