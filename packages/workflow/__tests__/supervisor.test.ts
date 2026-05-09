import { afterEach, describe, expect, test } from "bun:test";

import { runSupervisor } from "../src/engine/supervisor.js";
import type { WorkflowConfig } from "../src/registry/index.js";
import type { LogFn } from "../src/util/index.js";

const noopLogger: LogFn = () => {};

function supervisorOnlyConfig(): WorkflowConfig {
  return {
    maxDepth: 3,
    supervisorInterval: 3,
    providers: {
      stub: { baseUrl: "http://127.0.0.1:9/v1", apiKey: "k" },
    },
    models: {
      extract: "stub/extract-model",
      supervisor: "stub/supervisor-model",
    },
  };
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(impl: (init?: RequestInit) => Promise<Response>): () => void {
  const origFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (_input: Parameters<typeof fetch>[0], init?: RequestInit) => impl(init),
    { preconnect: origFetch.preconnect.bind(origFetch) },
  ) as typeof fetch;
  return () => {
    globalThis.fetch = origFetch;
  };
}

describe("runSupervisor", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("returns continue when supervisor model cannot be resolved (no fetch)", async () => {
    restoreFetch = installFetchMock(async () => {
      throw new Error("fetch should not run when supervisor is not configured");
    });

    const config: WorkflowConfig = {
      maxDepth: 1,
      supervisorInterval: 3,
      providers: {
        stub: { baseUrl: "http://127.0.0.1:9/v1", apiKey: "k" },
      },
      models: {
        extract: "stub/m",
      },
    };

    const r = await runSupervisor({
      config,
      prompt: "task",
      recentSteps: [{ role: "planner", summary: "{}" }],
      logger: noopLogger,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value).toBe("continue");
  });

  test("returns stop from structured tool call", async () => {
    restoreFetch = installFetchMock(async () =>
      jsonResponse({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "t1",
                  type: "function",
                  function: {
                    name: "supervisor_decision",
                    arguments: JSON.stringify({ decision: "stop" }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );

    const r = await runSupervisor({
      config: supervisorOnlyConfig(),
      prompt: "do X",
      recentSteps: [{ role: "a", summary: "{}" }],
      logger: noopLogger,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value).toBe("stop");
  });

  test("returns continue from plain JSON content (reactor short-circuit)", async () => {
    restoreFetch = installFetchMock(async () =>
      jsonResponse({
        choices: [{ message: { content: '{"decision":"continue"}' } }],
      }),
    );

    const r = await runSupervisor({
      config: supervisorOnlyConfig(),
      prompt: "do Y",
      recentSteps: [],
      logger: noopLogger,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value).toBe("continue");
  });

  test("returns err when reactor cannot validate the schema within max rounds", async () => {
    restoreFetch = installFetchMock(async () =>
      jsonResponse({
        choices: [{ message: { content: "not-json" } }],
      }),
    );

    const r = await runSupervisor({
      config: supervisorOnlyConfig(),
      prompt: "p",
      recentSteps: [],
      logger: noopLogger,
    });
    expect(r.ok).toBe(false);
  });

  test("returns err on HTTP failure", async () => {
    restoreFetch = installFetchMock(async () => new Response("boom", { status: 500 }));

    const r = await runSupervisor({
      config: supervisorOnlyConfig(),
      prompt: "p",
      recentSteps: [],
      logger: noopLogger,
    });
    expect(r.ok).toBe(false);
  });
});
