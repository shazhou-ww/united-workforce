import { describe, expect, test } from "vitest";
import { formatOutput, getTextRenderer, TEXT_RENDERERS } from "../format.js";
import { renderLogList, renderLogShow } from "../text-renderers.js";

describe("log list — text renderer registration", () => {
  test("TEXT_RENDERERS contains 'log list'", () => {
    expect(getTextRenderer("log list")).toBeDefined();
    expect(typeof getTextRenderer("log list")).toBe("function");
  });

  test("TEXT_RENDERERS['log list'] is the same reference as renderLogList", () => {
    expect(TEXT_RENDERERS["log list"]).toBe(renderLogList);
  });

  test("renderLogList is exported from text-renderers.ts", () => {
    expect(typeof renderLogList).toBe("function");
  });
});

describe("log show — text renderer registration", () => {
  test("TEXT_RENDERERS contains 'log show'", () => {
    expect(getTextRenderer("log show")).toBeDefined();
    expect(typeof getTextRenderer("log show")).toBe("function");
  });

  test("TEXT_RENDERERS['log show'] is the same reference as renderLogShow", () => {
    expect(TEXT_RENDERERS["log show"]).toBe(renderLogShow);
  });

  test("renderLogShow is exported from text-renderers.ts", () => {
    expect(typeof renderLogShow).toBe("function");
  });
});

describe("renderLogList — output shape", () => {
  test("returns a string for full payload", () => {
    const out = renderLogList([
      { name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" },
      { name: "2026-06-11.jsonl", size: 8192, date: "2026-06-11" },
    ]);
    expect(typeof out).toBe("string");
  });

  test("includes file names, dates, and sizes for each row", () => {
    const out = renderLogList([
      { name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" },
      { name: "2026-06-11.jsonl", size: 8192, date: "2026-06-11" },
    ]);
    expect(out).toContain("2026-06-10.jsonl");
    expect(out).toContain("2026-06-10");
    expect(out).toContain("2026-06-11.jsonl");
    expect(out).toContain("2026-06-11");
  });

  test("includes a header line", () => {
    const out = renderLogList([{ name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" }]);
    const lines = out.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(2);
    // header should mention NAME or DATE or SIZE
    const header = lines[0]?.toUpperCase() ?? "";
    const hasHeader = header.includes("NAME") || header.includes("DATE") || header.includes("SIZE");
    expect(hasHeader).toBe(true);
  });

  test("does NOT begin with '{' or '[' (not raw JSON)", () => {
    const out = renderLogList([{ name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" }]);
    const trimmed = out.trimStart();
    expect(trimmed.startsWith("{")).toBe(false);
    expect(trimmed.startsWith("[")).toBe(false);
  });

  test("does NOT contain literal 'undefined'", () => {
    const out = renderLogList([{ name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" }]);
    expect(out).not.toContain("undefined");
  });

  test("empty array — returns string, no 'undefined'", () => {
    const out = renderLogList([]);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("null payload — returns string, does not throw", () => {
    expect(() => renderLogList(null)).not.toThrow();
    const out = renderLogList(null);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("non-array payload — returns string, does not throw", () => {
    expect(() => renderLogList({ name: "x" })).not.toThrow();
    const out = renderLogList({ name: "x" });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("partial item (missing size) — returns string, no 'undefined'", () => {
    const out = renderLogList([{ name: "2026-06-10.jsonl", date: "2026-06-10" }]);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });
});

describe("renderLogShow — output shape", () => {
  test("returns a string for full payload", () => {
    const out = renderLogShow([
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "Loading workflow...",
        thread: "01JTEST000000000000THREAD1",
        workflow: "WF1234567890A",
      },
    ]);
    expect(typeof out).toBe("string");
  });

  test("includes ts, pid, tag, and msg for each entry", () => {
    const out = renderLogShow([
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "Loading workflow...",
        thread: null,
        workflow: null,
      },
    ]);
    expect(out).toContain("2026-06-12T10:00:00.000Z");
    expect(out).toContain("12345");
    expect(out).toContain("4KNMR2PX");
    expect(out).toContain("Loading workflow...");
  });

  test("includes thread id when present", () => {
    const out = renderLogShow([
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "Loading workflow...",
        thread: "01JTEST000000000000THREAD1",
        workflow: null,
      },
    ]);
    expect(out).toContain("01JTEST000000000000THREAD1");
  });

  test("does NOT begin with '{' or '[' (not raw JSON)", () => {
    const out = renderLogShow([
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "Loading workflow...",
        thread: null,
        workflow: null,
      },
    ]);
    const trimmed = out.trimStart();
    expect(trimmed.startsWith("{")).toBe(false);
    expect(trimmed.startsWith("[")).toBe(false);
  });

  test("does NOT contain literal 'undefined'", () => {
    const out = renderLogShow([
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "Loading workflow...",
        thread: null,
        workflow: null,
      },
    ]);
    expect(out).not.toContain("undefined");
  });

  test("empty array — returns string, no 'undefined'", () => {
    const out = renderLogShow([]);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("null payload — returns string, does not throw", () => {
    expect(() => renderLogShow(null)).not.toThrow();
    const out = renderLogShow(null);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("non-array payload — returns string, does not throw", () => {
    expect(() => renderLogShow({ ts: "x" })).not.toThrow();
    const out = renderLogShow({ ts: "x" });
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });

  test("partial entry (missing thread) — returns string, no 'undefined'", () => {
    const out = renderLogShow([
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "hello",
      },
    ]);
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
  });
});

describe("formatOutput integration — log list", () => {
  test("formatOutput(data, 'text', 'log list') uses renderer", () => {
    const data = [{ name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" }];
    const out = formatOutput(data, "text", "log list");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    expect(out.trimStart().startsWith("{")).toBe(false);
    expect(out.trimStart().startsWith("[")).toBe(false);
    expect(out).toContain("2026-06-10.jsonl");
  });

  test("formatOutput(data, 'json', 'log list') still emits parseable JSON", () => {
    const data = [{ name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" }];
    const out = formatOutput(data, "json", "log list");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(data);
  });

  test("formatOutput(data, 'yaml', 'log list') still emits YAML", () => {
    const data = [{ name: "2026-06-10.jsonl", size: 4096, date: "2026-06-10" }];
    const out = formatOutput(data, "yaml", "log list");
    expect(typeof out).toBe("string");
    expect(out).toContain("name:");
    expect(out).toContain("2026-06-10.jsonl");
  });
});

describe("formatOutput integration — log show", () => {
  test("formatOutput(data, 'text', 'log show') uses renderer", () => {
    const data = [
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "hello",
        thread: null,
        workflow: null,
      },
    ];
    const out = formatOutput(data, "text", "log show");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("undefined");
    expect(out.trimStart().startsWith("{")).toBe(false);
    expect(out.trimStart().startsWith("[")).toBe(false);
    expect(out).toContain("4KNMR2PX");
    expect(out).toContain("hello");
  });

  test("formatOutput(data, 'json', 'log show') still emits parseable JSON", () => {
    const data = [
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "hello",
        thread: null,
        workflow: null,
      },
    ];
    const out = formatOutput(data, "json", "log show");
    const parsed = JSON.parse(out);
    expect(parsed).toEqual(data);
  });

  test("formatOutput(data, 'yaml', 'log show') still emits YAML", () => {
    const data = [
      {
        ts: "2026-06-12T10:00:00.000Z",
        pid: "12345",
        tag: "4KNMR2PX",
        msg: "hello",
        thread: null,
        workflow: null,
      },
    ];
    const out = formatOutput(data, "yaml", "log show");
    expect(typeof out).toBe("string");
    expect(out).toContain("ts:");
    expect(out).toContain("pid:");
  });
});
