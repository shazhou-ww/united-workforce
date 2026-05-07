import { describe, expect, test } from "bun:test";
import {
  END,
  type ModeratorContext,
  type RoleStep,
  START,
  validateWorkflowDescriptor,
} from "@uncaged/workflow";

import type { CommitterMeta } from "@uncaged/workflow-role-committer";
import type { PlannerMeta } from "@uncaged/workflow-role-planner";

import { buildDevelopDescriptor } from "../src/descriptor.js";
import { developModerator } from "../src/index.js";
import type { DevelopMeta } from "../src/roles.js";

const DEFAULT_PHASES: PlannerMeta["phases"] = [
  {
    hash: "4KNMR2PX",
    title: "Do the work",
  },
];

function makeStart(maxRounds: number): ModeratorContext<DevelopMeta>["start"] {
  return {
    role: START,
    content: "Implement the feature",
    meta: { maxRounds },
    timestamp: 0,
  };
}

function makeCtx(
  maxRounds: number,
  steps: ModeratorContext<DevelopMeta>["steps"],
): ModeratorContext<DevelopMeta> {
  return {
    threadId: "01TEST000000000000000000TR",
    depth: 0,
    start: makeStart(maxRounds),
    steps,
  };
}

function plannerStep(phases: PlannerMeta["phases"] = DEFAULT_PHASES): RoleStep<DevelopMeta> {
  return {
    role: "planner",
    contentHash: "STUBHASHPLANNER001",
    meta: { phases },
    refs: phases.map((p) => p.hash),
    timestamp: 1,
  };
}

function coderStep(completedPhase = "4KNMR2PX"): RoleStep<DevelopMeta> {
  return {
    role: "coder",
    contentHash: "STUBHASHCODER00001",
    meta: { completedPhase, filesChanged: ["a.ts"], summary: "implemented" },
    refs: [completedPhase],
    timestamp: 2,
  };
}

function reviewerStep(approved: boolean): RoleStep<DevelopMeta> {
  return {
    role: "reviewer",
    contentHash: "STUBHASHREVIEWER01",
    meta: approved
      ? { status: "approved" as const }
      : { status: "rejected" as const, issues: ["needs fix"] },
    refs: [],
    timestamp: 3,
  };
}

function testerStep(passed: boolean): RoleStep<DevelopMeta> {
  return {
    role: "tester",
    contentHash: "STUBHASHTESTER01",
    meta: passed
      ? { status: "passed" as const, details: "all checks passed" }
      : { status: "failed" as const, details: "lint failed" },
    refs: [],
    timestamp: 4,
  };
}

function committerStep(meta: CommitterMeta): RoleStep<DevelopMeta> {
  return {
    role: "committer",
    contentHash: "STUBHASHCOMMITTER1",
    meta,
    refs: [],
    timestamp: 5,
  };
}

describe("developModerator", () => {
  test("routes initial → planner → coder → reviewer → tester → committer → END", () => {
    expect(developModerator(makeCtx(20, []))).toBe("planner");
    expect(developModerator(makeCtx(20, [plannerStep()]))).toBe("coder");
    expect(developModerator(makeCtx(20, [plannerStep(), coderStep()]))).toBe("reviewer");
    expect(developModerator(makeCtx(20, [plannerStep(), coderStep(), reviewerStep(true)]))).toBe(
      "tester",
    );
    expect(
      developModerator(
        makeCtx(20, [plannerStep(), coderStep(), reviewerStep(true), testerStep(true)]),
      ),
    ).toBe("committer");
    expect(
      developModerator(
        makeCtx(20, [
          plannerStep(),
          coderStep(),
          reviewerStep(true),
          testerStep(true),
          committerStep({ status: "committed", branch: "feat/x", commitSha: "abc1234" }),
        ]),
      ),
    ).toBe(END);
  });

  test("reviewer rejects → coder retry when budget allows", () => {
    const steps: ModeratorContext<DevelopMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(false),
    ];
    expect(developModerator(makeCtx(20, steps))).toBe("coder");
  });

  test("reviewer rejects → END when max rounds exhausted", () => {
    const steps: ModeratorContext<DevelopMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(false),
    ];
    expect(developModerator(makeCtx(4, steps))).toBe(END);
  });

  test("tester failed → coder retry when budget allows", () => {
    const steps: ModeratorContext<DevelopMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(true),
      testerStep(false),
    ];
    expect(developModerator(makeCtx(20, steps))).toBe("coder");
  });

  test("tester failed → END when max rounds exhausted", () => {
    const steps: ModeratorContext<DevelopMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(true),
      testerStep(false),
    ];
    expect(developModerator(makeCtx(5, steps))).toBe(END);
  });

  test("multiple planner phases → coder until all complete, then reviewer", () => {
    const phases: PlannerMeta["phases"] = [
      { hash: "AA000001", title: "first phase" },
      { hash: "AA000002", title: "second phase" },
    ];
    expect(developModerator(makeCtx(20, [plannerStep(phases)]))).toBe("coder");
    expect(developModerator(makeCtx(20, [plannerStep(phases), coderStep("AA000001")]))).toBe(
      "coder",
    );
    expect(
      developModerator(
        makeCtx(20, [plannerStep(phases), coderStep("AA000001"), coderStep("AA000002")]),
      ),
    ).toBe("reviewer");
  });

  test("one-shot coder reports only last phase hash → reviewer (moderator treats as all phases done)", () => {
    const phases: PlannerMeta["phases"] = [
      { hash: "BB000001", title: "setup branch" },
      { hash: "BB000002", title: "write tests" },
      { hash: "BB000003", title: "verify" },
      { hash: "BB000004", title: "polish" },
    ];
    expect(developModerator(makeCtx(20, [plannerStep(phases), coderStep("BB000004")]))).toBe(
      "reviewer",
    );
  });

  test("unrecognised completedPhase hash → coder retry when budget allows", () => {
    const phases: PlannerMeta["phases"] = [
      { hash: "CC000001", title: "first phase" },
      { hash: "CC000002", title: "second phase" },
    ];
    expect(developModerator(makeCtx(20, [plannerStep(phases), coderStep("all-done")]))).toBe(
      "coder",
    );
  });

  test("incomplete phases → END when max rounds exhausted", () => {
    const phases: PlannerMeta["phases"] = [
      { hash: "DD000001", title: "first phase" },
      { hash: "DD000002", title: "second phase" },
    ];
    const steps: ModeratorContext<DevelopMeta>["steps"] = [
      plannerStep(phases),
      coderStep("DD000001"),
    ];
    expect(developModerator(makeCtx(3, steps))).toBe(END);
  });

  test("committer → END for any committer meta status", () => {
    const committed = committerStep({ status: "committed", branch: "f", commitSha: "x" });
    const recoverable = committerStep({
      status: "recoverable",
      error: "merge conflict",
      logRef: null,
    });
    const unrecoverable = committerStep({
      status: "unrecoverable",
      error: "repo missing",
      logRef: "log1",
    });
    const base: ModeratorContext<DevelopMeta>["steps"] = [
      plannerStep(),
      coderStep(),
      reviewerStep(true),
      testerStep(true),
    ];
    expect(developModerator(makeCtx(20, [...base, committed]))).toBe(END);
    expect(developModerator(makeCtx(20, [...base, recoverable]))).toBe(END);
    expect(developModerator(makeCtx(20, [...base, unrecoverable]))).toBe(END);
  });
});

describe("buildDevelopDescriptor", () => {
  test("lists all roles with schemas that validate", () => {
    const descriptor = buildDevelopDescriptor();
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
      "tester",
    ]);
    for (const key of ["planner", "coder", "reviewer", "tester", "committer"] as const) {
      const role = validated.value.roles[key];
      expect(role).toBeDefined();
      expect(typeof role.schema).toBe("object");
      expect(role.schema).not.toBeNull();
      expect(Array.isArray(role.schema)).toBe(false);
    }
  });
});
