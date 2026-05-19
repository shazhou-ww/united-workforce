import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore } from "@uncaged/workflow-cas";
import { createExtract } from "@uncaged/workflow-execute";
import { tableToModerator } from "@uncaged/workflow-protocol/moderator-table.js";
import { validateWorkflowDescriptor } from "@uncaged/workflow-register";
import {
  type AdapterFn,
  createWorkflow,
  END,
  type ModeratorContext,
  type RoleResult,
  type RoleStep,
  START,
  type ThreadContext,
  type WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import type * as z from "zod/v4";
import { buildSolveIssueDescriptor } from "../src/descriptor.js";
import type { DeveloperMeta } from "../src/developer.js";
import { solveIssueTable, solveIssueWorkflowDefinition } from "../src/index.js";
import type { PreparerMeta, SubmitterMeta } from "../src/roles/index.js";
import type { SolveIssueMeta } from "../src/roles.js";

const solveIssueModerator = tableToModerator(solveIssueTable);

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

/** Creates an AdapterFn that returns a fixed sequence of meta values. */
function createSequenceAdapter(sequence: ReadonlyArray<Record<string, unknown>>): AdapterFn {
  let i = 0;
  return <T>(_prompt: string, _schema: z.ZodType<T>) => {
    return async (_ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      const meta = sequence[i] ?? sequence[sequence.length - 1];
      if (meta === undefined) {
        throw new Error("createSequenceAdapter: empty sequence");
      }
      i += 1;
      return { meta: meta as T, childThread: null };
    };
  };
}

/** Creates an AdapterFn that tracks calls and returns fixed meta. */
function createTrackingAdapter(
  name: string,
  calls: string[],
  meta: Record<string, unknown>,
): AdapterFn {
  return <T>(_prompt: string, _schema: z.ZodType<T>) => {
    return async (_ctx: ThreadContext, _runtime: WorkflowRuntime): Promise<RoleResult<T>> => {
      calls.push(name);
      return { meta: meta as T, childThread: null };
    };
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
  let casDir: string | undefined;

  afterEach(async () => {
    if (casDir !== undefined) {
      await rm(casDir, { recursive: true, force: true }).catch(() => {});
      casDir = undefined;
    }
  });

  test("adapter yields preparer meta directly", async () => {
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

    casDir = await mkdtemp(join(tmpdir(), "solve-issue-cas-"));
    const cas = createCasStore(casDir);

    const adapter = createSequenceAdapter([EXPECT_PREPARER_META]);
    const run = createWorkflow(solveIssueWorkflowDefinition, {
      adapter,
      overrides: null,
    });
    const gen = run(makeThread("task"), {
      cas,
      extract: createExtract({ baseUrl: "http://127.0.0.1:9", apiKey: "", model: "test" }, { cas }),
    });
    const first = await gen.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error("expected yield");
    }
    expect(first.value.role).toBe("preparer");
    expect(first.value.meta).toEqual(EXPECT_PREPARER_META);
  });

  test("per-role adapter overrides default", async () => {
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

    casDir = await mkdtemp(join(tmpdir(), "solve-issue-cas-"));
    const cas = createCasStore(casDir);

    const calls: string[] = [];
    const run = createWorkflow(solveIssueWorkflowDefinition, {
      adapter: createTrackingAdapter("default", calls, PREPARER_META),
      overrides: {
        preparer: createTrackingAdapter("preparer", calls, PREPARER_META),
        developer: createTrackingAdapter("developer", calls, DEVELOPER_META),
        submitter: createTrackingAdapter("submitter", calls, SUBMITTER_META),
      },
    });
    const gen = run(makeThread("task"), {
      cas,
      extract: createExtract({ baseUrl: "http://127.0.0.1:9", apiKey: "", model: "test" }, { cas }),
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
