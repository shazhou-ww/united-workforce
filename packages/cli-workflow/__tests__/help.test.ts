import { describe, expect, test } from "bun:test";
import { runCli } from "../src/cli-dispatch.js";
import {
  formatSkillDoc,
  formatSkillIndex,
  formatSkillTopic,
  getSkillTopics,
} from "../src/cmd-help.js";

const STORAGE_ROOT = "/tmp/help-test-storage";

describe("help command", () => {
  test("help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["help"]);
    expect(code).toBe(0);
  });

  test("help --skill (no topic) returns 0 and lists topics", async () => {
    const code = await runCli(STORAGE_ROOT, ["help", "--skill"]);
    expect(code).toBe(0);
  });

  test("help --skill cli returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["help", "--skill", "cli"]);
    expect(code).toBe(0);
  });

  test("help --skill develop returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["help", "--skill", "develop"]);
    expect(code).toBe(0);
  });

  test("help --skill author returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["help", "--skill", "author"]);
    expect(code).toBe(0);
  });

  test("help --skill unknown returns 1", async () => {
    const code = await runCli(STORAGE_ROOT, ["help", "--skill", "unknown"]);
    expect(code).toBe(1);
  });
});

describe("getSkillTopics", () => {
  test("returns all topics", () => {
    const topics = getSkillTopics();
    const names = topics.map((t) => t.name);
    expect(names).toContain("cli");
    expect(names).toContain("develop");
    expect(names).toContain("author");
  });
});

describe("formatSkillIndex", () => {
  test("lists all topics", () => {
    const idx = formatSkillIndex();
    expect(idx).toContain("cli");
    expect(idx).toContain("develop");
    expect(idx).toContain("author");
    expect(idx).toContain("help --skill <topic>");
  });
});

describe("formatSkillTopic('cli') — legacy formatSkillDoc", () => {
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

describe("formatSkillTopic('develop')", () => {
  const doc = formatSkillTopic("develop");

  test("returns non-null", () => {
    expect(doc).not.toBeNull();
  });

  test("contains thread ID info", () => {
    expect(doc).toContain("Thread ID");
    expect(doc).toContain("Crockford Base32");
  });

  test("contains CAS commands", () => {
    expect(doc).toContain("cas put");
    expect(doc).toContain("cas get");
  });

  test("contains meta output section", () => {
    expect(doc).toContain("Meta Output");
  });
});

describe("formatSkillTopic('author')", () => {
  const doc = formatSkillTopic("author");

  test("returns non-null", () => {
    expect(doc).not.toBeNull();
  });

  test("contains bundle structure", () => {
    expect(doc).toContain("Bundle Structure");
    expect(doc).toContain(".esm.js");
  });

  test("contains descriptor info", () => {
    expect(doc).toContain("WorkflowDescriptor");
  });

  test("contains role definition", () => {
    expect(doc).toContain("Role Definition");
  });
});

describe("formatSkillTopic unknown", () => {
  test("returns null for unknown topic", () => {
    expect(formatSkillTopic("nonexistent")).toBeNull();
  });
});
