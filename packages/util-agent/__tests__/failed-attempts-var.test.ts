import { bootstrap, createMemoryStore, putSchema } from "@ocas/core";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { beforeEach, describe, expect, test } from "vitest";

import { appendFailedAttempt, clearFailedAttempts, readFailedAttempts } from "../src/run.js";

const TEXT_SCHEMA = { type: "string" as const };

function setup() {
  const store = createMemoryStore();
  bootstrap(store);
  const textSchema = putSchema(store, TEXT_SCHEMA);
  return { store, textSchema };
}

const THREAD = "01JTESTFAILEDATTEMPTS000001" as ThreadId;
const ROLE = "planner";

describe("failed-attempts variable store", () => {
  let env: ReturnType<typeof setup>;

  beforeEach(() => {
    env = setup();
  });

  test("readFailedAttempts returns null when nothing is recorded", () => {
    expect(readFailedAttempts(env.store, THREAD, ROLE)).toBeNull();
  });

  test("appendFailedAttempt records a hash readable via readFailedAttempts", async () => {
    const hashA = "STEP00000000A" as CasRef;
    const result = await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashA);
    expect(result).toEqual([hashA]);
    expect(readFailedAttempts(env.store, THREAD, ROLE)).toEqual([hashA]);
  });

  test("appendFailedAttempt accumulates hashes in chronological order", async () => {
    const hashA = "STEP00000000A" as CasRef;
    const hashB = "STEP00000000B" as CasRef;
    const hashC = "STEP00000000C" as CasRef;
    await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashA);
    await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashB);
    const final = await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashC);
    expect(final).toEqual([hashA, hashB, hashC]);
    expect(readFailedAttempts(env.store, THREAD, ROLE)).toEqual([hashA, hashB, hashC]);
  });

  test("the variable value is a CAS ref, not raw JSON", async () => {
    const hashA = "STEP00000000A" as CasRef;
    await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashA);
    const vars = env.store.var.list({
      exactName: `@uwf/thread-failed/${THREAD}/${ROLE}`,
    });
    expect(vars).toHaveLength(1);
    const value = vars[0]?.value ?? "";
    // The value resolves to a CAS text node — it is never the JSON array itself.
    expect(value.startsWith("[")).toBe(false);
    const node = env.store.cas.get(value as CasRef);
    expect(node).not.toBeNull();
    expect(node?.payload).toBe(JSON.stringify([hashA]));
  });

  test("clearFailedAttempts removes the recorded hashes", async () => {
    const hashA = "STEP00000000A" as CasRef;
    await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashA);
    expect(readFailedAttempts(env.store, THREAD, ROLE)).not.toBeNull();

    clearFailedAttempts(env.store.var, THREAD, ROLE);
    expect(readFailedAttempts(env.store, THREAD, ROLE)).toBeNull();
  });

  test("entries are isolated per (thread, role)", async () => {
    const otherRole = "reviewer";
    const otherThread = "01JTESTFAILEDATTEMPTS000002" as ThreadId;
    const hashA = "STEP00000000A" as CasRef;
    const hashB = "STEP00000000B" as CasRef;

    await appendFailedAttempt(env.store, env.textSchema, THREAD, ROLE, hashA);
    await appendFailedAttempt(env.store, env.textSchema, THREAD, otherRole, hashB);
    await appendFailedAttempt(env.store, env.textSchema, otherThread, ROLE, hashB);

    expect(readFailedAttempts(env.store, THREAD, ROLE)).toEqual([hashA]);
    expect(readFailedAttempts(env.store, THREAD, otherRole)).toEqual([hashB]);
    expect(readFailedAttempts(env.store, otherThread, ROLE)).toEqual([hashB]);

    clearFailedAttempts(env.store.var, THREAD, ROLE);
    expect(readFailedAttempts(env.store, THREAD, ROLE)).toBeNull();
    // Clearing one (thread, role) leaves the others untouched.
    expect(readFailedAttempts(env.store, THREAD, otherRole)).toEqual([hashB]);
  });
});
