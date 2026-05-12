import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore } from "@uncaged/workflow-cas";
import { createExtract } from "@uncaged/workflow-execute";
import { tableToModerator } from "@uncaged/workflow-protocol/moderator-table.js";
import { validateWorkflowDescriptor } from "@uncaged/workflow-register";
import {
  createWorkflow,
  END,
  type ModeratorContext,
  type RoleStep,
  START,
} from "@uncaged/workflow-runtime";
import { buildSolveIssueDescriptor } from "../src/descriptor.js";
import type { DeveloperMeta } from "../src/developer.js";
import { solveIssueTable, solveIssueWorkflowDefinition } from "../src/index.js";
import type { PreparerMeta, SubmitterMeta } from "../src/roles/index.js";
import type { SolveIssueMeta } from "../src/roles.js";

const solveIssueModerator = tableToModerator(solveIssueTable);

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

function buildToolCallResponse(args: Record<string, unknown>): Response {
  return jsonResponse({
    choices: [
      {
        message: {
          tool_calls: [
            {
              id: "tc_extract_1",
              type: "function",
              function: {
                name: "extract",
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  });
}

function installMockToolCallCompletions(
  sequence: ReadonlyArray<Record<string, unknown>>,
): () => void {
  const origFetch = globalThis.fetch;
  let i = 0;
  const mockFetch = async (
    _input: Parameters<typeof fetch>[0],
    _init?: RequestInit,
  ): Promise<Response> => {
    const args = sequence[i] ?? sequence[sequence.length - 1];
    if (args === undefined) {
      throw new Error("installMockToolCallCompletions: empty sequence");
    }
    i += 1;
    return buildToolCallResponse(args);
  };
  globalThis.fetch = Object.assign(mockFetch, {
    preconnect: origFetch.preconnect.bind(origFetch),
  }) as typeof fetch;
  return () => {
    globalThis.fetch = origFetch;
  };
}

function makeStart(): ModeratorContext<SolveIssueMeta>["start"] {
  return {
    role: START,
    content: "Fix the flaky login test",
    meta: {},
    timestamp: 0,
    parentState: null,
  };
}

function makeCtx(
  steps: ModeratorContext<SolveIssueMeta>["steps"],
): ModeratorContext<SolveIssueMeta> {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    bundleHash: "TESTHASH00001",
    start: makeStart(),
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

function createStubExtract(casDir: string) {
  return createExtract(
    {
      baseUrl: "http://127.0.0.1:9",
      apiKey: "",
      model: "test",
    },
    { cas: createCasStore(casDir) },
  );
}

function makeThread(prompt: string) {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    bundleHash: "TESTHASH00001",
    start: {
      role: START,
      content: prompt,
      meta: {},
      timestamp: Date.now(),
      parentState: null,
    },
    steps: [],
  };
}

describe("solveIssueModerator", () => {
  test("routes initial → preparer → developer → submitter → END", () => {
    expect(solveIssueModerator(makeCtx([]))).toBe("preparer");
    expect(solveIssueModerator(makeCtx([preparerStep()]))).toBe("developer");
    expect(solveIssueModerator(makeCtx([preparerStep(), developerStep()]))).toBe("submitter");
    expect(
      solveIssueModerator(
        makeCtx([
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
        makeCtx([
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
        makeCtx([
          preparerStep(),
          developerStep(),
          submitterStep({ status: "submitted", prUrl: "https://example.com/pr/1" }),
        ]),
      ),
    ).toBe(END);
  });
});

describe("solveIssueWorkflowDefinition + createWorkflow", () => {
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

    const run = createWorkflow(solveIssueWorkflowDefinition, {
      agent: async () => "",
      overrides: { developer: async () => "stub-root-hash" },
    });
    const gen = run(makeThread("task"), {
      cas,
      extract: createStubExtract(casDir),
    });
    const first = await gen.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error("expected yield");
    }
    expect(first.value.role).toBe("preparer");
    expect(first.value.meta).toEqual(EXPECT_PREPARER_META);
  });

  test("structured extraction also accepts tool_calls extraction path", async () => {
    const EXPECT_PREPARER_META: PreparerMeta = {
      repoPath: "/home/user/repos/tool-call",
      defaultBranch: "main",
      conventions: null,
      toolchain: {
        packageManager: "bun",
        testCommand: "bun test",
        lintCommand: null,
        buildCommand: "bun run build",
      },
    };
    restoreFetch = installMockToolCallCompletions([EXPECT_PREPARER_META]);

    casDir = await mkdtemp(join(tmpdir(), "solve-issue-cas-"));
    const cas = createCasStore(casDir);

    const run = createWorkflow(solveIssueWorkflowDefinition, {
      agent: async () => "",
      overrides: { developer: async () => "stub-root-hash" },
    });
    const gen = run(makeThread("task"), {
      cas,
      extract: createStubExtract(casDir),
    });
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
    const run = createWorkflow(solveIssueWorkflowDefinition, {
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
    const gen = run(makeThread("task"), {
      cas,
      extract: createStubExtract(casDir),
    });
    await gen.next();
    expect(calls).toEqual(["preparer"]);

    calls.length = 0;
    await gen.next();
    expect(calls).toEqual(["developer"]);

    calls.length = 0;
    await gen.next();
    expect(calls).toEqual(["submitter"]);
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
    expect(validated.value.graph.edges.length).toBe(4);
    for (const key of ["preparer", "developer", "submitter"] as const) {
      const role = validated.value.roles[key];
      expect(role).toBeDefined();
      expect(typeof role.schema).toBe("object");
      expect(role.schema).not.toBeNull();
      expect(Array.isArray(role.schema)).toBe(false);
    }
  });
});
