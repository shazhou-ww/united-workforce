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

  test("runs reviewer extract", async () => {
    globalThis.fetch = () => Promise.resolve(toolCallResponse(JSON.stringify({ approved: true })));

    const agent: AgentFn = async (_ctx, prompt) => {
      expect(prompt).toContain("git diff");
      expect(prompt).toContain(DEFAULT_REVIEWER_CONFIG.cwd);
      return "review done";
    };

    const role = createReviewerRole(agent, { provider, dryRun: null });
    const out = await role(makeCtx());
    expect(out.meta).toEqual({ approved: true });
  });

  test("includes uncaged-workflow thread hint when threadId set", async () => {
    globalThis.fetch = () => Promise.resolve(toolCallResponse(JSON.stringify({ approved: false })));

    let seen = "";
    const agent: AgentFn = async (_ctx, prompt) => {
      seen = prompt;
      return "x";
    };

    const role = createReviewerRole(
      agent,
      { provider, dryRun: null },
      {
        cwd: "/proj",
        conventionsPath: null,
        extraChecks: [],
        threadId: "01ABCDEF234567890ABCDEFGH",
      },
    );
    await role(makeCtx());
    expect(seen).toContain("uncaged-workflow thread 01ABCDEF234567890ABCDEFGH");
  });
});
