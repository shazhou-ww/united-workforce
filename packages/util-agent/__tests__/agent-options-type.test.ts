import type { Store } from "@ocas/core";
import { describe, expect, test } from "vitest";

import type {
  AgentCleanupFn,
  AgentContext,
  AgentContinueFn,
  AgentForkFn,
  AgentOptions,
  AgentRunFn,
} from "../src/types.js";

const makeRun: AgentRunFn = async (_ctx: AgentContext) => ({
  output: "",
  detailHash: "",
  sessionId: "",
  assembledPrompt: "",
  usage: null,
});

const makeContinue: AgentContinueFn = async (_sessionId, _message, _store) => ({
  output: "",
  detailHash: "",
  sessionId: "",
  assembledPrompt: "",
  usage: null,
});

describe("AgentOptions fork/cleanup", () => {
  test("AgentOptions accepts fork and cleanup as null", () => {
    const opts: AgentOptions = {
      name: "test",
      run: makeRun,
      continue: makeContinue,
      fork: null,
      cleanup: null,
    };
    expect(opts.name).toBe("test");
    expect(opts.run).toBe(makeRun);
    expect(opts.continue).toBe(makeContinue);
    expect(opts.fork).toBeNull();
    expect(opts.cleanup).toBeNull();
  });

  test("AgentOptions accepts real fork and cleanup functions", () => {
    const fork: AgentForkFn = async (sessionId, _store) => `${sessionId}-forked`;
    const cleanup: AgentCleanupFn = async () => {
      /* no-op */
    };
    const opts: AgentOptions = {
      name: "test",
      run: makeRun,
      continue: makeContinue,
      fork,
      cleanup,
    };
    expect(typeof opts.fork).toBe("function");
    expect(typeof opts.cleanup).toBe("function");
  });

  test("AgentForkFn signature accepts (sessionId: string, store: Store) and returns Promise<string>", async () => {
    const fork: AgentForkFn = async (sessionId, _store) => `${sessionId}-child`;
    // Cast a placeholder Store — only the signature shape matters for this test.
    const fakeStore = {} as Store;
    const result = await fork("session-abc", fakeStore);
    expect(result).toBe("session-abc-child");
  });

  test("AgentCleanupFn signature accepts no args and returns Promise<void>", async () => {
    let called = false;
    const cleanup: AgentCleanupFn = async () => {
      called = true;
    };
    const result = await cleanup();
    expect(result).toBeUndefined();
    expect(called).toBe(true);
  });
});
