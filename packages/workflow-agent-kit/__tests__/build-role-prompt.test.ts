import { describe, expect, test } from "vitest";
import type { RoleDefinition } from "@uncaged/workflow-protocol";
import { buildRolePrompt } from "../src/build-role-prompt.js";

describe("buildRolePrompt", () => {
  test("four-phase: all fields present", () => {
    const role: RoleDefinition = {
      description: "A coder",
      systemPrompt: "legacy prompt",
      identity: "You are a senior developer.",
      prepare: "Load cursor-agent skill.",
      execute: "Implement the feature.",
      report: "Summarize changes.",
      outputSchema: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Identity");
    expect(result).toContain("You are a senior developer.");
    expect(result).toContain("## Prepare");
    expect(result).toContain("Load cursor-agent skill.");
    expect(result).toContain("## Execute");
    expect(result).toContain("Implement the feature.");
    expect(result).toContain("## Report");
    expect(result).toContain("Summarize changes.");
    expect(result).not.toContain("legacy prompt");
  });

  test("legacy: only systemPrompt", () => {
    const role: RoleDefinition = {
      description: "A planner",
      systemPrompt: "You are a planning agent.",
      identity: null,
      prepare: null,
      execute: null,
      report: null,
      outputSchema: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toBe("You are a planning agent.");
  });

  test("legacy: no fields at all", () => {
    const role = {
      description: "Minimal",
      outputSchema: "placeholder00000",
    } as unknown as RoleDefinition;
    const result = buildRolePrompt(role);
    expect(result).toBe("");
  });

  test("mixed: identity present, partial other fields", () => {
    const role: RoleDefinition = {
      description: "A reviewer",
      systemPrompt: "legacy",
      identity: "You are a code reviewer.",
      prepare: null,
      execute: "Review the PR diff carefully.",
      report: null,
      outputSchema: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Identity");
    expect(result).toContain("## Execute");
    expect(result).not.toContain("## Prepare");
    expect(result).not.toContain("## Report");
    expect(result).not.toContain("legacy");
  });
});
