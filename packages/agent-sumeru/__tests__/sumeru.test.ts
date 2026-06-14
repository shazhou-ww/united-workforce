import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadId } from "@united-workforce/protocol";
import type { AgentContext } from "@united-workforce/util-agent";
import { getCachedSessionId, setCachedSessionId } from "@united-workforce/util-agent";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { buildSumeruPrompt } from "../src/sumeru.js";

function makeCtx(overrides: Partial<AgentContext> = {}): AgentContext {
  return {
    threadId: "01JTEST0000000000000000000" as ThreadId,
    edgePrompt: "Proceed with the assigned role.",
    isFirstVisit: true,
    workflow: {
      roles: {
        developer: {
          description: "TDD implementation per test spec",
          goal: "Write code",
          capabilities: ["coding"],
          procedure: "1. Read spec\n2. Write code",
          output: "List files changed",
          frontmatter: "",
        },
      },
      conditions: {},
      graph: {},
    },
    role: "developer",
    start: { prompt: "Fix the bug", workflowHash: "abc123", threadId: "t1" },
    steps: [],
    store: {} as AgentContext["store"],
    outputFormatInstruction: "Use YAML frontmatter",
    storageRoot: "/tmp/uwf-test",
    casDir: "/tmp/ocas-test",
    ...overrides,
  };
}

describe("buildSumeruPrompt", () => {
  test("assembles outputFormatInstruction + role + task + edge prompt", () => {
    const result = buildSumeruPrompt(makeCtx());
    expect(result).toMatch(/^Use YAML frontmatter/);
    expect(result).toContain("Write code");
    expect(result).toContain("## Task\nFix the bug");
    expect(result).toContain("## Moderator Instruction");
    expect(result).toContain("Proceed with the assigned role.");
  });

  test("re-entry appends the continuation summary after the role + task block", () => {
    const ctx = makeCtx({
      isFirstVisit: false,
      steps: [
        {
          role: "developer",
          output: '{"status":"done"}',
          agent: "uwf-sumeru",
          detail: "d1",
          edgePrompt: "Implement.",
          content: "I implemented everything.",
        },
        {
          role: "reviewer",
          output: '{"approved":false}',
          agent: "uwf-sumeru",
          detail: "d2",
          edgePrompt: "Review.",
          content: "Looks broken.",
        },
      ],
    });
    const result = buildSumeruPrompt(ctx);
    // On re-entry, the assembled prompt still includes the role + task header,
    // and adds the continuation summary covering steps since the last visit.
    expect(result).toContain("## Task\nFix the bug");
    expect(result).toContain("## What Happened Since Your Last Turn");
    expect(result).toContain("reviewer");
    // Re-entry uses content-less continuation (meta only) — content body of
    // re-entry steps should NOT be embedded verbatim.
    expect(result).not.toContain("Looks broken.");
  });

  test("first visit with prior steps includes content via buildContinuationPrompt", () => {
    const ctx = makeCtx({
      steps: [
        {
          role: "planner",
          output: '{"plan":"do X"}',
          agent: "hermes",
          detail: "detail-1",
          edgePrompt: "Create a plan.",
          content: "Here is my detailed plan for doing X.",
        },
      ],
    });
    const result = buildSumeruPrompt(ctx);
    expect(result).toContain("Here is my detailed plan for doing X.");
  });
});

// ─── Session cache tests ────────────────────────────────────

describe("session cache (shared util-agent helpers, agentName=sumeru)", () => {
  let storageRoot: string;

  beforeEach(async () => {
    storageRoot = await mkdtemp(join(tmpdir(), "sumeru-cache-"));
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("getCachedSessionId returns null when no cache entry exists", async () => {
    const id = await getCachedSessionId(
      "sumeru",
      "01TTHREADXYZ" as ThreadId,
      "developer",
      storageRoot,
    );
    expect(id).toBeNull();
  });

  test("setCachedSessionId / getCachedSessionId round-trips a session id", async () => {
    await setCachedSessionId(
      "sumeru",
      "01TTHREADXYZ" as ThreadId,
      "developer",
      "ses_abc",
      storageRoot,
    );
    const id = await getCachedSessionId(
      "sumeru",
      "01TTHREADXYZ" as ThreadId,
      "developer",
      storageRoot,
    );
    expect(id).toBe("ses_abc");
  });

  test("sumeru cache is namespaced separately from claude-code / hermes", async () => {
    await setCachedSessionId(
      "sumeru",
      "01TXYZ" as ThreadId,
      "developer",
      "ses_sumeru",
      storageRoot,
    );
    await setCachedSessionId(
      "claude-code",
      "01TXYZ" as ThreadId,
      "developer",
      "ses_cc",
      storageRoot,
    );

    expect(await getCachedSessionId("sumeru", "01TXYZ" as ThreadId, "developer", storageRoot)).toBe(
      "ses_sumeru",
    );
    expect(
      await getCachedSessionId("claude-code", "01TXYZ" as ThreadId, "developer", storageRoot),
    ).toBe("ses_cc");
  });

  test("different roles in the same thread get separate cache entries", async () => {
    await setCachedSessionId("sumeru", "01THR" as ThreadId, "dev", "ses_dev", storageRoot);
    await setCachedSessionId("sumeru", "01THR" as ThreadId, "reviewer", "ses_rev", storageRoot);
    expect(await getCachedSessionId("sumeru", "01THR" as ThreadId, "dev", storageRoot)).toBe(
      "ses_dev",
    );
    expect(await getCachedSessionId("sumeru", "01THR" as ThreadId, "reviewer", storageRoot)).toBe(
      "ses_rev",
    );
  });
});
