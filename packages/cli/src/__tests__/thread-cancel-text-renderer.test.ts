import { describe, expect, test } from "vitest";
import { formatOutput, getTextRenderer, TEXT_RENDERERS } from "../format.js";
import { renderThreadCancel } from "../text-renderers.js";

describe("thread cancel — text renderer registration", () => {
  test("TEXT_RENDERERS contains 'thread cancel'", () => {
    expect(getTextRenderer("thread cancel")).toBeDefined();
    expect(typeof getTextRenderer("thread cancel")).toBe("function");
  });

  test("TEXT_RENDERERS['thread cancel'] is the same reference as renderThreadCancel", () => {
    expect(TEXT_RENDERERS["thread cancel"]).toBe(renderThreadCancel);
  });

  test("renderThreadCancel is exported from text-renderers.ts", () => {
    expect(typeof renderThreadCancel).toBe("function");
  });
});

describe("renderThreadCancel — output shape", () => {
  test("returns a string for full payload", () => {
    const out = renderThreadCancel({
      thread: "01JTEST000000000000CANCEL1",
      cancelled: true,
    });
    expect(typeof out).toBe("string");
  });

  test("includes the cancelled thread's ULID", () => {
    const out = renderThreadCancel({
      thread: "01JTEST000000000000CANCEL1",
      cancelled: true,
    });
    expect(out).toContain("01JTEST000000000000CANCEL1");
  });

  test("indicates cancelled status (Status: cancelled OR Cancelled: yes)", () => {
    const out = renderThreadCancel({
      thread: "01JTEST000000000000CANCEL1",
      cancelled: true,
    });
    // accept either rendering style
    const lower = out.toLowerCase();
    const hasCancelMarker = lower.includes("cancelled") || lower.includes("yes");
    expect(hasCancelMarker).toBe(true);
  });

  test("does NOT begin with '{' or '[' (not raw JSON)", () => {
    const out = renderThreadCancel({
      thread: "01JTEST000000000000CANCEL1",
      cancelled: true,
    });
    const trimmed = out.trimStart();
    expect(trimmed.startsWith("{")).toBe(false);
    expect(trimmed.startsWith("[")).toBe(false);
  });

  test("does NOT contain literal 'undefined'", () => {
    const out = renderThreadCancel({
      thread: "01JTEST000000000000CANCEL1",
      cancelled: true,
    });
    expect(out).not.toContain("undefined");
  });
});

describe("renderThreadCancel — partial / missing data", () => {
  test("missing 'cancelled' field — returns string, no throw, no 'undefined'", () => {
    const out = renderThreadCancel({ thread: "01JTEST000000000000CANCEL1" });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("missing 'thread' field — returns string, no throw, no 'undefined'", () => {
    const out = renderThreadCancel({ cancelled: true });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("empty object — returns string, no throw, no 'undefined'", () => {
    const out = renderThreadCancel({});
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("null payload — returns string, no throw", () => {
    expect(() => renderThreadCancel(null)).not.toThrow();
    const out = renderThreadCancel(null);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("non-object payload (string) — returns string, no throw", () => {
    expect(() => renderThreadCancel("oops")).not.toThrow();
    const out = renderThreadCancel("oops");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });
});

describe("formatOutput integration — thread cancel", () => {
  test("formatOutput(data, 'text', 'thread cancel') uses renderer", () => {
    const data = { thread: "01JTEST000000000000CANCEL1", cancelled: true };
    const out = formatOutput(data, "text", "thread cancel");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    expect(out.trimStart().startsWith("{")).toBe(false);
    expect(out).toContain("01JTEST000000000000CANCEL1");
  });

  test("formatOutput(data, 'json', 'thread cancel') still emits parseable JSON", () => {
    const data = { thread: "01JTEST000000000000CANCEL1", cancelled: true };
    const out = formatOutput(data, "json", "thread cancel");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(data);
  });

  test("formatOutput(data, 'yaml', 'thread cancel') still emits YAML", () => {
    const data = { thread: "01JTEST000000000000CANCEL1", cancelled: true };
    const out = formatOutput(data, "yaml", "thread cancel");
    expect(typeof out).toBe("string");
    expect(out).toContain("thread:");
    expect(out).toContain("cancelled:");
  });
});
