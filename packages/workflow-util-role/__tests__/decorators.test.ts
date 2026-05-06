import { describe, expect, test } from "bun:test";
import type { Role, ThreadContext } from "@uncaged/workflow";
import { START } from "@uncaged/workflow";

import { decorateRole, onFail, withDryRun } from "../src/decorators.js";

type TestMeta = Record<string, unknown> & { ok: boolean };

function fakeCtx(): ThreadContext {
  return {
    start: {
      role: START,
      content: "",
      meta: {
        maxRounds: 10,
      },
      timestamp: Date.now(),
    },
      steps: [],
      threadId: "01TEST000000000000000000TR",
  };
}

const successRole: Role<TestMeta> = async () => ({
  content: "done",
  meta: { ok: true },
});

const failRole: Role<TestMeta> = async () => {
  throw new Error("boom");
};

const failNonErrorRole: Role<TestMeta> = async () => {
  throw "string error";
};

describe("withDryRun", () => {
  test("short-circuits on dry-run", async () => {
    const dec = withDryRun<TestMeta>({ label: "test", meta: { ok: true }, dryRun: true });
    const role = dec(successRole);
    const result = await role(fakeCtx());
    expect(result.content).toBe("[dry-run] test skipped");
    expect(result.meta).toEqual({ ok: true });
  });

  test("delegates when not dry-run", async () => {
    const innerDec = withDryRun<TestMeta>({ label: "test", meta: { ok: true }, dryRun: false });
    const role = innerDec(successRole);
    const result = await role(fakeCtx());
    expect(result.content).toBe("done");
    expect(result.meta).toEqual({ ok: true });
  });
});

describe("onFail", () => {
  test("passes through on success", async () => {
    const dec = onFail<TestMeta>({ label: "test", meta: { ok: false } });
    const role = dec(successRole);
    const result = await role(fakeCtx());
    expect(result.content).toBe("done");
    expect(result.meta).toEqual({ ok: true });
  });

  test("catches Error and returns structured failure", async () => {
    const dec = onFail<TestMeta>({ label: "test", meta: { ok: false } });
    const role = dec(failRole);
    const result = await role(fakeCtx());
    expect(result.content).toBe("test failed: boom");
    expect(result.meta).toEqual({ ok: false });
  });

  test("catches non-Error throws", async () => {
    const dec = onFail<TestMeta>({ label: "test", meta: { ok: false } });
    const role = dec(failNonErrorRole);
    const result = await role(fakeCtx());
    expect(result.content).toBe("test failed: string error");
    expect(result.meta).toEqual({ ok: false });
  });
});

describe("decorateRole", () => {
  test("applies decorators left-to-right", async () => {
    const role = decorateRole(failRole, [
      withDryRun<TestMeta>({ label: "x", meta: { ok: true }, dryRun: false }),
      onFail<TestMeta>({ label: "x", meta: { ok: false } }),
    ]);
    const result = await role(fakeCtx());
    expect(result.content).toBe("x failed: boom");
    expect(result.meta).toEqual({ ok: false });
  });

  test("dry-run short-circuits before onFail", async () => {
    const role = decorateRole(failRole, [
      withDryRun<TestMeta>({ label: "x", meta: { ok: true }, dryRun: true }),
      onFail<TestMeta>({ label: "x", meta: { ok: false } }),
    ]);
    const result = await role(fakeCtx());
    expect(result.content).toBe("[dry-run] x skipped");
    expect(result.meta).toEqual({ ok: true });
  });
});
