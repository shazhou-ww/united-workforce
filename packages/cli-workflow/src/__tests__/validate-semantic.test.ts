import { describe, expect, test } from "bun:test";
import type { WorkflowPayload } from "@united-workforce/protocol";
import { validateWorkflow } from "../validate-semantic.js";

/** Build a valid two-role workflow that passes all checks. */
function makeWorkflow(overrides?: Partial<WorkflowPayload>): WorkflowPayload {
  const base: WorkflowPayload = {
    name: "test-workflow",
    description: "A test workflow",
    roles: {
      writer: {
        description: "Writes content",
        goal: "Write content",
        capabilities: ["writing"],
        procedure: "Write it",
        output: "The content",
        frontmatter: {
          type: "object",
          properties: {
            $status: { enum: ["_"] },
            plan: { type: "string" },
          },
          required: ["$status", "plan"],
        } as unknown as string,
      },
      reviewer: {
        description: "Reviews content",
        goal: "Review content",
        capabilities: ["reviewing"],
        procedure: "Review it",
        output: "The review",
        frontmatter: {
          type: "object",
          oneOf: [
            {
              properties: {
                $status: { const: "approved" },
                summary: { type: "string" },
              },
              required: ["$status", "summary"],
            },
            {
              properties: {
                $status: { const: "rejected" },
                reason: { type: "string" },
              },
              required: ["$status", "reason"],
            },
          ],
        } as unknown as string,
      },
    },
    graph: {
      $START: { _: { role: "writer", prompt: "Begin writing", location: null } },
      writer: { _: { role: "reviewer", prompt: "Review this: {{{plan}}}", location: null } },
      reviewer: {
        approved: { role: "$END", prompt: "Done: {{{summary}}}", location: null },
        rejected: { role: "writer", prompt: "Fix: {{{reason}}}", location: null },
      },
    },
  };

  if (!overrides) return base;
  return { ...base, ...overrides };
}

describe("Suite 1: Role Reference Integrity", () => {
  test("1.1 graph references unknown role", () => {
    const wf = makeWorkflow();
    wf.graph.nonexistent = { _: { role: "$END", prompt: "done", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes('unknown role "nonexistent"'))).toBe(true);
  });

  test("1.2 orphan role not in graph", () => {
    const wf = makeWorkflow();
    wf.roles.orphan = {
      description: "Orphan",
      goal: "Nothing",
      capabilities: [],
      procedure: "None",
      output: "None",
      frontmatter: {
        type: "object",
        properties: { $status: { enum: ["_"] } },
        required: ["$status"],
      } as unknown as string,
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('role "orphan" is defined but not referenced in graph')),
    ).toBe(true);
  });

  test("1.3 $START in roles", () => {
    const wf = makeWorkflow();
    (wf.roles as Record<string, unknown>).$START = {
      description: "Bad",
      goal: "Bad",
      capabilities: [],
      procedure: "Bad",
      output: "Bad",
      frontmatter: { type: "object", properties: {}, required: [] },
    };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes('reserved name "$START"'))).toBe(true);
  });

  test("1.4 $END in roles", () => {
    const wf = makeWorkflow();
    (wf.roles as Record<string, unknown>).$END = {
      description: "Bad",
      goal: "Bad",
      capabilities: [],
      procedure: "Bad",
      output: "Bad",
      frontmatter: { type: "object", properties: {}, required: [] },
    };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes('reserved name "$END"'))).toBe(true);
  });

  test("1.5 valid workflow returns no errors", () => {
    const wf = makeWorkflow();
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });
});

describe("Suite 2: Graph Structure", () => {
  test("2.1 $START missing from graph", () => {
    const wf = makeWorkflow();
    delete wf.graph.$START;
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("$START must be defined in graph"))).toBe(true);
  });

  test("2.2 $START has multiple status keys", () => {
    const wf = makeWorkflow();
    wf.graph.$START = {
      _: { role: "writer", prompt: "Begin", location: null },
      other: { role: "reviewer", prompt: "Also", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('$START must have exactly one edge with status "_"')),
    ).toBe(true);
  });

  test("2.3 $START edge uses non-_ status", () => {
    const wf = makeWorkflow();
    wf.graph.$START = { ready: { role: "writer", prompt: "Begin", location: null } };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('$START must have exactly one edge with status "_"')),
    ).toBe(true);
  });

  test("2.4 $END has outgoing edges", () => {
    const wf = makeWorkflow();
    wf.graph.$END = { _: { role: "writer", prompt: "Loop", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("$END must not have outgoing edges"))).toBe(true);
  });

  test("2.5 unreachable role", () => {
    const wf = makeWorkflow();
    wf.roles.isolated = {
      description: "Isolated",
      goal: "Isolated",
      capabilities: [],
      procedure: "Isolated",
      output: "Isolated",
      frontmatter: {
        type: "object",
        properties: { $status: { enum: ["_"] } },
        required: ["$status"],
      } as unknown as string,
    };
    wf.graph.isolated = { _: { role: "$END", prompt: "done", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes('role "isolated" is not reachable from $START'))).toBe(
      true,
    );
  });

  test("2.6 edge target references invalid role", () => {
    const wf = makeWorkflow();
    wf.graph.writer = { _: { role: "ghost", prompt: "Go to ghost", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes('unknown target role "ghost"'))).toBe(true);
  });
});

describe("Suite 3: Status-Edge Consistency", () => {
  test("3.1 single-exit role with multiple graph keys", () => {
    const wf = makeWorkflow();
    wf.graph.writer = {
      _: { role: "reviewer", prompt: "Review", location: null },
      extra: { role: "$END", prompt: "Done", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) =>
        e.includes('role "writer" is single-exit but has status keys other than "_"'),
      ),
    ).toBe(true);
  });

  test("3.2 single-exit role missing _ key", () => {
    const wf = makeWorkflow();
    wf.graph.writer = { done: { role: "reviewer", prompt: "Review", location: null } };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('role "writer" is single-exit but graph has no "_" key')),
    ).toBe(true);
  });

  test("3.3 multi-exit role with extra statuses", () => {
    const wf = makeWorkflow();
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done", location: null },
      rejected: { role: "writer", prompt: "Fix", location: null },
      timeout: { role: "$END", prompt: "Timed out", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('role "reviewer" graph has extra status keys: timeout')),
    ).toBe(true);
  });

  test("3.4 multi-exit role missing a status", () => {
    const wf = makeWorkflow();
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('role "reviewer" graph is missing status keys: rejected')),
    ).toBe(true);
  });

  test("3.5 multi-exit role with _ key", () => {
    const wf = makeWorkflow();
    wf.graph.reviewer = { _: { role: "$END", prompt: "Done", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes('role "reviewer" is multi-exit but graph uses "_"'))).toBe(
      true,
    );
  });
});

describe("Suite 3b: Enum-Based Multi-Exit", () => {
  test("3b.1 enum multi-exit passes with matching graph keys", () => {
    const wf = makeWorkflow();
    wf.roles.reviewer = {
      ...wf.roles.reviewer,
      frontmatter: {
        type: "object",
        properties: {
          $status: { enum: ["approved", "rejected"] },
          comments: { type: "string" },
        },
        required: ["$status", "comments"],
      } as unknown as string,
    };
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done", location: null },
      rejected: { role: "writer", prompt: "Fix: {{{comments}}}", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });

  test("3b.2 enum multi-exit with extra graph key", () => {
    const wf = makeWorkflow();
    wf.roles.reviewer = {
      ...wf.roles.reviewer,
      frontmatter: {
        type: "object",
        properties: {
          $status: { enum: ["approved", "rejected"] },
          comments: { type: "string" },
        },
        required: ["$status", "comments"],
      } as unknown as string,
    };
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done", location: null },
      rejected: { role: "writer", prompt: "Fix", location: null },
      timeout: { role: "$END", prompt: "Timed out", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("extra status keys: timeout"))).toBe(true);
  });

  test("3b.3 enum multi-exit with missing graph key", () => {
    const wf = makeWorkflow();
    wf.roles.reviewer = {
      ...wf.roles.reviewer,
      frontmatter: {
        type: "object",
        properties: {
          $status: { enum: ["approved", "rejected"] },
          comments: { type: "string" },
        },
        required: ["$status", "comments"],
      } as unknown as string,
    };
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("missing status keys: rejected"))).toBe(true);
  });

  test("3b.4 enum with single value (not multi-exit) treated as single-exit", () => {
    const wf = makeWorkflow();
    wf.roles.writer = {
      ...wf.roles.writer,
      frontmatter: {
        type: "object",
        properties: {
          $status: { enum: ["_"] },
          plan: { type: "string" },
        },
        required: ["$status", "plan"],
      } as unknown as string,
    };
    wf.graph.writer = { _: { role: "reviewer", prompt: "Review: {{{plan}}}", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });

  test("3b.5 enum multi-exit mustache var not in frontmatter", () => {
    const wf = makeWorkflow();
    wf.roles.reviewer = {
      ...wf.roles.reviewer,
      frontmatter: {
        type: "object",
        properties: {
          $status: { enum: ["approved", "rejected"] },
          comments: { type: "string" },
        },
        required: ["$status", "comments"],
      } as unknown as string,
    };
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done: {{{nonexistent}}}", location: null },
      rejected: { role: "writer", prompt: "Fix: {{{comments}}}", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("nonexistent") && e.includes("not found"))).toBe(true);
  });
});

describe("Suite 4: Mustache Template Variable Existence", () => {
  test("4.1 prompt references nonexistent variable (single-exit)", () => {
    const wf = makeWorkflow();
    wf.graph.writer = { _: { role: "reviewer", prompt: "Review: {{{branch}}}", location: null } };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) =>
        e.includes('prompt variable "branch" not found in role "writer" frontmatter'),
      ),
    ).toBe(true);
  });

  test("4.2 prompt references nonexistent variable (multi-exit)", () => {
    const wf = makeWorkflow();
    wf.graph.reviewer = {
      approved: { role: "$END", prompt: "Done: {{{branch}}}", location: null },
      rejected: { role: "writer", prompt: "Fix: {{{reason}}}", location: null },
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) =>
        e.includes('prompt variable "branch" not found in role "reviewer" variant "approved"'),
      ),
    ).toBe(true);
  });

  test("4.3 valid mustache variables pass", () => {
    const wf = makeWorkflow();
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });

  test("4.4 $status variable is always valid", () => {
    const wf = makeWorkflow();
    wf.graph.writer = { _: { role: "reviewer", prompt: "Status: {{$status}}", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });
});

describe("Suite 5: oneOf Discriminant Validity", () => {
  test("5.1 oneOf without $status const", () => {
    const wf = makeWorkflow();
    wf.roles.reviewer = {
      ...wf.roles.reviewer,
      frontmatter: {
        type: "object",
        oneOf: [
          { properties: { summary: { type: "string" } }, required: ["summary"] },
          { properties: { reason: { type: "string" } }, required: ["reason"] },
        ],
      } as unknown as string,
    };
    const errors = validateWorkflow(wf);
    expect(
      errors.some((e) => e.includes('oneOf variants must have "$status" as const discriminant')),
    ).toBe(true);
  });

  test("5.2 oneOf with non-const $status", () => {
    const wf = makeWorkflow();
    wf.roles.reviewer = {
      ...wf.roles.reviewer,
      frontmatter: {
        type: "object",
        oneOf: [
          {
            properties: { $status: { type: "string" }, summary: { type: "string" } },
            required: ["$status", "summary"],
          },
          {
            properties: { $status: { type: "string" }, reason: { type: "string" } },
            required: ["$status", "reason"],
          },
        ],
      } as unknown as string,
    };
    const errors = validateWorkflow(wf);
    expect(errors.some((e) => e.includes("oneOf variant $status must be a const value"))).toBe(
      true,
    );
  });

  test("5.3 valid oneOf passes", () => {
    const wf = makeWorkflow();
    const errors = validateWorkflow(wf);
    expect(errors).toEqual([]);
  });
});

describe("Suite 6: Multiple Errors Collection", () => {
  test("6.1 multiple errors collected", () => {
    const wf = makeWorkflow();
    // orphan role
    wf.roles.orphan = {
      description: "Orphan",
      goal: "Nothing",
      capabilities: [],
      procedure: "None",
      output: "None",
      frontmatter: {
        type: "object",
        properties: { $status: { enum: ["_"] } },
        required: ["$status"],
      } as unknown as string,
    };
    // unknown graph reference
    wf.graph.nonexistent = { _: { role: "$END", prompt: "done", location: null } };
    // bad mustache var
    wf.graph.writer = { _: { role: "reviewer", prompt: "{{{badvar}}}", location: null } };
    const errors = validateWorkflow(wf);
    expect(errors.length).toBeGreaterThanOrEqual(3);
  });
});
