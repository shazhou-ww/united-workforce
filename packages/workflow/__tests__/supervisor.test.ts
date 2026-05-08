import { afterEach, describe, expect, test } from "bun:test";

import { parseSupervisorDecisionText, runSupervisor } from "../src/engine/supervisor.js";
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

describe("parseSupervisorDecisionText", () => {
  test("reads continue and stop case-insensitively", () => {
    expect(parseSupervisorDecisionText("continue")).toBe("continue");
    expect(parseSupervisorDecisionText("CONTINUE")).toBe("continue");
    expect(parseSupervisorDecisionText("stop")).toBe("stop");
    expect(parseSupervisorDecisionText("STOP.")).toBe("stop");
  });

  test("finds token inside a sentence", () => {
    expect(parseSupervisorDecisionText("Answer: continue")).toBe("continue");
    expect(parseSupervisorDecisionText("I recommend stop now")).toBe("stop");
  });

  test("when both appear, earlier token wins", () => {
    expect(parseSupervisorDecisionText("continue then stop")).toBe("continue");
    expect(parseSupervisorDecisionText("stop then continue")).toBe("stop");
  });

  test("defaults to continue when unclear", () => {
    expect(parseSupervisorDecisionText("maybe later")).toBe("continue");
  });
});

describe("runSupervisor", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("returns continue when supervisor model cannot be resolved (no fetch)", async () => {
    const origFetch = globalThis.fetch;
    restoreFetch = () => {
      globalThis.fetch = origFetch;
    };
    globalThis.fetch = Object.assign(
      async () => {
        throw new Error("fetch should not run when supervisor is not configured");
      },
      { preconnect: origFetch.preconnect.bind(origFetch) },
    ) as typeof fetch;

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

  test("returns stop from chat/completions assistant content", async () => {
    const origFetch = globalThis.fetch;
    restoreFetch = () => {
      globalThis.fetch = origFetch;
    };
    globalThis.fetch = Object.assign(
      async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "stop" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      { preconnect: origFetch.preconnect.bind(origFetch) },
    ) as typeof fetch;

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

  test("returns err on invalid JSON body", async () => {
    const origFetch = globalThis.fetch;
    restoreFetch = () => {
      globalThis.fetch = origFetch;
    };
    globalThis.fetch = Object.assign(async () => new Response("not-json", { status: 200 }), {
      preconnect: origFetch.preconnect.bind(origFetch),
    }) as typeof fetch;

    const r = await runSupervisor({
      config: supervisorOnlyConfig(),
      prompt: "p",
      recentSteps: [],
      logger: noopLogger,
    });
    expect(r.ok).toBe(false);
  });
});
