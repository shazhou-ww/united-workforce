import { describe, expect, test } from "bun:test";
import { formatCliUsage, runCli } from "../src/cli-dispatch.js";
import { formatSkillIndex, formatSkillTopic, getSkillTopics } from "../src/skill.js";

const STORAGE_ROOT = "/tmp/help-test-storage";

describe("runCli usage", () => {
  test("no args prints usage and returns 1", async () => {
    const code = await runCli(STORAGE_ROOT, []);
    expect(code).toBe(1);
  });
});

describe("skill command", () => {
  test("skill (no topic) lists topics and returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["skill"]);
    expect(code).toBe(0);
  });

  test("skill cli returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["skill", "cli"]);
    expect(code).toBe(0);
  });

  test("skill develop returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["skill", "develop"]);
    expect(code).toBe(0);
  });

  test("skill author returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["skill", "author"]);
    expect(code).toBe(0);
  });

  test("skill unknown returns 1", async () => {
    const code = await runCli(STORAGE_ROOT, ["skill", "unknown"]);
    expect(code).toBe(1);
  });
});

describe("--help flag on groups", () => {
  test("workflow --help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["workflow", "--help"]);
    expect(code).toBe(0);
  });

  test("thread --help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["thread", "--help"]);
    expect(code).toBe(0);
  });

  test("cas --help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["cas", "--help"]);
    expect(code).toBe(0);
  });

  test("init --help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["init", "--help"]);
    expect(code).toBe(0);
  });

  test("setup --help returns 0", async () => {
    const code = await runCli(STORAGE_ROOT, ["setup", "--help"]);
    expect(code).toBe(0);
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
    expect(idx).toContain("# uncaged-workflow skill");
    expect(idx).not.toContain("# uncaged-workflow help --skill");
    expect(idx).toContain("cli");
    expect(idx).toContain("develop");
    expect(idx).toContain("author");
    expect(idx).toContain("skill <topic>");
  });
});

describe("formatCliUsage", () => {
  test("has tagline, grouped sections, help hint, and env vars", () => {
    const u = formatCliUsage();
    expect(u.startsWith("uncaged-workflow — workflow engine CLI")).toBe(true);
    expect(u).toContain("Workflow registry:");
    expect(u).toContain("Thread execution:");
    expect(u).toContain("Content-addressable storage:");
    expect(u).toContain("Development:");
    expect(u).toContain("Configuration:");
    expect(u).toContain("setup [--provider <name>]");
    expect(u).toContain("Shortcuts:");
    expect(u).toContain("Reference:");
    expect(u).toContain("skill [topic]");
    expect(u).toContain("Agent-consumable docs");
    expect(u).toContain("Use <command> --help for subcommand details.");
    expect(u).toContain("Environment variables:");
    expect(u).toContain("WORKFLOW_STORAGE_ROOT");
    expect(u).toContain("UNCAGED_WORKFLOW_STORAGE_ROOT");
  });

  test("lists commands from registry with descriptions", () => {
    const u = formatCliUsage();
    expect(u).toContain("workflow add");
    expect(u).toContain("Register a workflow bundle in the registry");
    expect(u).toContain("thread run");
    expect(u).toContain("Start a new thread executing a workflow");
    expect(u).toContain("cas gc");
    expect(u).toContain("Garbage-collect unreferenced CAS entries");
  });
});

const cliSkillDoc = formatSkillTopic("cli");
if (cliSkillDoc === null) {
  throw new Error("BUG: cli skill topic missing");
}

describe("formatSkillTopic('cli')", () => {
  const doc = cliSkillDoc;

  test("contains title", () => {
    expect(doc).toContain("# uncaged-workflow CLI Reference");
  });

  test("contains all command group headers", () => {
    expect(doc).toContain("### workflow");
    expect(doc).toContain("### thread");
    expect(doc).toContain("### cas");
    expect(doc).toContain("### init");
    expect(doc).toContain("### setup");
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
