import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkflowPayload } from "@uncaged/workflow-protocol";
import { parse } from "yaml";

/**
 * Test: Issue #474 - tea pr create fails in git worktree directories
 *
 * This test verifies that the solve-issue workflow's committer role
 * uses direct Gitea API calls via curl instead of tea pr create,
 * which fixes the "path segment [0] is empty" error in worktree directories.
 */

describe("solve-issue workflow: Gitea API PR creation", () => {
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

  test("committer procedure should use curl API instead of tea pr create", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    expect(workflow.roles.committer).toBeDefined();
    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure uses curl API, not tea pr create
    expect(committerProcedure).toContain("curl");
    expect(committerProcedure).toContain("api/v1/repos");
    expect(committerProcedure).toContain("/pulls");

    // Verify it explicitly warns against tea pr create
    expect(committerProcedure).toMatch(/do NOT use.*tea pr create/i);
  });

  test("committer procedure should reference repoRemote from task prompt", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure mentions repoRemote is provided in task prompt
    expect(committerProcedure).toMatch(/repo remote.*provided.*task prompt/i);
    expect(committerProcedure).toMatch(/owner\/repo/i);
  });

  test("committer procedure should include error handling for curl failures", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure includes error handling guidance for curl
    // This ensures we capture failures and provide actionable output
    expect(committerProcedure).toMatch(/error|fail/i);
    expect(committerProcedure).toContain("hook_failed");
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
      (v: any) => v.properties?.$status?.const === "committed",
    );
    expect(committedVariant).toBeDefined();
    expect(committedVariant.required).toContain("$status");
  });

  test("developer procedure should include mandatory verification step", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const developerProcedure = workflow.roles.developer?.procedure;
    expect(developerProcedure).toBeDefined();

    // Verify the procedure includes mandatory verification step
    expect(developerProcedure).toContain("MANDATORY VERIFICATION");
    expect(developerProcedure).toContain("git branch --show-current");
    expect(developerProcedure).toContain("git status");
    expect(developerProcedure).toMatch(/ls -la|verify.*exist/i);
  });

  test("reviewer procedure should enforce worktree path verification", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const reviewerProcedure = workflow.roles.reviewer?.procedure;
    expect(reviewerProcedure).toBeDefined();

    // Verify the procedure includes critical enforcement
    expect(reviewerProcedure).toContain("CRITICAL");
    expect(reviewerProcedure).toMatch(/cd.*pwd/);
    expect(reviewerProcedure).toContain(
      "Do NOT report results without running the actual commands",
    );
  });

  test("developer procedure should include test debugging escalation", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const developerProcedure = workflow.roles.developer?.procedure;
    expect(developerProcedure).toBeDefined();

    // Verify the procedure includes test failure guidance
    expect(developerProcedure).toMatch(/tests fail.*first run/i);
    expect(developerProcedure).toMatch(/3 test cycles|after 3 attempts/i);
    expect(developerProcedure).toContain("$status=failed");
  });
});
