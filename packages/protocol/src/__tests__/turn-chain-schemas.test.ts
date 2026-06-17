import { bootstrap, createMemoryStore, putSchema, validate } from "@ocas/core";
import { describe, expect, test } from "vitest";
import { STEP_COMPLETE_SCHEMA, STEP_START_SCHEMA, TURN_NODE_SCHEMA } from "../schemas.js";

function setupStore() {
  const store = createMemoryStore();
  bootstrap(store);
  return store;
}

describe("STEP_START_SCHEMA", () => {
  test("has correct title", () => {
    expect(STEP_START_SCHEMA.title).toBe("StepStart");
  });

  test("has all required fields", () => {
    expect(STEP_START_SCHEMA.required).toContain("role");
    expect(STEP_START_SCHEMA.required).toContain("edgePrompt");
    expect(STEP_START_SCHEMA.required).toContain("stepIndex");
    expect(STEP_START_SCHEMA.required).toContain("prev");
    expect(STEP_START_SCHEMA.required).toContain("start");
    expect(STEP_START_SCHEMA.required).toContain("startedAtMs");
    expect(STEP_START_SCHEMA.required).toContain("cwd");
  });

  test("accepts valid step-start payload with prev=null", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_START_SCHEMA);
    const ref = store.cas.put(hash, {
      role: "planner",
      edgePrompt: "Analyze the issue",
      stepIndex: 0,
      prev: null,
      start: "0123456789ABC",
      startedAtMs: 1000,
      cwd: "/repo",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts valid step-start payload with prev=CasRef", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_START_SCHEMA);
    const ref = store.cas.put(hash, {
      role: "developer",
      edgePrompt: "Implement the fix",
      stepIndex: 1,
      prev: "PREV012345678",
      start: "0123456789ABC",
      startedAtMs: 2000,
      cwd: "/repo",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects payload missing required fields", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_START_SCHEMA);
    const ref = store.cas.put(hash, {
      role: "planner",
      edgePrompt: "Analyze",
      // missing stepIndex, prev, start, startedAtMs, cwd
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("can be registered in CAS store", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_START_SCHEMA);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(13);
  });
});

describe("STEP_COMPLETE_SCHEMA", () => {
  test("has correct title", () => {
    expect(STEP_COMPLETE_SCHEMA.title).toBe("StepComplete");
  });

  test("has all required fields", () => {
    expect(STEP_COMPLETE_SCHEMA.required).toContain("startRef");
    expect(STEP_COMPLETE_SCHEMA.required).toContain("output");
    expect(STEP_COMPLETE_SCHEMA.required).toContain("detail");
    expect(STEP_COMPLETE_SCHEMA.required).toContain("completedAtMs");
    expect(STEP_COMPLETE_SCHEMA.required).toContain("usage");
    expect(STEP_COMPLETE_SCHEMA.required).toContain("previousAttempts");
  });

  test("accepts valid step-complete payload with usage=null", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_COMPLETE_SCHEMA);
    const ref = store.cas.put(hash, {
      startRef: "0123456789ABC",
      output: "DEFGHJKMNPQRS",
      detail: "TVWXYZ0123456",
      completedAtMs: 3000,
      usage: null,
      previousAttempts: null,
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts valid step-complete payload with usage object", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_COMPLETE_SCHEMA);
    const ref = store.cas.put(hash, {
      startRef: "0123456789ABC",
      output: "DEFGHJKMNPQRS",
      detail: "TVWXYZ0123456",
      completedAtMs: 3000,
      usage: {
        turns: 5,
        inputTokens: 1000,
        outputTokens: 500,
        duration: 12.5,
      },
      previousAttempts: null,
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts valid step-complete payload with previousAttempts array", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_COMPLETE_SCHEMA);
    const ref = store.cas.put(hash, {
      startRef: "0123456789ABC",
      output: "DEFGHJKMNPQRS",
      detail: "TVWXYZ0123456",
      completedAtMs: 3000,
      usage: null,
      previousAttempts: ["ABC0123456789", "DEF0123456789"],
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects payload missing required fields", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_COMPLETE_SCHEMA);
    const ref = store.cas.put(hash, {
      startRef: "START01234567",
      // missing output, detail, completedAtMs, usage, previousAttempts
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("can be registered in CAS store", () => {
    const store = setupStore();
    const hash = putSchema(store, STEP_COMPLETE_SCHEMA);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(13);
  });
});

describe("TURN_NODE_SCHEMA", () => {
  test("has correct title", () => {
    expect(TURN_NODE_SCHEMA.title).toBe("TurnNode");
  });

  test("has all required fields", () => {
    expect(TURN_NODE_SCHEMA.required).toContain("role");
    expect(TURN_NODE_SCHEMA.required).toContain("content");
    expect(TURN_NODE_SCHEMA.required).toContain("prev");
    expect(TURN_NODE_SCHEMA.required).toContain("owner");
  });

  test("accepts valid turn-node payload with prev=null and owner=null (legacy)", () => {
    const store = setupStore();
    const hash = putSchema(store, TURN_NODE_SCHEMA);
    const ref = store.cas.put(hash, {
      role: "assistant",
      content: "Some output",
      prev: null,
      owner: null,
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("accepts valid turn-node payload with prev and owner as CasRef", () => {
    const store = setupStore();
    const hash = putSchema(store, TURN_NODE_SCHEMA);
    const ref = store.cas.put(hash, {
      role: "assistant",
      content: "Step 1 continued",
      prev: "TVWXYZ1234567",
      owner: "STEP001234567",
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("rejects payload missing required fields", () => {
    const store = setupStore();
    const hash = putSchema(store, TURN_NODE_SCHEMA);
    const ref = store.cas.put(hash, {
      role: "assistant",
      content: "Some output",
      // missing prev, owner
    });
    const node = store.cas.get(ref);
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("can be registered in CAS store", () => {
    const store = setupStore();
    const hash = putSchema(store, TURN_NODE_SCHEMA);
    expect(hash).toBeDefined();
    expect(typeof hash).toBe("string");
    expect(hash.length).toBe(13);
  });
});

describe("schema registration is content-addressed (idempotent)", () => {
  test("registering the same schema twice yields the same hash", () => {
    const store = setupStore();
    const h1 = putSchema(store, STEP_START_SCHEMA);
    const h2 = putSchema(store, STEP_START_SCHEMA);
    expect(h1).toBe(h2);
  });

  test("different schemas have different hashes", () => {
    const store = setupStore();
    const h1 = putSchema(store, STEP_START_SCHEMA);
    const h2 = putSchema(store, STEP_COMPLETE_SCHEMA);
    const h3 = putSchema(store, TURN_NODE_SCHEMA);
    expect(h1).not.toBe(h2);
    expect(h2).not.toBe(h3);
    expect(h1).not.toBe(h3);
  });
});
