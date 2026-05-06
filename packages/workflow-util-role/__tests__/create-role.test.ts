import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import type { AgentFn, ThreadContext } from "@uncaged/workflow";
import { START } from "@uncaged/workflow";
import * as extractMetaModule from "@uncaged/workflow-util-role";
import * as z from "zod/v4";

import { createRole } from "../src/create-role.js";

const provider = {
  baseUrl: "https://example.com/v1",
  apiKey: "k",
  model: "m",
};

function toolCallResponse(argsJson: string): Response {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            tool_calls: [
              {
                function: {
                  name: "extract",
                  arguments: argsJson,
                },
              },
            ],
          },
        },
      ],
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

function makeCtx(): ThreadContext {
  return {
    start: {
      role: START,
      content: "",
      meta: { maxRounds: 10 },
      timestamp: Date.now(),
    },
      steps: [],
      threadId: "01TEST000000000000000000TR",
  };
}

describe("createRole", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("runs AgentFn then structured extract", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(toolCallResponse(JSON.stringify({ n: 3 })))) as unknown as typeof fetch;

    const schema = z.object({ n: z.number() });
    const agent: AgentFn = async (_ctx, prompt) => prompt;
    const role = createRole({
      name: "test",
      schema,
      systemPrompt: "hello",
      agent,
      extract: { provider, dryRun: null, dryRunMeta: { n: 0 } },
    });

    const out = await role(makeCtx());
    expect(out.content).toBe("hello");
    expect(out.meta).toEqual({ n: 3 });
  });

  test("passes ThreadContext to AgentFn", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(toolCallResponse(JSON.stringify({ n: 0 })))) as unknown as typeof fetch;

    const seen: ThreadContext[] = [];
    const agent: AgentFn = async (ctx, _prompt) => {
      seen.push(ctx);
      return "x";
    };
    const role = createRole({
      name: "test",
      schema: z.object({ n: z.number() }),
      systemPrompt: "p",
      agent,
      extract: { provider, dryRun: null, dryRunMeta: { n: 0 } },
    });
    await role(makeCtx());

    expect(seen).toHaveLength(1);
    expect(seen[0].steps).toEqual([]);
  });

  test("resolves dynamic systemPrompt functions before AgentFn", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(toolCallResponse(JSON.stringify({ n: 99 })))) as unknown as typeof fetch;

    const schema = z.object({ n: z.number() });
    const agent: AgentFn = async (_ctx, prompt) => prompt;
    const role = createRole({
      name: "test",
      schema,
      systemPrompt: async (ctx) => `rounds=${ctx.steps.length}`,
      agent,
      extract: { provider, dryRun: null, dryRunMeta: { n: 0 } },
    });

    const ctx = makeCtx();
    const out = await role(ctx);
    expect(out.content).toBe("rounds=0");
    expect(out.meta).toEqual({ n: 99 });
  });

  test("extract dryRun null runs live extract path", async () => {
    const spy = spyOn(extractMetaModule, "extractMetaOrThrow").mockResolvedValue({ n: 0 });

    const agent: AgentFn = async () => "raw";
    const role = createRole({
      name: "r1",
      schema: z.object({ n: z.number() }),
      systemPrompt: "p",
      agent,
      extract: { provider, dryRun: null, dryRunMeta: { n: 0 } },
    });
    await role(makeCtx());

    expect(spy).toHaveBeenCalledWith(
      "r1",
      "raw",
      expect.anything(),
      expect.objectContaining({ provider, dryRun: false, dryRunMeta: { n: 0 } }),
    );
  });

  test("extract.dryRun true uses structured extract dry-run", async () => {
    const spy = spyOn(extractMetaModule, "extractMetaOrThrow").mockResolvedValue({ n: 0 });

    const agent: AgentFn = async () => "raw";
    const role = createRole({
      name: "r2",
      schema: z.object({ n: z.number() }),
      systemPrompt: "p",
      agent,
      extract: { provider, dryRun: true, dryRunMeta: { n: 0 } },
    });
    await role(makeCtx());

    expect(spy).toHaveBeenCalledWith(
      "r2",
      "raw",
      expect.anything(),
      expect.objectContaining({ dryRun: true, dryRunMeta: { n: 0 } }),
    );
  });
});
