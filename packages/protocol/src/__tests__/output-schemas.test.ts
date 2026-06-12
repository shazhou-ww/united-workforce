import { bootstrap, createMemoryStore, putSchema, validate } from "@ocas/core";
import { describe, expect, test } from "vitest";
import {
  OUTPUT_SCHEMAS,
  outputSchemaVarName,
  STEP_DETAIL_OUTPUT_SCHEMA,
  STEP_LIST_OUTPUT_SCHEMA,
  THREAD_EXEC_OUTPUT_SCHEMA,
  THREAD_LIST_OUTPUT_SCHEMA,
  THREAD_START_OUTPUT_SCHEMA,
  THREAD_STATUS_OUTPUT_SCHEMA,
  VALIDATE_RESULT_OUTPUT_SCHEMA,
  WORKFLOW_ADD_OUTPUT_SCHEMA,
  WORKFLOW_DETAIL_OUTPUT_SCHEMA,
  WORKFLOW_LIST_OUTPUT_SCHEMA,
} from "../output-schemas.js";

function setupStore() {
  const store = createMemoryStore();
  bootstrap(store);
  return store;
}

describe("CLI output schemas — exports and identity", () => {
  test("OUTPUT_SCHEMAS map covers all ten output schema names", () => {
    expect(Object.keys(OUTPUT_SCHEMAS).sort()).toEqual([
      "step-detail",
      "step-list",
      "thread-exec",
      "thread-list",
      "thread-start",
      "thread-status",
      "validate-result",
      "workflow-add",
      "workflow-detail",
      "workflow-list",
    ]);
  });

  test("each schema has matching @uwf/output/<name> title", () => {
    for (const [name, schema] of Object.entries(OUTPUT_SCHEMAS)) {
      const title = (schema as { title?: string }).title;
      expect(title).toBe(`@uwf/output/${name}`);
    }
  });

  test("each schema sets additionalProperties: false at the top level", () => {
    for (const [, schema] of Object.entries(OUTPUT_SCHEMAS)) {
      const ap = (schema as { additionalProperties?: unknown }).additionalProperties;
      expect(ap).toBe(false);
    }
  });

  test("outputSchemaVarName returns @uwf/output/<name>", () => {
    expect(outputSchemaVarName("thread-start")).toBe("@uwf/output/thread-start");
    expect(outputSchemaVarName("validate-result")).toBe("@uwf/output/validate-result");
  });
});

describe("THREAD_START_OUTPUT_SCHEMA", () => {
  test("accepts valid thread-start payload", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_START_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      threadId: "06FBA1Q7M1CKY5RF2V1VKBX0WR",
      workflowHash: "D7SX84RSZG22V",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects payload missing threadId", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_START_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { workflowHash: "D7SX84RSZG22V" });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("rejects payload with extra unknown field", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_START_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      threadId: "06FBA1Q7M1CKY5RF2V1VKBX0WR",
      workflowHash: "D7SX84RSZG22V",
      extra: "nope",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });
});

describe("THREAD_STATUS_OUTPUT_SCHEMA", () => {
  const sample = {
    threadId: "06FBA1Q7M1CKY5RF2V1VKBX0WR",
    workflowHash: "D7SX84RSZG22V",
    head: "49RG4YFX95AYA",
    status: "idle",
    currentRole: "developer",
    suspendedRole: null,
    suspendMessage: null,
    done: false,
  };

  test("accepts a fully populated payload", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_STATUS_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, sample);
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts head=null and currentRole=null for idle/end states", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_STATUS_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      ...sample,
      head: null,
      currentRole: null,
      status: "end",
      done: true,
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects unknown status value", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_STATUS_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { ...sample, status: "bogus" });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });
});

describe("THREAD_LIST_OUTPUT_SCHEMA", () => {
  test("accepts an empty items array", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_LIST_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { items: [] });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts items with all required fields", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_LIST_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      items: [
        {
          threadId: "06FBA1Q7M1CKY5RF2V1VKBX0WR",
          workflowHash: "D7SX84RSZG22V",
          workflowName: "solve-issue",
          status: "idle",
          currentRole: "developer",
          startedAt: 1716600000000,
          completedAt: null,
        },
      ],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });
});

describe("THREAD_EXEC_OUTPUT_SCHEMA", () => {
  test("accepts steps[] with suspendedRole and suspendMessage", () => {
    const store = setupStore();
    const hash = putSchema(store, THREAD_EXEC_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      threadId: "06FBA1Q7M1CKY5RF2V1VKBX0WR",
      workflowHash: "D7SX84RSZG22V",
      steps: [
        {
          head: "49RG4YFX95AYA",
          status: "suspended",
          currentRole: null,
          done: false,
          role: "worker",
          suspendedRole: "worker",
          suspendMessage: "Please clarify",
        },
      ],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });
});

describe("STEP_DETAIL_OUTPUT_SCHEMA", () => {
  test("accepts a step detail payload", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_DETAIL_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      hash: "49RG4YFX95AYA",
      role: "developer",
      agent: "uwf-claude-code",
      status: "completed",
      startedAtMs: 1716600000000,
      completedAtMs: 1716600045200,
      durationMs: 45200,
      frontmatter: { $status: "done" },
      turns: [],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });
});

describe("STEP_LIST_OUTPUT_SCHEMA", () => {
  test("accepts items with hash, role, durationMs", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_LIST_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      threadId: "06FBA1Q7M1CKY5RF2V1VKBX0WR",
      items: [
        { hash: "49RG4YFX95AYA", role: "planner", durationMs: 12300 },
        { hash: "8ABC4XYZ12345", role: "developer", durationMs: 45200 },
      ],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });
});

describe("WORKFLOW_DETAIL_OUTPUT_SCHEMA", () => {
  test("accepts a workflow detail payload", () => {
    const store = setupStore();
    const hash = putSchema(store, WORKFLOW_DETAIL_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      name: "solve-issue",
      hash: "76C98RVXA5E4F",
      version: 1,
      description: "Solve issues via plan + code + review",
      roles: {
        planner: { description: "Plans the work" },
      },
      graph: {
        $START: { new: { role: "planner" } },
      },
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });
});

describe("WORKFLOW_LIST_OUTPUT_SCHEMA", () => {
  test("accepts list with name/hash/source/description", () => {
    const store = setupStore();
    const hash = putSchema(store, WORKFLOW_LIST_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      items: [
        {
          name: "solve-issue",
          hash: "76C98RVXA5E4F",
          source: ".workflows",
          description: "solve issues",
        },
      ],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });
});

describe("WORKFLOW_ADD_OUTPUT_SCHEMA", () => {
  test("accepts a workflow-add payload", () => {
    const store = setupStore();
    const hash = putSchema(store, WORKFLOW_ADD_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      name: "review-pr",
      hash: "2TBP6T37TZAJZ",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects payload missing name", () => {
    const store = setupStore();
    const hash = putSchema(store, WORKFLOW_ADD_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { hash: "2TBP6T37TZAJZ" });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("rejects payload missing hash", () => {
    const store = setupStore();
    const hash = putSchema(store, WORKFLOW_ADD_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { name: "review-pr" });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("rejects payload with extra unknown field", () => {
    const store = setupStore();
    const hash = putSchema(store, WORKFLOW_ADD_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      name: "review-pr",
      hash: "2TBP6T37TZAJZ",
      extra: "nope",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("schema title is @uwf/output/workflow-add", () => {
    expect((WORKFLOW_ADD_OUTPUT_SCHEMA as { title?: string }).title).toBe(
      "@uwf/output/workflow-add",
    );
  });

  test("outputSchemaVarName('workflow-add') returns @uwf/output/workflow-add", () => {
    expect(outputSchemaVarName("workflow-add")).toBe("@uwf/output/workflow-add");
  });
});

describe("VALIDATE_RESULT_OUTPUT_SCHEMA", () => {
  test("accepts valid=true with empty errors[]", () => {
    const store = setupStore();
    const hash = putSchema(store, VALIDATE_RESULT_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { valid: true, errors: [] });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts valid=false with multiple errors", () => {
    const store = setupStore();
    const hash = putSchema(store, VALIDATE_RESULT_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, {
      valid: false,
      errors: ['unknown role "bogus"', "$START missing resume edge"],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects errors[] containing non-string", () => {
    const store = setupStore();
    const hash = putSchema(store, VALIDATE_RESULT_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { valid: false, errors: [42] });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("rejects payload missing valid", () => {
    const store = setupStore();
    const hash = putSchema(store, VALIDATE_RESULT_OUTPUT_SCHEMA);
    const ref = store.cas.put(hash, { errors: [] });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });
});

describe("schema registration is content-addressed (idempotent)", () => {
  test("registering the same schema twice yields the same hash", () => {
    const store = setupStore();
    const h1 = putSchema(store, THREAD_STATUS_OUTPUT_SCHEMA);
    const h2 = putSchema(store, THREAD_STATUS_OUTPUT_SCHEMA);
    expect(h1).toBe(h2);
  });

  test("different schemas have different hashes", () => {
    const store = setupStore();
    const h1 = putSchema(store, THREAD_STATUS_OUTPUT_SCHEMA);
    const h2 = putSchema(store, THREAD_START_OUTPUT_SCHEMA);
    expect(h1).not.toBe(h2);
  });
});
