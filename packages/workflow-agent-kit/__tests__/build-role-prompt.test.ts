import { describe, expect, test } from "vitest";
import type { RoleDefinition } from "@uncaged/workflow-protocol";
import { buildRolePrompt } from "../src/build-role-prompt.js";

describe("buildRolePrompt", () => {
  test("all fields present", () => {
    const role: RoleDefinition = {
      description: "A coder",
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
  });

  test("empty fields are omitted", () => {
    const role: RoleDefinition = {
      description: "A reviewer",
      identity: "You are a code reviewer.",
      prepare: "",
      execute: "Review the PR diff carefully.",
      report: "",
      outputSchema: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Identity");
    expect(result).toContain("## Execute");
    expect(result).not.toContain("## Prepare");
    expect(result).not.toContain("## Report");
  });

  test("all empty returns empty string", () => {
    const role: RoleDefinition = {
      description: "Minimal",
      identity: "",
      prepare: "",
      execute: "",
      report: "",
      outputSchema: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toBe("");
  });
});
