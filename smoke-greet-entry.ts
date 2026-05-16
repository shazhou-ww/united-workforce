/**
 * greet workflow — smoke test entry
 * Single role: greeter takes a prompt and returns a structured greeting.
 * 小橘 🍊
 */

import type {
  AdapterFn,
  ModeratorTable,
  RoleFn,
  RoleResult,
  ThreadContext,
  WorkflowDefinition,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import { createWorkflow, END, START } from "@uncaged/workflow-runtime";
import * as z from "zod/v4";

type GreetMeta = {
  greeter: { greeting: string; language: string };
};

const greeterSchema = z.object({
  greeting: z.string().describe("A friendly greeting message"),
  language: z.string().describe("The language of the greeting"),
});

const roles: WorkflowDefinition<GreetMeta>["roles"] = {
  greeter: {
    description: "Generates a friendly greeting",
    systemPrompt:
      "You are a friendly greeter. Given a user prompt, produce a warm greeting. Respond in valid JSON with keys: greeting (string), language (string).",
    schema: greeterSchema,
  },
};

const table: ModeratorTable<GreetMeta> = {
  [START]: [{ condition: "FALLBACK", role: "greeter" }],
  greeter: [{ condition: "FALLBACK", role: END }],
};

export const descriptor = {
  name: "greet",
  description: "A simple greeting workflow for smoke testing",
  graph: { [START]: ["greeter"], greeter: [END] },
  roles: { greeter: { description: "Generates a friendly greeting" } },
};

function createLazyAdapter(): AdapterFn {
  let cached: { baseUrl: string; apiKey: string; model: string } | null = null;
  function getProvider() {
    if (cached !== null) return cached;
    const apiKey = process.env.DASHSCOPE_API_KEY;
    if (!apiKey) throw new Error("missing env: DASHSCOPE_API_KEY");
    cached = {
      baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      apiKey,
      model: process.env.WORKFLOW_MODEL ?? "qwen-plus",
    };
    return cached;
  }

  return (<T>(prompt: string, schema: z.ZodType<T>): RoleFn<T> => {
    return async (ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const provider = getProvider();
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${provider.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: provider.model,
          messages: [
            { role: "system", content: prompt },
            {
              role: "user",
              content: `${ctx.start.content}\n\nRespond with JSON: ${JSON.stringify(z.toJSONSchema(schema))}`,
            },
          ],
          response_format: { type: "json_object" },
        }),
      });
      if (!response.ok) {
        const body = await response.text();
        throw new Error(`LLM error ${response.status}: ${body.slice(0, 500)}`);
      }
      const data = (await response.json()) as { choices: Array<{ message: { content: string } }> };
      const text = data.choices[0]?.message?.content;
      if (!text) throw new Error("Empty LLM response");
      const parsed = schema.parse(JSON.parse(text));
      return { meta: parsed, childThread: null };
    };
  }) as AdapterFn;
}

export const run = createWorkflow<GreetMeta>(
  { roles, table },
  { adapter: createLazyAdapter(), overrides: null },
);
