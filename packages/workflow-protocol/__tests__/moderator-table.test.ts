import { describe, expect, test } from "bun:test";

import { tableToModerator } from "../src/moderator-table.js";
import type { ModeratorContext, ModeratorTable, StartStep } from "../src/types.js";
import { END, START } from "../src/types.js";

type TestMeta = {
  planner: { plan: string };
  coder: { code: string };
  reviewer: { approved: boolean };
};

function makeCtx(roles: (keyof TestMeta & string)[]): ModeratorContext<TestMeta> {
  const steps = roles.map((role, i) => ({
    role,
    meta: {} as TestMeta[typeof role],
    contentHash: `hash-${i}`,
    refs: [],
    timestamp: Date.now() + i,
  }));
  return {
    threadId: "test-thread",
    depth: 0,
    start: {
      role: START,
      content: "test",
      meta: { maxRounds: 10 },
      timestamp: Date.now(),
    } as StartStep,
    steps,
  };
}

describe("tableToModerator", () => {
  test("START -> role A (FALLBACK) returns A on first call", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [{ condition: "FALLBACK", role: "planner" }],
      planner: [],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    expect(mod(makeCtx([]))).toBe("planner");
  });

  test("condition true wins over FALLBACK", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [
        {
          condition: {
            name: "always",
            description: "always true",
            check: () => true,
          },
          role: "planner",
        },
        { condition: "FALLBACK", role: "coder" },
      ],
      planner: [],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    expect(mod(makeCtx([]))).toBe("planner");
  });

  test("condition false falls through to FALLBACK", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [
        {
          condition: {
            name: "never",
            description: "always false",
            check: () => false,
          },
          role: "planner",
        },
        { condition: "FALLBACK", role: "coder" },
      ],
      planner: [],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    expect(mod(makeCtx([]))).toBe("coder");
  });

  test("no matching transitions returns END", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [
        {
          condition: {
            name: "never",
            description: "always false",
            check: () => false,
          },
          role: "planner",
        },
      ],
      planner: [],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    expect(mod(makeCtx([]))).toBe(END);
  });

  test("multi-step: A -> FALLBACK END returns END after A", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [{ condition: "FALLBACK", role: "planner" }],
      planner: [{ condition: "FALLBACK", role: END }],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    expect(mod(makeCtx(["planner"]))).toBe(END);
  });

  test("role not in table returns END", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [{ condition: "FALLBACK", role: "planner" }],
      planner: [{ condition: "FALLBACK", role: "coder" }],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    // coder has empty transitions array
    expect(mod(makeCtx(["planner", "coder"]))).toBe(END);
  });

  test("condition receives ctx", () => {
    const table: ModeratorTable<TestMeta> = {
      [START]: [
        {
          condition: {
            name: "has-steps",
            description: "checks ctx.steps",
            check: (ctx) => ctx.steps.length > 0,
          },
          role: "coder",
        },
        { condition: "FALLBACK", role: "planner" },
      ],
      planner: [],
      coder: [],
      reviewer: [],
    };
    const mod = tableToModerator(table);
    // No steps -> condition false -> FALLBACK -> planner
    expect(mod(makeCtx([]))).toBe("planner");
  });
});
