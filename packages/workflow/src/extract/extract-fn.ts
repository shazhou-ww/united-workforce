import type { ExtractContext, ExtractFn, LlmProvider } from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { type CasStore, getContentMerklePayload } from "../cas/index.js";
import { reactExtract } from "./react-extract.js";

export type ExtractDeps = {
  cas: CasStore;
};

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
 * Merkle DAG and a schema-shaped `extract` tool); the loop also accepts a plain-JSON
 * assistant reply as a short-circuit, which covers the legacy "single" extraction path.
 */
export function createExtract(provider: LlmProvider, deps: ExtractDeps): ExtractFn {
  return async <T extends Record<string, unknown>>(
    schema: z.ZodType<T>,
    prompt: string,
    ctx: ExtractContext,
  ): Promise<T> => {
    const text = await buildExtractUserContent(ctx, prompt, deps);
    const result = await reactExtract({ text, schema, provider, cas: deps.cas });
    if (!result.ok) {
      throw new Error(`extract failed: ${result.error}`);
    }
    return result.value;
  };
}
