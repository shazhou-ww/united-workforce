import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore, createExtract } from "@uncaged/workflow";
import {
  END,
  type ModeratorContext,
  type RoleStep,
  START,
  validateWorkflowDescriptor,
} from "@uncaged/workflow-runtime";
import { buildSolveIssueDescriptor } from "../src/descriptor.js";
import type { DeveloperMeta } from "../src/developer.js";
import { createSolveIssueRun, solveIssueModerator } from "../src/index.js";
import type { PreparerMeta, SubmitterMeta } from "../src/roles/index.js";
import type { SolveIssueMeta } from "../src/roles.js";

function jsonResponse(payload: Record<string, unknown>): Response {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function buildPlainJsonResponse(args: Record<string, unknown>): Response {
  return jsonResponse({
    choices: [{ message: { content: JSON.stringify(args) } }],
  });
}

function installMockChatCompletions(sequence: ReadonlyArray<Record<string, unknown>>): () => void {
  const origFetch = globalThis.fetch;
  let i = 0;
  const mockFetch = async (
    _input: Parameters<typeof fetch>[0],
    _init?: RequestInit,
  ): Promise<Response> => {
    const args = sequence[i] ?? sequence[sequence.length - 1];
    if (args === undefined) {
      throw new Error("installMockChatCompletions: empty sequence");
    }
    i += 1;
    return buildPlainJsonResponse(args);
  };
  globalThis.fetch = Object.assign(mockFetch, {
    preconnect: origFetch.preconnect.bind(origFetch),
  }) as typeof fetch;
  return () => {
    globalThis.fetch = origFetch;
  };
}

function makeStart(maxRounds: number): ModeratorContext<SolveIssueMeta>["start"] {
  return {
    role: START,
    content: "Fix the flaky login test",
    meta: { maxRounds },
    timestamp: 0,
  };
}

function makeCtx(
  maxRounds: number,
  steps: ModeratorContext<SolveIssueMeta>["steps"],
): ModeratorContext<SolveIssueMeta> {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    start: makeStart(maxRounds),
    steps,
  };
}

function preparerStep(): RoleStep<SolveIssueMeta> {
  return {
    role: "preparer",
    contentHash: "STUBHASHPREPARER01",
    meta: {
      repoPath: "/home/user/repos/test",
      defaultBranch: "main",
      conventions: null,
      toolchain: {
        packageManager: "bun",
        testCommand: "bun test",
        lintCommand: null,
        buildCommand: "bun run build",
      },
    },
    refs: [],
    timestamp: 0,
  };
}

function developerStep(): RoleStep<SolveIssueMeta> {
  return {
    role: "developer",
    contentHash: "STUBHASHDEVELOPER1",
    meta: {
      branch: "feat/issue-1",
      commitSha: "abc1234",
      filesChanged: ["src/login.ts"],
      summary: "Fixed flaky login test by stabilising async setup.",
    },
    refs: [],
    timestamp: 1,
  };
}

function submitterStep(meta: SubmitterMeta): RoleStep<SolveIssueMeta> {
  return {
    role: "submitter",
    contentHash: "STUBHASHSUBMITTER1",
    meta,
    refs: [],
    timestamp: 2,
  };
}

const stubExtract = createExtract({
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "test",
});

describe("solveIssueModerator", () => {
  test("routes initial → preparer → developer → submitter → END", () => {
    expect(solveIssueModerator(makeCtx(20, []))).toBe("preparer");
    expect(solveIssueModerator(makeCtx(20, [preparerStep()]))).toBe("developer");
    expect(solveIssueModerator(makeCtx(20, [preparerStep(), developerStep()]))).toBe("submitter");
    expect(
      solveIssueModerator(
        makeCtx(20, [
          preparerStep(),
          developerStep(),
          submitterStep({
            status: "submitted",
            prUrl: "https://github.com/example/repo/pull/1",
          }),
        ]),
      ),
    ).toBe(END);
  });

  test("submitter failed → END", () => {
    expect(
      solveIssueModerator(
        makeCtx(20, [
          preparerStep(),
          developerStep(),
          submitterStep({ status: "failed", error: "gh not authenticated" }),
        ]),
      ),
    ).toBe(END);
  });

  test("returns END for any unexpected last step (defensive)", () => {
    // A submitter step with a pseudo-unknown future status would still be
    // routed to END, since the moderator is a closed switch over known roles.
    expect(
      solveIssueModerator(
        makeCtx(20, [
          preparerStep(),
          developerStep(),
          submitterStep({ status: "submitted", prUrl: "https://example.com/pr/1" }),
        ]),
      ),
    ).toBe(END);
  });
});

describe("createSolveIssueRun", () => {
  let restoreFetch: (() => void) | null = null;
  let casDir: string | undefined;

  afterEach(async () => {
    restoreFetch?.();
    restoreFetch = null;
    if (casDir !== undefined) {
      await rm(casDir, { recursive: true, force: true }).catch(() => {});
      casDir = undefined;
    }
  });

  test("structured extraction yields preparer meta from mocked chat completions", async () => {
    const EXPECT_PREPARER_META: PreparerMeta = {
      repoPath: "/home/user/repos/test",
      defaultBranch: "main",
      conventions: null,
      toolchain: {
        packageManager: "bun",
        testCommand: "bun test",
        lintCommand: null,
        buildCommand: "bun run build",
      },
    };
    restoreFetch = installMockChatCompletions([EXPECT_PREPARER_META]);

    casDir = await mkdtemp(join(tmpdir(), "solve-issue-cas-"));
    const cas = createCasStore(casDir);

    // Override developer so the test does not spin up a child workflow.
    const run = createSolveIssueRun({
      agent: async () => "",
      overrides: { developer: async () => "stub-root-hash" },
    });
    const gen = run(
      { prompt: "task", steps: [] },
      {
        threadId: "01TEST000000000000000000TR",
        maxRounds: 20,
        depth: 0,
        cas,
        extract: stubExtract,
      },
    );
    const first = await gen.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error("expected yield");
    }
    expect(first.value.role).toBe("preparer");
    expect(first.value.meta).toEqual(EXPECT_PREPARER_META);
  });

  test("per-role agent overrides default", async () => {
    const PREPARER_META: PreparerMeta = {
      repoPath: "/tmp/r",
      defaultBranch: "main",
      conventions: null,
      toolchain: { packageManager: null, testCommand: null, lintCommand: null, buildCommand: null },
    };
    const DEVELOPER_META: DeveloperMeta = {
      branch: "feat/x",
      commitSha: "abc1234",
      filesChanged: ["a.ts"],
      summary: "did the work",
    };
    const SUBMITTER_META: SubmitterMeta = {
      status: "submitted",
      prUrl: "https://github.com/example/repo/pull/2",
    };
    restoreFetch = installMockChatCompletions([PREPARER_META, DEVELOPER_META, SUBMITTER_META]);

    casDir = await mkdtemp(join(tmpdir(), "solve-issue-cas-"));
    const cas = createCasStore(casDir);

    const calls: string[] = [];
    const run = createSolveIssueRun({
      agent: async () => {
        calls.push("default");
        return "";
      },
      overrides: {
        preparer: async () => {
          calls.push("preparer");
          return "";
        },
        developer: async () => {
          calls.push("developer");
          return "stub-root-hash";
        },
        submitter: async () => {
          calls.push("submitter");
          return "";
        },
      },
    });
    const gen = run(
      { prompt: "task", steps: [] },
      {
        threadId: "01TEST000000000000000000TR",
        maxRounds: 20,
        depth: 0,
        cas,
        extract: stubExtract,
      },
    );
    await gen.next();
    expect(calls).toEqual(["preparer"]);

    calls.length = 0;
    await gen.next();
    expect(calls).toEqual(["developer"]);

    calls.length = 0;
    await gen.next();
    expect(calls).toEqual(["submitter"]);
  });

  test("developer defaults to workflowAsAgent override (caller override still wins)", async () => {
    const PREPARER_META: PreparerMeta = {
      repoPath: "/tmp/r",
      defaultBranch: "main",
      conventions: null,
      toolchain: { packageManager: null, testCommand: null, lintCommand: null, buildCommand: null },
    };
    const DEVELOPER_META: DeveloperMeta = {
      branch: "feat/y",
      commitSha: "def5678",
      filesChanged: ["b.ts"],
      summary: "more work",
    };
    restoreFetch = installMockChatCompletions([PREPARER_META, DEVELOPER_META]);

    casDir = await mkdtemp(join(tmpdir(), "solve-issue-cas-"));
    const cas = createCasStore(casDir);

    let developerInvocations = 0;
    const run = createSolveIssueRun({
      agent: async () => "",
      overrides: {
        developer: async () => {
          developerInvocations += 1;
          return "stub-root-hash";
        },
      },
    });
    const gen = run(
      { prompt: "task", steps: [] },
      {
        threadId: "01TEST000000000000000000TR",
        maxRounds: 20,
        depth: 0,
        cas,
        extract: stubExtract,
      },
    );
    // preparer
    await gen.next();
    // developer (caller override should be invoked, NOT workflowAsAgent default)
    const devYield = await gen.next();
    expect(devYield.done).toBe(false);
    if (devYield.done) {
      throw new Error("expected yield");
    }
    expect(devYield.value.role).toBe("developer");
    expect(devYield.value.meta).toEqual(DEVELOPER_META);
    expect(developerInvocations).toBe(1);
  });
});

describe("buildSolveIssueDescriptor", () => {
  test("lists preparer, developer, submitter with schemas that validate", () => {
    const descriptor = buildSolveIssueDescriptor();
    const validated = validateWorkflowDescriptor(descriptor);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    expect(Object.keys(validated.value.roles).sort()).toEqual([
      "developer",
      "preparer",
      "submitter",
    ]);
    for (const key of ["preparer", "developer", "submitter"] as const) {
      const role = validated.value.roles[key];
      expect(role).toBeDefined();
      expect(typeof role.schema).toBe("object");
      expect(role.schema).not.toBeNull();
      expect(Array.isArray(role.schema)).toBe(false);
    }
  });
});
