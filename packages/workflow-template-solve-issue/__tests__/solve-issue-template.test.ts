import { describe, expect, test } from "bun:test";
import {
  type AgentFn,
  END,
  type RoleStep,
  START,
  type ThreadContext,
  validateWorkflowDescriptor,
} from "@uncaged/workflow";

import type { PlannerMeta } from "@uncaged/workflow-role-planner";

import { buildSolveIssueDescriptor } from "../src/descriptor.js";
import { solveIssueModerator } from "../src/moderator.js";
import { createSolveIssueRoles, type SolveIssueMeta } from "../src/roles.js";

const DEFAULT_PHASES: PlannerMeta["phases"] = [
  { name: "phase-a", description: "Do the work", acceptance: "Done" },
];

function makeStart(maxRounds: number): ThreadContext<SolveIssueMeta>["start"] {
  return {
    role: START,
    content: "Fix the flaky login test",
    meta: { maxRounds },
    timestamp: 0,
  };
}

function makeCtx(
  maxRounds: number,
  steps: ThreadContext<SolveIssueMeta>["steps"],
): ThreadContext<SolveIssueMeta> {
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
    const steps: ThreadContext<SolveIssueMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(false),
    ];
    expect(solveIssueModerator(makeCtx(20, steps))).toBe("coder");
  });

  test("reviewer rejects → END when max rounds exhausted", () => {
    const steps: ThreadContext<SolveIssueMeta>["steps"] = [
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

  test("incomplete phases → END when max rounds exhausted", () => {
    const phases: PlannerMeta["phases"] = [
      { name: "p1", description: "first", acceptance: "a1" },
      { name: "p2", description: "second", acceptance: "a2" },
    ];
    const steps: ThreadContext<SolveIssueMeta>["steps"] = [plannerStep(phases), coderStep("p1")];
    expect(solveIssueModerator(makeCtx(3, steps))).toBe(END);
  });
});

describe("createSolveIssueRoles", () => {
  test("returns all four role callables", async () => {
    const agent = async () => '{"phases":[{"name":"x","description":"d","acceptance":"a"}]}';
    const roles = createSolveIssueRoles({
      agent,
      workdir: "/tmp/repo",
      extract: null,
    });

    expect(typeof roles.planner.run).toBe("function");
    expect(typeof roles.coder.run).toBe("function");
    expect(typeof roles.reviewer.run).toBe("function");
    expect(typeof roles.committer.run).toBe("function");

    const ctx = makeCtx(10, []);
    const plannerOut = await roles.planner.run(ctx as unknown as ThreadContext);
    expect(plannerOut.meta.phases).toEqual([
      { name: "phase-1", description: "placeholder", acceptance: "placeholder" },
    ]);
  });

  test("per-role agents override default agent", async () => {
    const calls: string[] = [];
    const tag =
      (label: string): AgentFn =>
      async () => {
        calls.push(label);
        return "";
      };

    const roles = createSolveIssueRoles({
      agent: tag("default"),
      agents: {
        planner: tag("planner"),
        coder: tag("coder"),
      },
      workdir: "/tmp/repo",
      extract: null,
    });

    const ctx = makeCtx(10, []);
    await roles.planner.run(ctx as unknown as ThreadContext);
    expect(calls).toEqual(["planner"]);

    calls.length = 0;
    await roles.coder.run(ctx as unknown as ThreadContext);
    expect(calls).toEqual(["coder"]);

    calls.length = 0;
    await roles.reviewer.run(ctx as unknown as ThreadContext);
    expect(calls).toEqual(["default"]);
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
