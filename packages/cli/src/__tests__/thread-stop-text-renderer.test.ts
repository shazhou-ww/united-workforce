import { describe, expect, test } from "vitest";
import { formatOutput, getTextRenderer, TEXT_RENDERERS } from "../format.js";
import { renderThreadStop } from "../text-renderers.js";

describe("thread stop — text renderer registration", () => {
  test("TEXT_RENDERERS contains 'thread stop'", () => {
    expect(getTextRenderer("thread stop")).toBeDefined();
    expect(typeof getTextRenderer("thread stop")).toBe("function");
  });

  test("TEXT_RENDERERS['thread stop'] is the same reference as renderThreadStop", () => {
    expect(TEXT_RENDERERS["thread stop"]).toBe(renderThreadStop);
  });

  test("renderThreadStop is exported from text-renderers.ts", () => {
    expect(typeof renderThreadStop).toBe("function");
  });
});

describe("renderThreadStop — output shape (stopped=true)", () => {
  test("returns a string for full payload", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: true,
    });
    expect(typeof out).toBe("string");
  });

  test("includes the stopped thread's ULID", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: true,
    });
    expect(out).toContain("01JTEST00000000000000STOP1");
  });

  test("indicates stopped status (yes)", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: true,
    });
    const lower = out.toLowerCase();
    const hasStopMarker = lower.includes("stopped") && lower.includes("yes");
    expect(hasStopMarker).toBe(true);
  });

  test("does NOT begin with '{' or '[' (not raw JSON)", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: true,
    });
    const trimmed = out.trimStart();
    expect(trimmed.startsWith("{")).toBe(false);
    expect(trimmed.startsWith("[")).toBe(false);
  });

  test("does NOT contain literal 'undefined'", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: true,
    });
    expect(out).not.toContain("undefined");
  });
});

describe("renderThreadStop — stopped=false variant", () => {
  test("returns a string for stopped=false payload", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: false,
    });
    expect(typeof out).toBe("string");
  });

  test("includes the thread's ULID even when stopped=false", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: false,
    });
    expect(out).toContain("01JTEST00000000000000STOP1");
  });

  test("indicates not-stopped status (no)", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: false,
    });
    const lower = out.toLowerCase();
    const hasNoMarker = lower.includes("stopped") && lower.includes("no");
    expect(hasNoMarker).toBe(true);
  });

  test("does NOT contain literal 'undefined' for stopped=false", () => {
    const out = renderThreadStop({
      thread: "01JTEST00000000000000STOP1",
      stopped: false,
    });
    expect(out).not.toContain("undefined");
  });
});

describe("renderThreadStop — partial / missing data", () => {
  test("missing 'stopped' field — returns string, no throw, no 'undefined'", () => {
    const out = renderThreadStop({ thread: "01JTEST00000000000000STOP1" });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("missing 'thread' field — returns string, no throw, no 'undefined'", () => {
    const out = renderThreadStop({ stopped: true });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("empty object — returns string, no throw, no 'undefined'", () => {
    const out = renderThreadStop({});
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("null payload — returns string, no throw", () => {
    expect(() => renderThreadStop(null)).not.toThrow();
    const out = renderThreadStop(null);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("non-object payload (string) — returns string, no throw", () => {
    expect(() => renderThreadStop("oops")).not.toThrow();
    const out = renderThreadStop("oops");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });
});

describe("formatOutput integration — thread stop", () => {
  test("formatOutput(data, 'text', 'thread stop') uses renderer", () => {
    const data = { thread: "01JTEST00000000000000STOP1", stopped: true };
    const out = formatOutput(data, "text", "thread stop");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    expect(out.trimStart().startsWith("{")).toBe(false);
    expect(out).toContain("01JTEST00000000000000STOP1");
  });

  test("formatOutput(data, 'json', 'thread stop') still emits parseable JSON", () => {
    const data = { thread: "01JTEST00000000000000STOP1", stopped: true };
    const out = formatOutput(data, "json", "thread stop");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(data);
  });

  test("formatOutput(data, 'yaml', 'thread stop') still emits YAML", () => {
    const data = { thread: "01JTEST00000000000000STOP1", stopped: true };
    const out = formatOutput(data, "yaml", "thread stop");
    expect(typeof out).toBe("string");
    expect(out).toContain("thread:");
    expect(out).toContain("stopped:");
  });

  test("formatOutput for stopped=false variant under text format", () => {
    const data = { thread: "01JTEST00000000000000STOP1", stopped: false };
    const out = formatOutput(data, "text", "thread stop");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    expect(out).toContain("01JTEST00000000000000STOP1");
  });
});
