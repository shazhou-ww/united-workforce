import { afterEach, describe, expect, test } from "bun:test";
import {
  createExtract,
  END,
  type ModeratorContext,
  type RoleStep,
  START,
  validateWorkflowDescriptor,
} from "@uncaged/workflow";

import type { CoderMeta } from "@uncaged/workflow-role-coder";
import type { PlannerMeta } from "@uncaged/workflow-role-planner";

import { buildSolveIssueDescriptor } from "../src/descriptor.js";
import { createSolveIssueRun, solveIssueModerator } from "../src/index.js";
import type { SolveIssueMeta } from "../src/roles.js";

const DEFAULT_PHASES: PlannerMeta["phases"] = [
  { name: "phase-a", description: "Do the work", acceptance: "Done" },
];

const EXPECT_PLANNER_META: PlannerMeta = {
  phases: [{ name: "phase-1", description: "placeholder", acceptance: "placeholder" }],
};

const EXPECT_CODER_META: CoderMeta = {
  completedPhase: "phase-1",
  filesChanged: [],
  summary: "",
};

function installMockChatCompletions(sequence: ReadonlyArray<Record<string, unknown>>): () => void {
  const origFetch = globalThis.fetch;
  let i = 0;
  const mockFetch = async (
    input: Parameters<typeof fetch>[0],
    init?: RequestInit,
  ): Promise<Response> => {
    const args = sequence[i] ?? sequence[sequence.length - 1];
    if (args === undefined) {
      throw new Error("installMockChatCompletions: empty sequence");
    }
    i += 1;
    void input;
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
    const tools = body.tools;
    const firstTool =
      Array.isArray(tools) && tools.length > 0 && tools[0] !== null && typeof tools[0] === "object"
        ? (tools[0] as Record<string, unknown>)
        : null;
    const fn =
      firstTool !== null ? (firstTool.function as Record<string, unknown> | undefined) : undefined;
    const toolName = typeof fn?.name === "string" ? fn.name : "extract";
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  type: "function",
                  function: {
                    name: toolName,
                    arguments: JSON.stringify(args),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
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
    start: makeStart(maxRounds),
    steps,
  };
}

function plannerStep(phases: PlannerMeta["phases"] = DEFAULT_PHASES): RoleStep<SolveIssueMeta> {
  return {
    role: "planner",
    content: "plan",
    meta: { phases },
    timestamp: 1,
  };
}

function coderStep(completedPhase = "phase-a"): RoleStep<SolveIssueMeta> {
  return {
    role: "coder",
    content: "code",
    meta: { completedPhase, filesChanged: ["a.ts"], summary: "fixed" },
    timestamp: 2,
  };
}

function reviewerStep(approved: boolean): RoleStep<SolveIssueMeta> {
  return {
    role: "reviewer",
    content: "rev",
    meta: approved
      ? { status: "approved" as const }
      : { status: "rejected" as const, issues: ["needs fix"] },
    timestamp: 3,
  };
}

function committerStep(): RoleStep<SolveIssueMeta> {
  return {
    role: "committer",
    content: "commit",
    meta: { status: "committed", branch: "feat/issue-1", commitSha: "abc1234" },
    timestamp: 4,
  };
}

const stubExtract = createExtract({
  baseUrl: "http://127.0.0.1:9",
  apiKey: "",
  model: "test",
});

describe("solveIssueModerator", () => {
  test("routes planner → coder → reviewer → committer → END", () => {
    expect(solveIssueModerator(makeCtx(20, []))).toBe("planner");
    expect(solveIssueModerator(makeCtx(20, [plannerStep()]))).toBe("coder");
    expect(solveIssueModerator(makeCtx(20, [plannerStep(), coderStep()]))).toBe("reviewer");
    expect(solveIssueModerator(makeCtx(20, [plannerStep(), coderStep(), reviewerStep(true)]))).toBe(
      "committer",
    );
    expect(
      solveIssueModerator(
        makeCtx(20, [plannerStep(), coderStep(), reviewerStep(true), committerStep()]),
      ),
    ).toBe(END);
  });

  test("reviewer rejects → coder retry when budget allows", () => {
    const steps: ModeratorContext<SolveIssueMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(false),
    ];
    expect(solveIssueModerator(makeCtx(20, steps))).toBe("coder");
  });

  test("reviewer rejects → END when max rounds exhausted", () => {
    const steps: ModeratorContext<SolveIssueMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(false),
    ];
    expect(solveIssueModerator(makeCtx(4, steps))).toBe(END);
  });

  test("multiple planner phases → coder until all complete, then reviewer", () => {
    const phases: PlannerMeta["phases"] = [
      { name: "p1", description: "first", acceptance: "a1" },
      { name: "p2", description: "second", acceptance: "a2" },
    ];
    expect(solveIssueModerator(makeCtx(20, [plannerStep(phases)]))).toBe("coder");
    expect(solveIssueModerator(makeCtx(20, [plannerStep(phases), coderStep("p1")]))).toBe("coder");
    expect(
      solveIssueModerator(makeCtx(20, [plannerStep(phases), coderStep("p1"), coderStep("p2")])),
    ).toBe("reviewer");
  });

  test("one-shot coder reports only last phase name → reviewer (moderator treats as all phases done)", () => {
    const phases: PlannerMeta["phases"] = [
      { name: "setup-branch", description: "branch", acceptance: "branch exists" },
      { name: "write-tests", description: "tests", acceptance: "tests pass" },
      { name: "verify", description: "verify", acceptance: "ok" },
      { name: "commit-and-pr", description: "pr", acceptance: "pr open" },
    ];
    expect(
      solveIssueModerator(makeCtx(20, [plannerStep(phases), coderStep("commit-and-pr")])),
    ).toBe("reviewer");
  });

  test("completedPhase sentinel when not a planned name → reviewer", () => {
    const phases: PlannerMeta["phases"] = [
      { name: "p1", description: "first", acceptance: "a1" },
      { name: "p2", description: "second", acceptance: "a2" },
    ];
    expect(solveIssueModerator(makeCtx(20, [plannerStep(phases), coderStep("all-done")]))).toBe(
      "reviewer",
    );
  });

  test("incomplete phases → END when max rounds exhausted", () => {
    const phases: PlannerMeta["phases"] = [
      { name: "p1", description: "first", acceptance: "a1" },
      { name: "p2", description: "second", acceptance: "a2" },
    ];
    const steps: ModeratorContext<SolveIssueMeta>["steps"] = [plannerStep(phases), coderStep("p1")];
    expect(solveIssueModerator(makeCtx(3, steps))).toBe(END);
  });
});

describe("createSolveIssueRun", () => {
  let restoreFetch: (() => void) | null = null;

  afterEach(() => {
    restoreFetch?.();
    restoreFetch = null;
  });

  test("structured extraction yields planner meta from mocked chat completions", async () => {
    restoreFetch = installMockChatCompletions([EXPECT_PLANNER_META]);

    const run = createSolveIssueRun({ agent: async () => "" }, stubExtract);
    const gen = run(
      { prompt: "task", steps: [] },
      { threadId: "01TEST000000000000000000TR", maxRounds: 20 },
    );
    const first = await gen.next();
    expect(first.done).toBe(false);
    if (first.done) {
      throw new Error("expected yield");
    }
    expect(first.value.role).toBe("planner");
    expect(first.value.meta).toEqual(EXPECT_PLANNER_META);
  });

  test("per-role agent overrides default", async () => {
    restoreFetch = installMockChatCompletions([EXPECT_PLANNER_META, EXPECT_CODER_META]);

    const calls: string[] = [];
    const run = createSolveIssueRun(
      {
        agent: async () => {
          calls.push("default");
          return "";
        },
        overrides: {
          planner: async () => {
            calls.push("planner");
            return "";
          },
          coder: async () => {
            calls.push("coder");
            return "";
          },
        },
      },
      stubExtract,
    );
    const gen = run(
      { prompt: "task", steps: [] },
      { threadId: "01TEST000000000000000000TR", maxRounds: 20 },
    );
    await gen.next();
    expect(calls).toEqual(["planner"]);

    calls.length = 0;
    await gen.next();
    expect(calls).toEqual(["coder"]);
  });
});

describe("buildSolveIssueDescriptor", () => {
  test("lists all roles with schemas that validate", () => {
    const descriptor = buildSolveIssueDescriptor();
    const validated = validateWorkflowDescriptor(descriptor);
    expect(validated.ok).toBe(true);
    if (!validated.ok) {
      throw new Error(validated.error);
    }
    expect(Object.keys(validated.value.roles).sort()).toEqual([
      "coder",
      "committer",
      "planner",
      "reviewer",
    ]);
    for (const key of ["planner", "coder", "reviewer", "committer"] as const) {
      const role = validated.value.roles[key];
      expect(role).toBeDefined();
      expect(typeof role.schema).toBe("object");
      expect(role.schema).not.toBeNull();
      expect(Array.isArray(role.schema)).toBe(false);
    }
  });
});
