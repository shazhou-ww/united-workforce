import type { RoleDefinition } from "@uncaged/workflow-protocol";
import { describe, expect, test } from "vitest";
import { buildRolePrompt } from "../src/build-role-prompt.js";

describe("buildRolePrompt", () => {
  test("all fields present", () => {
    const role: RoleDefinition = {
      description: "A coder",
      goal: "You are a senior developer.",
      capabilities: ["cursor-agent", "file-edit"],
      procedure: "Implement the feature.",
      output: "Summarize changes.",
      meta: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Goal");
    expect(result).toContain("You are a senior developer.");
    expect(result).toContain("## Capabilities");
    expect(result).toContain("- cursor-agent");
    expect(result).toContain("- file-edit");
    expect(result).toContain("## Procedure");
    expect(result).toContain("Implement the feature.");
    expect(result).toContain("## Output");
    expect(result).toContain("Summarize changes.");
  });

  test("empty fields are omitted", () => {
    const role: RoleDefinition = {
      description: "A reviewer",
      goal: "You are a code reviewer.",
      capabilities: [],
      procedure: "Review the PR diff carefully.",
      output: "",
      meta: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Goal");
    expect(result).toContain("## Procedure");
    expect(result).not.toContain("## Capabilities");
    expect(result).not.toContain("## Output");
  });

  test("all empty returns empty string", () => {
    const role: RoleDefinition = {
      description: "Minimal",
      goal: "",
      capabilities: [],
      procedure: "",
      output: "",
      meta: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toBe("");
  });

  test("capabilities rendered as bullet list", () => {
    const role: RoleDefinition = {
      description: "Agent",
      goal: "",
      capabilities: ["search", "code", "browse"],
      procedure: "",
      output: "",
      meta: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Capabilities");
    expect(result).toContain("- search");
    expect(result).toContain("- code");
    expect(result).toContain("- browse");
  });
});
