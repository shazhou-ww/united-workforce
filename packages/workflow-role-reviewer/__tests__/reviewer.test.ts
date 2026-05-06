import { afterEach, describe, expect, mock, test } from "bun:test";

import type { AgentFn, ThreadContext } from "@uncaged/workflow";
import { START } from "@uncaged/workflow";

import { createReviewerRole, DEFAULT_REVIEWER_CONFIG } from "../src/reviewer.js";

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
    threadId: "01TEST000000000000000000TR",
    start: {
      role: START,
      content: "task",
      meta: { maxRounds: 10 },
      timestamp: Date.now(),
    },
    steps: [],
  };
}

const provider = { baseUrl: "https://example.com/v1", apiKey: "k", model: "m" };

describe("createReviewerRole", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    mock.restore();
  });

  test("approved verdict", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        toolCallResponse(JSON.stringify({ status: "approved" })),
      )) as unknown as typeof fetch;

    const agent: AgentFn = async (_ctx, prompt) => {
      expect(prompt).toContain("code reviewer");
      expect(prompt).toContain(DEFAULT_REVIEWER_CONFIG.cwd);
      return "review done";
    };

    const role = createReviewerRole(agent, {
      provider,
      dryRun: null,
      dryRunMeta: { status: "approved" },
    });
    const out = await role(makeCtx());
    expect(out.meta).toEqual({ status: "approved" });
  });

  test("rejected verdict with issues", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        toolCallResponse(JSON.stringify({ status: "rejected", issues: ["secrets in code"] })),
      )) as unknown as typeof fetch;

    const agent: AgentFn = async () => "found problems";

    const role = createReviewerRole(agent, {
      provider,
      dryRun: null,
      dryRunMeta: { status: "approved" },
    });
    const out = await role(makeCtx());
    expect(out.meta).toEqual({ status: "rejected", issues: ["secrets in code"] });
  });

  test("system prompt includes configured cwd (thread CLI hint comes from agent layer)", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        toolCallResponse(JSON.stringify({ status: "approved" })),
      )) as unknown as typeof fetch;

    let seen = "";
    const agent: AgentFn = async (_ctx, prompt) => {
      seen = prompt;
      return "x";
    };

    const role = createReviewerRole(
      agent,
      { provider, dryRun: null, dryRunMeta: { status: "approved" } },
      { cwd: "/proj" },
    );
    await role(makeCtx());
    expect(seen).toContain("/proj");
    expect(seen).toContain("code reviewer");
    expect(seen).not.toContain("uncaged-workflow thread");
  });
});
