import { describe, expect, test } from "vitest";

import { createSseParser } from "../src/sse.js";

describe("createSseParser", () => {
  test("parses a single id/event/data frame", () => {
    const parser = createSseParser();
    const events = parser.push("id: 1\nevent: turn\ndata: hello\n\n");
    expect(events).toEqual([{ id: "1", event: "turn", data: "hello" }]);
  });

  test("parses multiple frames in one chunk", () => {
    const parser = createSseParser();
    const chunk = "id: 1\nevent: turn\ndata: a\n\n" + "id: 2\nevent: heartbeat\ndata: hb\n\n";
    expect(parser.push(chunk)).toEqual([
      { id: "1", event: "turn", data: "a" },
      { id: "2", event: "heartbeat", data: "hb" },
    ]);
  });

  test("buffers incomplete frame across chunks", () => {
    const parser = createSseParser();
    expect(parser.push("id: 1\nevent: turn\nda")).toEqual([]);
    expect(parser.push("ta: foo\n\n")).toEqual([{ id: "1", event: "turn", data: "foo" }]);
  });

  test("defaults event name to 'message' when absent", () => {
    const parser = createSseParser();
    expect(parser.push("id: 1\ndata: x\n\n")).toEqual([{ id: "1", event: "message", data: "x" }]);
  });

  test("ignores comment lines starting with ':'", () => {
    const parser = createSseParser();
    expect(parser.push(": comment\nid: 1\nevent: t\ndata: x\n\n")).toEqual([
      { id: "1", event: "t", data: "x" },
    ]);
  });

  test("joins multi-line data with newlines", () => {
    const parser = createSseParser();
    expect(parser.push("event: t\ndata: line1\ndata: line2\n\n")).toEqual([
      { id: null, event: "t", data: "line1\nline2" },
    ]);
  });

  test("handles CRLF line endings", () => {
    const parser = createSseParser();
    expect(parser.push("id: 1\r\nevent: t\r\ndata: x\r\n\r\n")).toEqual([
      { id: "1", event: "t", data: "x" },
    ]);
  });

  test("drain returns trailing partial frame", () => {
    const parser = createSseParser();
    expect(parser.push("event: t\ndata: x\n")).toEqual([]);
    expect(parser.drain()).toEqual([{ id: null, event: "t", data: "x" }]);
  });
});
