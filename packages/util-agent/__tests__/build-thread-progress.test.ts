import type { StepContext, ThreadId } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";
import { buildThreadProgress } from "../src/build-thread-progress.js";

function makeStep(role: string): StepContext {
  return {
    role,
    output: {},
    detail: "0000000000000" as string,
    agent: "uwf-mock",
    edgePrompt: "",
    startedAtMs: 0,
    completedAtMs: 0,
    cwd: "",
    assembledPrompt: null,
    usage: null,
    content: null,
  };
}

const THREAD_ID = "06FBBPEG427CT3MMVB86AV8030" as ThreadId;

describe("buildThreadProgress", () => {
  test("first step of thread", () => {
    const result = buildThreadProgress([], "proponent");
    expect(result).toContain("## Thread Progress");
    expect(result).toContain("first step");
    expect(result).toContain("first time");
    expect(result).toContain("proponent");
  });

  test("second step, role not seen before", () => {
    const steps = [makeStep("opponent")];
    const result = buildThreadProgress(steps, "proponent");
    expect(result).toContain("Thread step 2");
    expect(result).toContain("spoken 0 times");
  });

  test("role has spoken once before", () => {
    const steps = [makeStep("proponent"), makeStep("opponent")];
    const result = buildThreadProgress(steps, "proponent");
    expect(result).toContain("Thread step 3");
    expect(result).toContain("spoken 1 time before");
    // singular "time" not "times"
    expect(result).not.toContain("1 times");
  });

  test("role has spoken multiple times", () => {
    const steps = [
      makeStep("proponent"),
      makeStep("opponent"),
      makeStep("proponent"),
      makeStep("opponent"),
      makeStep("proponent"),
      makeStep("opponent"),
    ];
    const result = buildThreadProgress(steps, "proponent");
    expect(result).toContain("Thread step 7");
    expect(result).toContain("spoken 3 times");
  });

  test("includes thread ID when provided", () => {
    const result = buildThreadProgress([], "proponent", THREAD_ID);
    expect(result).toContain(`Thread: ${THREAD_ID}`);
  });

  test("omits thread ID when not provided", () => {
    const result = buildThreadProgress([], "proponent");
    expect(result).not.toContain("Thread:");
  });
});
