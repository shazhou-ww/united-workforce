import { bootstrap, createMemoryStore, putSchema, validate } from "@ocas/core";
import { describe, expect, test } from "vitest";
import { STEP_NODE_SCHEMA } from "../schemas.js";
import type { StepNodePayload } from "../types.js";

async function setup() {
  const store = createMemoryStore();
  bootstrap(store);
  const stepSchemaHash = putSchema(store, STEP_NODE_SCHEMA);
  return { store, stepSchemaHash };
}

const BASE_PAYLOAD: StepNodePayload = {
  start: "0123456789ABC",
  prev: null,
  role: "planner",
  output: "DEFGHJKMNPQRS",
  detail: "TVWXYZ0123456",
  agent: "uwf-mock",
  edgePrompt: "go",
  startedAtMs: 1000,
  completedAtMs: 2000,
  cwd: "/tmp",
  assembledPrompt: null,
  usage: null,
  previousAttempts: null,
};

describe("STEP_NODE_SCHEMA — previousAttempts field", () => {
  test("P1. validates payload with non-empty previousAttempts array of CAS refs", async () => {
    const { store, stepSchemaHash } = await setup();
    const payload = { ...BASE_PAYLOAD, previousAttempts: ["0123456789ABC"] };
    const hash = store.cas.put(stepSchemaHash, payload);
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("P2. validates payload with previousAttempts: null", async () => {
    const { store, stepSchemaHash } = await setup();
    const payload = { ...BASE_PAYLOAD, previousAttempts: null };
    const hash = store.cas.put(stepSchemaHash, payload);
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("P3. validates legacy payload omitting previousAttempts (backward compat)", async () => {
    const { store, stepSchemaHash } = await setup();
    // Construct without previousAttempts — legacy step nodes
    const legacy: Record<string, unknown> = { ...BASE_PAYLOAD };
    delete legacy.previousAttempts;
    const hash = store.cas.put(stepSchemaHash, legacy);
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(true);
  });

  test("P4. rejects previousAttempts that is not an array or null", async () => {
    const { store, stepSchemaHash } = await setup();
    const bad: Record<string, unknown> = { ...BASE_PAYLOAD, previousAttempts: "not-an-array" };
    const hash = store.cas.put(stepSchemaHash, bad);
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });

  test("P5. rejects previousAttempts entries that are not CAS refs", async () => {
    const { store, stepSchemaHash } = await setup();
    const bad: Record<string, unknown> = {
      ...BASE_PAYLOAD,
      previousAttempts: ["not-a-cas-ref!!!"],
    };
    const hash = store.cas.put(stepSchemaHash, bad);
    const node = store.cas.get(hash);
    expect(node).not.toBeNull();
    if (node === null) throw new Error("unreachable");
    expect(validate(store, node)).toBe(false);
  });
});
