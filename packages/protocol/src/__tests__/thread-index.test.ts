import { describe, expect, test } from "vitest";
import {
  createThreadIndexEntry,
  markThreadCompleted,
  markThreadSuspended,
  normalizeThreadIndexEntry,
  parseThreadsIndex,
  serializeThreadIndexEntry,
  serializeThreadsIndex,
  updateThreadHead,
} from "../thread-index.js";

describe("thread-index", () => {
  test("parse legacy string head hash", () => {
    const entry = normalizeThreadIndexEntry("0123456789ABC");
    expect(entry).toEqual({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "idle",
      completedAt: null,
    });
  });

  test("parse suspended object entry", () => {
    const entry = normalizeThreadIndexEntry({
      head: "0123456789ABC",
      suspendedRole: "worker",
      suspendMessage: "Please clarify: Which API?",
    });
    expect(entry).toEqual({
      head: "0123456789ABC",
      suspendedRole: "worker",
      suspendMessage: "Please clarify: Which API?",
      status: "idle",
      completedAt: null,
    });
  });

  test("normalizeThreadIndexEntry preserves status and completedAt from new data", () => {
    const entry = normalizeThreadIndexEntry({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "end",
      completedAt: 1234567890,
    });
    expect(entry).toEqual({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "end",
      completedAt: 1234567890,
    });
  });

  test("normalizeThreadIndexEntry migrates legacy 'completed' status to 'end'", () => {
    const entry = normalizeThreadIndexEntry({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "completed",
      completedAt: 1234567890,
    });
    expect(entry).toEqual({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "end",
      completedAt: 1234567890,
    });
  });

  test("normalizeThreadIndexEntry defaults status=idle, completedAt=null for old data", () => {
    const entry = normalizeThreadIndexEntry({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
    });
    expect(entry).toEqual({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "idle",
      completedAt: null,
    });
  });

  test("serialize non-suspended entry as compact string", () => {
    const entry = createThreadIndexEntry("0123456789ABC");
    expect(serializeThreadIndexEntry(entry)).toBe("0123456789ABC");
  });

  test("serialize suspended entry as object", () => {
    const entry = markThreadSuspended(
      createThreadIndexEntry("0123456789ABC"),
      "worker",
      "Please clarify: Which API?",
    );
    expect(serializeThreadIndexEntry(entry)).toEqual({
      head: "0123456789ABC",
      suspendedRole: "worker",
      suspendMessage: "Please clarify: Which API?",
      status: "suspended",
    });
  });

  test("serialize completed entry as object", () => {
    const entry = markThreadCompleted(createThreadIndexEntry("0123456789ABC"), "end", 1234567890);
    expect(serializeThreadIndexEntry(entry)).toEqual({
      head: "0123456789ABC",
      status: "end",
      completedAt: 1234567890,
    });
  });

  test("updateThreadHead clears suspend metadata and resets status to idle", () => {
    const suspended = markThreadSuspended(
      createThreadIndexEntry("OLDHEAD0123456"),
      "worker",
      "Waiting",
    );
    const resumed = updateThreadHead(suspended, "NEWHEAD01234567");
    expect(resumed).toEqual({
      head: "NEWHEAD01234567",
      suspendedRole: null,
      suspendMessage: null,
      status: "idle",
      completedAt: null,
    });
  });

  test("markThreadSuspended sets status to suspended", () => {
    const entry = createThreadIndexEntry("0123456789ABC");
    const suspended = markThreadSuspended(entry, "worker", "Waiting for input");
    expect(suspended).toEqual({
      head: "0123456789ABC",
      suspendedRole: "worker",
      suspendMessage: "Waiting for input",
      status: "suspended",
      completedAt: null,
    });
  });

  test("markThreadCompleted sets status and completedAt", () => {
    const entry = createThreadIndexEntry("0123456789ABC");
    const completed = markThreadCompleted(entry, "end", 1234567890);
    expect(completed).toEqual({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "end",
      completedAt: 1234567890,
    });
  });

  test("markThreadCompleted with cancelled status", () => {
    const entry = createThreadIndexEntry("0123456789ABC");
    const cancelled = markThreadCompleted(entry, "cancelled", 9876543210);
    expect(cancelled).toEqual({
      head: "0123456789ABC",
      suspendedRole: null,
      suspendMessage: null,
      status: "cancelled",
      completedAt: 9876543210,
    });
  });

  test("parseThreadsIndex round-trip", () => {
    const raw = {
      "01THREAD0000000000000001": "HEAD00000000001",
      "01THREAD0000000000000002": {
        head: "HEAD00000000002",
        suspendedRole: "reviewer",
        suspendMessage: "Need input",
        status: "suspended",
      },
    };
    const parsed = parseThreadsIndex(raw);
    expect(serializeThreadsIndex(parsed)).toEqual(raw);
  });
});
