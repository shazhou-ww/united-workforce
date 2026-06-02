import { describe, expect, test } from "bun:test";
import type { RoleDefinition } from "@uncaged/workflow-protocol";
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
    expect(result).toContain("## Prepare");
    expect(result).toContain("uwf CLI Reference");
    expect(result).toContain("cursor-agent, file-edit");
    expect(result).toContain("## Procedure");
    expect(result).toContain("Implement the feature.");
    expect(result).toContain("## Output");
    expect(result).toContain("Summarize changes.");
  });

  test("empty fields are omitted but Prepare is always present", () => {
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
    expect(result).toContain("## Prepare");
    expect(result).toContain("uwf CLI Reference");
    expect(result).toContain("## Procedure");
    expect(result).not.toContain("## Capabilities");
    expect(result).not.toContain("## Output");
  });

  test("all empty still includes Prepare section", () => {
    const role: RoleDefinition = {
      description: "Minimal",
      goal: "",
      capabilities: [],
      procedure: "",
      output: "",
      meta: "placeholder00000" as string,
    };
    const result = buildRolePrompt(role);
    expect(result).toContain("## Prepare");
    expect(result).toContain("uwf CLI Reference");
    expect(result).not.toContain("## Goal");
    expect(result).not.toContain("## Capabilities");
    expect(result).not.toContain("## Procedure");
    expect(result).not.toContain("## Output");
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
