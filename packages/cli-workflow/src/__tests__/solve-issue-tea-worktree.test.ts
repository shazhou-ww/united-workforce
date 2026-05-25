import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowPayload } from "@uncaged/workflow-protocol";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * Test: Issue #474 - tea pr create fails in git worktree directories
 *
 * This test verifies that the solve-issue workflow's committer role
 * includes the --repo flag when running tea pr create, which fixes
 * the "path segment [0] is empty" error in worktree directories.
 */

describe("solve-issue workflow: tea pr create worktree fix", () => {
  // Navigate up from packages/cli-workflow/src/__tests__ to repo root
  const workflowPath = join(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "..",
    ".workflows",
    "solve-issue.yaml",
  );

  test("committer procedure should include --repo flag in tea pr create command", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    expect(workflow.roles.committer).toBeDefined();
    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure includes tea pr create with --repo flag
    expect(committerProcedure).toContain("tea pr create");
    expect(committerProcedure).toContain("--repo");

    // Verify the --repo flag appears before or together with tea pr create
    // This ensures the command is: tea pr create --repo <owner/repo> ...
    const teaPrCreateMatch = committerProcedure?.match(/tea pr create[^\n]*/);
    expect(teaPrCreateMatch).not.toBeNull();

    if (teaPrCreateMatch) {
      const teaCommandLine = teaPrCreateMatch[0];
      expect(teaCommandLine).toContain("--repo");
    }
  });

  test("committer procedure should mention repo extraction from git remote", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure mentions extracting repo info from git remote
    // This ensures fallback logic is documented
    expect(committerProcedure).toMatch(/git remote/i);
  });

  test("committer procedure should include error handling for tea failures", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure includes error handling guidance
    // This ensures we capture failures and provide actionable output
    expect(committerProcedure).toMatch(/error|fail/i);
  });

  test("workflow should be parseable as valid WorkflowPayload", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    // Basic structure validation
    expect(workflow.name).toBe("solve-issue");
    expect(workflow.roles).toBeDefined();
    expect(workflow.graph).toBeDefined();

    // Verify committer role exists with required fields
    expect(workflow.roles.committer).toBeDefined();
    expect(workflow.roles.committer?.description).toBeDefined();
    expect(workflow.roles.committer?.goal).toBeDefined();
    expect(workflow.roles.committer?.procedure).toBeDefined();
    expect(workflow.roles.committer?.output).toBeDefined();
    expect(workflow.roles.committer?.frontmatter).toBeDefined();
  });

  test("committer frontmatter schema should be oneOf with $status discriminant", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    // Parse as any to access the raw YAML structure (frontmatter is inline JSON Schema in YAML)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const workflow = parse(yamlContent) as any;
    const frontmatter = workflow.roles.committer?.frontmatter;
    expect(frontmatter).toBeDefined();
    expect(frontmatter?.oneOf).toBeDefined();
    const committedVariant = frontmatter.oneOf.find(
      (v: any) => v.properties?.["$status"]?.const === "committed",
    );
    expect(committedVariant).toBeDefined();
    expect(committedVariant.required).toContain("$status");
  });
});
