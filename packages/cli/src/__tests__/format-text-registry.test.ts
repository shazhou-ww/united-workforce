import { describe, expect, test } from "vitest";
import { formatOutput, getTextRenderer, registerTextRenderer, TEXT_RENDERERS } from "../format.js";

describe("OutputFormat — text type contract", () => {
  test("formatOutput(data, 'text') returns a string (not undefined)", () => {
    const out = formatOutput({ items: [] }, "text");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("formatOutput(data, 'text') with no commandPath returns JSON fallback", () => {
    const data = { foo: "bar" };
    const out = formatOutput(data, "text");
    expect(typeof out).toBe("string");
    // Must be parseable JSON (the fallback)
    expect(() => JSON.parse(out)).not.toThrow();
  });

  test("formatOutput supports 'text' alongside 'json' and 'yaml'", () => {
    const data = { foo: "bar" };
    expect(typeof formatOutput(data, "json")).toBe("string");
    expect(typeof formatOutput(data, "yaml")).toBe("string");
    expect(typeof formatOutput(data, "text")).toBe("string");
  });
});

describe("TEXT_RENDERERS registry", () => {
  test("is a Record<string, (data: unknown) => string>", () => {
    expect(TEXT_RENDERERS).toBeDefined();
    expect(typeof TEXT_RENDERERS).toBe("object");
    for (const [key, fn] of Object.entries(TEXT_RENDERERS)) {
      expect(typeof key).toBe("string");
      expect(typeof fn).toBe("function");
    }
  });

  test("contains renderers for all in-scope commands", () => {
    const expectedCommands = [
      "thread list",
      "thread show",
      "thread start",
      "workflow list",
      "workflow show",
      "step list",
      "step show",
    ];
    for (const cmd of expectedCommands) {
      expect(getTextRenderer(cmd)).toBeDefined();
      expect(typeof getTextRenderer(cmd)).toBe("function");
    }
  });

  test("registered renderers always return strings (never undefined)", () => {
    // thread list with empty items
    const threadListOut = TEXT_RENDERERS["thread list"]?.({ items: [] });
    expect(typeof threadListOut).toBe("string");
    expect(threadListOut).not.toContain("undefined");

    // workflow list with empty items
    const workflowListOut = TEXT_RENDERERS["workflow list"]?.({ items: [] });
    expect(typeof workflowListOut).toBe("string");
    expect(workflowListOut).not.toContain("undefined");

    // step list
    const stepListOut = TEXT_RENDERERS["step list"]?.({ threadId: "t", items: [] });
    expect(typeof stepListOut).toBe("string");
    expect(stepListOut).not.toContain("undefined");
  });
});

describe("formatOutput with text format and commandPath", () => {
  test("uses registered renderer when commandPath is provided", () => {
    const data = {
      threadId: "01HXYZ",
      workflowHash: "ABC123",
    };
    const out = formatOutput(data, "text", "thread start");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    // thread-start renderer should mention the threadId
    expect(out).toContain("01HXYZ");
  });

  test("falls back to JSON when commandPath has no registered renderer", () => {
    const data = { foo: "bar" };
    const out = formatOutput(data, "text", "unknown command");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    // Should be JSON
    expect(() => JSON.parse(out)).not.toThrow();
  });

  test("renderer is NOT invoked when format is 'json'", () => {
    const data = {
      threadId: "01HXYZ",
      workflowHash: "ABC123",
    };
    const out = formatOutput(data, "json", "thread start");
    expect(typeof out).toBe("string");
    // JSON output is parseable
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(data);
  });

  test("renderer is NOT invoked when format is 'yaml'", () => {
    const data = {
      threadId: "01HXYZ",
      workflowHash: "ABC123",
    };
    const out = formatOutput(data, "yaml", "thread start");
    expect(typeof out).toBe("string");
    expect(out).toContain("threadId:");
    expect(out).toContain("workflowHash:");
  });
});

describe("Renderers handle partial/missing data without throwing", () => {
  test("thread list handles items with null currentRole", () => {
    const data = {
      items: [
        {
          threadId: "01HXYZ",
          workflowHash: "ABC123",
          workflowName: null,
          status: "idle",
          currentRole: null,
          startedAt: null,
          completedAt: null,
        },
      ],
    };
    const out = TEXT_RENDERERS["thread list"]?.(data);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain("null");
  });

  test("thread show handles missing optional fields", () => {
    const data = {
      threadId: "01HXYZ",
      workflowHash: "ABC123",
      head: null,
      status: "idle",
      currentRole: null,
      suspendedRole: null,
      suspendMessage: null,
      done: false,
    };
    const out = TEXT_RENDERERS["thread show"]?.(data);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("step list handles items with null durationMs", () => {
    const data = {
      threadId: "01HXYZ",
      items: [{ hash: "STEP1", role: "planner", durationMs: null }],
    };
    const out = TEXT_RENDERERS["step list"]?.(data);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });
});

describe("registerTextRenderer", () => {
  test("allows registering a custom renderer", () => {
    registerTextRenderer("test command", (data) => `custom: ${JSON.stringify(data)}`);
    const out = formatOutput({ foo: "bar" }, "text", "test command");
    expect(out).toContain("custom:");
    expect(out).toContain("foo");
    expect(out).toContain("bar");
  });
});
