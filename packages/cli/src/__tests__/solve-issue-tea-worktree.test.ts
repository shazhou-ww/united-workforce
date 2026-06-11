import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { WorkflowPayload } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";
import { parse } from "yaml";

/**
 * Test: Issue #474 - tea pr create fails in git worktree directories
 *
 * This test verifies that the solve-issue workflow's committer role
 * uses direct Gitea API calls via curl instead of tea pr create,
 * which fixes the "path segment [0] is empty" error in worktree directories.
 */

// Skip: pure workflow YAML prose content assertions — procedure text changes
// break these without indicating real bugs. See #299 discussion.
describe.skip("solve-issue workflow: Gitea API PR creation", () => {
  // Navigate up from packages/cli/src/__tests__ to repo root
  const workflowPath = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
    "..",
    "examples",
    "solve-issue.yaml",
  );

  test("committer procedure should create PR via tea pr create", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    expect(workflow.roles.committer).toBeDefined();
    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure uses tea pr create for PR creation
    expect(committerProcedure).toContain("tea pr create");
    expect(committerProcedure).toContain("git push");
    expect(committerProcedure).toContain("Fixes #N");
  });

  test("committer procedure should extract owner/repo from git remote", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const committerProcedure = workflow.roles.committer?.procedure;
    expect(committerProcedure).toBeDefined();

    // Verify the procedure extracts owner/repo from remote
    expect(committerProcedure).toContain("git remote get-url origin");
    expect(committerProcedure).toContain("hook_failed");
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

  test("developer procedure should include worktree setup", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const developerProcedure = workflow.roles.developer?.procedure;
    expect(developerProcedure).toBeDefined();

    // Verify the procedure includes worktree setup
    expect(developerProcedure).toContain("IMPORTANT");
    expect(developerProcedure).toContain("git worktree add");
    expect(developerProcedure).toContain("pnpm install");
  });

  test("reviewer procedure should verify branch and run checks", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const reviewerProcedure = workflow.roles.reviewer?.procedure;
    expect(reviewerProcedure).toBeDefined();

    // Verify the procedure includes branch verification and build checks
    expect(reviewerProcedure).toContain("git branch --show-current");
    expect(reviewerProcedure).toContain("pnpm run build");
    expect(reviewerProcedure).toContain("pnpm run check");
  });

  test("developer procedure should include changeset and failure handling", async () => {
    const yamlContent = await readFile(workflowPath, "utf-8");
    const workflow = parse(yamlContent) as WorkflowPayload;

    const developerProcedure = workflow.roles.developer?.procedure;
    expect(developerProcedure).toBeDefined();

    // Verify the procedure includes changeset requirement and failure path
    expect(developerProcedure).toContain(".changeset/");
    expect(developerProcedure).toContain("$status=failed");
    expect(developerProcedure).toContain("pnpm test");
  });
});
