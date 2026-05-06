import { describe, expect, spyOn, test } from "bun:test";

import type { AgentFn, ThreadContext } from "@uncaged/workflow";
import { START } from "@uncaged/workflow";
import * as utilRole from "@uncaged/workflow-util-role";

import { createCommitterRole } from "../src/committer.js";

function makeCtx(): ThreadContext {
  return {
    threadId: "01TEST00000000000000000000",
    start: {
      role: START,
      content: "do thing",
      meta: { maxRounds: 10 },
      timestamp: Date.now(),
    },
    steps: [],
  };
}

const provider = { baseUrl: "https://example.com/v1", apiKey: "k", model: "m" };

const dryRunMeta = {
  status: "committed" as const,
  branch: "dry-run/placeholder",
  commitSha: "0000000",
};

describe("createCommitterRole", () => {
  test("dry-run skips pipeline", async () => {
    const agent: AgentFn = async () => {
      throw new Error("agent should not run");
    };
    const role = createCommitterRole(agent, {
      provider,
      dryRun: true,
      dryRunMeta,
    });
    const out = await role(makeCtx());
    expect(out.content).toBe("[dry-run] committer skipped");
    expect(out.meta).toEqual(dryRunMeta);
  });

  test("returns committed meta when extraction succeeds", async () => {
    const committed = {
      status: "committed" as const,
      branch: "feat/widget",
      commitSha: "deadbeef".repeat(5).slice(0, 40),
    };

    const spy = spyOn(utilRole, "extractMetaOrThrow").mockResolvedValue(committed);

    const agent: AgentFn = async (_ctx, prompt) =>
      `Created branch ${committed.branch}, pushed. SHA ${committed.commitSha}.\n${prompt.slice(0, 80)}…`;

    const role = createCommitterRole(agent, {
      provider,
      dryRun: null,
      dryRunMeta,
    });

    const out = await role(makeCtx());
    expect(out.meta).toEqual(committed);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns failed meta when extraction reports failure", async () => {
    const failed = {
      status: "failed" as const,
      error: "working tree clean; nothing to commit",
      logRef: null as string | null,
    };

    const spy = spyOn(utilRole, "extractMetaOrThrow").mockResolvedValue(failed);

    const agent: AgentFn = async () => "git status shows no changes; skipping branch and commit.";

    const role = createCommitterRole(agent, {
      provider,
      dryRun: null,
      dryRunMeta,
    });

    const out = await role(makeCtx());
    expect(out.meta).toEqual(failed);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test("returns failed meta with logRef when extraction includes it", async () => {
    const failed = {
      status: "failed" as const,
      error: "push rejected",
      logRef: "LOGREF01",
    };

    spyOn(utilRole, "extractMetaOrThrow").mockResolvedValue(failed);

    const agent: AgentFn = async () => "Remote rejected non-fast-forward.";

    const role = createCommitterRole(agent, {
      provider,
      dryRun: null,
      dryRunMeta,
    });

    const out = await role(makeCtx());
    expect(out.meta).toEqual(failed);
  });

  test("onFail wraps extraction errors", async () => {
    spyOn(utilRole, "extractMetaOrThrow").mockRejectedValue(
      new Error("structured extraction failed"),
    );

    const agent: AgentFn = async () => "opaque agent output";

    const role = createCommitterRole(agent, {
      provider,
      dryRun: null,
      dryRunMeta,
    });

    const out = await role(makeCtx());
    expect(out.meta).toEqual({
      status: "failed",
      error: "committer role threw before structured result",
      logRef: null,
    });
    expect(out.content).toContain("committer failed:");
    expect(out.content).toContain("structured extraction failed");
  });
});
