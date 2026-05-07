import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli-dispatch.js";
import { formatSkillDoc } from "../src/cmd-help.js";

const STORAGE_ROOT = "/tmp/help-test-storage";

describe("help command", () => {
  test("help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["help"]);
    expect(code).toBe(0);
  });

  test("help --skill returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["help", "--skill"]);
    expect(code).toBe(0);
  });
});

describe("formatSkillDoc", () => {
  const doc = formatSkillDoc();

  test("contains title", () => {
    expect(doc).toContain("# uncaged-workflow CLI Reference");
  });

  test("contains all command group headers", () => {
    expect(doc).toContain("### workflow");
    expect(doc).toContain("### thread");
    expect(doc).toContain("### cas");
    expect(doc).toContain("### init");
    expect(doc).toContain("### Top-level shortcuts");
  });

  test("contains core concepts", () => {
    expect(doc).toContain("## Core Concepts");
    expect(doc).toContain("Workflow");
    expect(doc).toContain("Bundle");
    expect(doc).toContain("Thread");
    expect(doc).toContain("CAS");
    expect(doc).toContain("Registry");
  });

  test("mentions all workflow subcommands", () => {
    for (const sub of ["add", "list", "show", "rm", "history", "rollback"]) {
      expect(doc).toContain(`workflow ${sub}`);
    }
  });

  test("mentions all thread subcommands", () => {
    for (const sub of [
      "run",
      "list",
      "show",
      "rm",
      "fork",
      "ps",
      "kill",
      "live",
      "pause",
      "resume",
    ]) {
      expect(doc).toContain(`thread ${sub}`);
    }
  });

  test("mentions all cas subcommands", () => {
    for (const sub of ["get", "put", "list", "rm", "gc"]) {
      expect(doc).toContain(`cas ${sub}`);
    }
  });

  test("contains exit codes section", () => {
    expect(doc).toContain("## Exit Codes");
  });

  test("contains environment variables section", () => {
    expect(doc).toContain("## Environment Variables");
    expect(doc).toContain("UNCAGED_WORKFLOW_STORAGE_ROOT");
  });

  test("contains typical workflow section", () => {
    expect(doc).toContain("## Typical Workflow");
  });
});
