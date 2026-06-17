import { describe, expect, test } from "vitest";
import type { StepCompletePayload, StepStartPayload, TurnNodePayload } from "../types.js";

describe("Turn Chain Protocol Types (Phase 1)", () => {
  describe("StepStartPayload", () => {
    test("has all required fields", () => {
      const payload: StepStartPayload = {
        role: "planner",
        edgePrompt: "Analyze the issue",
        stepIndex: 0,
        prev: null,
        start: "0123456789ABC",
        startedAtMs: 1000,
        cwd: "/repo",
      };

      expect(payload.role).toBe("planner");
      expect(payload.edgePrompt).toBe("Analyze the issue");
      expect(payload.stepIndex).toBe(0);
      expect(payload.prev).toBeNull();
      expect(payload.start).toBe("0123456789ABC");
      expect(payload.startedAtMs).toBe(1000);
      expect(payload.cwd).toBe("/repo");
    });

    test("prev field accepts CasRef for chained steps", () => {
      const payload: StepStartPayload = {
        role: "developer",
        edgePrompt: "Implement the fix",
        stepIndex: 1,
        prev: "PREV012345678",
        start: "0123456789ABC",
        startedAtMs: 2000,
        cwd: "/repo",
      };

      expect(payload.prev).toBe("PREV012345678");
    });

    test("all fields are JSON-serializable", () => {
      const payload: StepStartPayload = {
        role: "tester",
        edgePrompt: "Run the tests",
        stepIndex: 2,
        prev: "ABC0123456789",
        start: "DEF0123456789",
        startedAtMs: Date.now(),
        cwd: "/home/user/project",
      };

      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized) as StepStartPayload;

      expect(deserialized.role).toBe(payload.role);
      expect(deserialized.edgePrompt).toBe(payload.edgePrompt);
      expect(deserialized.stepIndex).toBe(payload.stepIndex);
      expect(deserialized.prev).toBe(payload.prev);
      expect(deserialized.start).toBe(payload.start);
      expect(deserialized.startedAtMs).toBe(payload.startedAtMs);
      expect(deserialized.cwd).toBe(payload.cwd);
    });
  });

  describe("StepCompletePayload", () => {
    test("has all required fields", () => {
      const payload: StepCompletePayload = {
        startRef: "START01234567",
        output: "OUTPUT0123456",
        detail: "DETAIL0123456",
        completedAtMs: 3000,
        usage: null,
        previousAttempts: null,
      };

      expect(payload.startRef).toBe("START01234567");
      expect(payload.output).toBe("OUTPUT0123456");
      expect(payload.detail).toBe("DETAIL0123456");
      expect(payload.completedAtMs).toBe(3000);
      expect(payload.usage).toBeNull();
      expect(payload.previousAttempts).toBeNull();
    });

    test("usage field accepts Usage object", () => {
      const payload: StepCompletePayload = {
        startRef: "START01234567",
        output: "OUTPUT0123456",
        detail: "DETAIL0123456",
        completedAtMs: 3000,
        usage: {
          turns: 5,
          inputTokens: 1000,
          outputTokens: 500,
          duration: 12.5,
        },
        previousAttempts: null,
      };

      expect(payload.usage).not.toBeNull();
      expect(payload.usage?.turns).toBe(5);
      expect(payload.usage?.inputTokens).toBe(1000);
      expect(payload.usage?.outputTokens).toBe(500);
      expect(payload.usage?.duration).toBe(12.5);
    });

    test("previousAttempts field accepts array of CasRef", () => {
      const payload: StepCompletePayload = {
        startRef: "START01234567",
        output: "OUTPUT0123456",
        detail: "DETAIL0123456",
        completedAtMs: 3000,
        usage: null,
        previousAttempts: ["FAIL001234567", "FAIL002345678"],
      };

      expect(payload.previousAttempts).toHaveLength(2);
      expect(payload.previousAttempts?.[0]).toBe("FAIL001234567");
      expect(payload.previousAttempts?.[1]).toBe("FAIL002345678");
    });

    test("all fields are JSON-serializable", () => {
      const payload: StepCompletePayload = {
        startRef: "START01234567",
        output: "OUTPUT0123456",
        detail: "DETAIL0123456",
        completedAtMs: Date.now(),
        usage: {
          turns: 3,
          inputTokens: 500,
          outputTokens: 250,
          duration: 5.0,
        },
        previousAttempts: ["FAIL001234567"],
      };

      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized) as StepCompletePayload;

      expect(deserialized.startRef).toBe(payload.startRef);
      expect(deserialized.output).toBe(payload.output);
      expect(deserialized.detail).toBe(payload.detail);
      expect(deserialized.completedAtMs).toBe(payload.completedAtMs);
      expect(deserialized.usage).toEqual(payload.usage);
      expect(deserialized.previousAttempts).toEqual(payload.previousAttempts);
    });
  });

  describe("TurnNodePayload", () => {
    test("has all required fields", () => {
      const payload: TurnNodePayload = {
        role: "assistant",
        content: "Step 1 analysis",
        prev: null,
        owner: null,
      };

      expect(payload.role).toBe("assistant");
      expect(payload.content).toBe("Step 1 analysis");
      expect(payload.prev).toBeNull();
      expect(payload.owner).toBeNull();
    });

    test("prev field accepts CasRef for chained turns", () => {
      const payload: TurnNodePayload = {
        role: "assistant",
        content: "Step 1 continued",
        prev: "TURN001234567",
        owner: "STEP001234567",
      };

      expect(payload.prev).toBe("TURN001234567");
    });

    test("owner field accepts CasRef for step ownership", () => {
      const payload: TurnNodePayload = {
        role: "assistant",
        content: "Some output",
        prev: null,
        owner: "STEP001234567",
      };

      expect(payload.owner).toBe("STEP001234567");
    });

    test("supports legacy format with null prev and owner", () => {
      const payload: TurnNodePayload = {
        role: "assistant",
        content: "Legacy turn content",
        prev: null,
        owner: null,
      };

      expect(payload.prev).toBeNull();
      expect(payload.owner).toBeNull();
      expect(payload.role).toBe("assistant");
      expect(payload.content).toBe("Legacy turn content");
    });

    test("all fields are JSON-serializable", () => {
      const payload: TurnNodePayload = {
        role: "assistant",
        content: "Some output content",
        prev: "PREV001234567",
        owner: "OWNER01234567",
      };

      const serialized = JSON.stringify(payload);
      const deserialized = JSON.parse(serialized) as TurnNodePayload;

      expect(deserialized.role).toBe(payload.role);
      expect(deserialized.content).toBe(payload.content);
      expect(deserialized.prev).toBe(payload.prev);
      expect(deserialized.owner).toBe(payload.owner);
    });
  });
});
