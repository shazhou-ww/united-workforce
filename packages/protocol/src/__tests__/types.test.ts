import { describe, expect, test } from "vitest";
import type { StartNodePayload, StepRecord, Target } from "../types.js";

describe("Protocol types for thread/edge location", () => {
  describe("StartNodePayload", () => {
    test("has required cwd field", () => {
      const payload: StartNodePayload = {
        workflow: "0123456789ABC",
        prompt: "Test prompt",
        cwd: "/home/user/project",
      };

      expect(payload.cwd).toBe("/home/user/project");
      expect(typeof payload.cwd).toBe("string");
    });
  });

  describe("StepRecord", () => {
    test("has required cwd field", () => {
      const record: StepRecord = {
        role: "planner",
        output: "0123456789ABC",
        detail: "DEF0123456789",
        agent: "uwf-hermes",
        edgePrompt: "Plan the implementation",
        startedAtMs: Date.now(),
        completedAtMs: Date.now() + 1000,
        assembledPrompt: null,
        cwd: "/home/user/project",
        usage: null,
        previousAttempts: null,
      };

      expect(record.cwd).toBe("/home/user/project");
      expect(typeof record.cwd).toBe("string");
    });
  });

  describe("Target", () => {
    test("has location field that accepts string", () => {
      const target: Target = {
        role: "coder",
        prompt: "Implement the code",
        location: "/custom/path",
      };

      expect(target.location).toBe("/custom/path");
      expect(typeof target.location).toBe("string");
    });

    test("has location field that accepts null", () => {
      const target: Target = {
        role: "coder",
        prompt: "Implement the code",
        location: null,
      };

      expect(target.location).toBe(null);
    });

    test("location supports liquid template syntax", () => {
      const target: Target = {
        role: "coder",
        prompt: "Implement the code",
        location: "{{ repoPath }}",
      };

      expect(target.location).toBe("{{ repoPath }}");
    });
  });
});
