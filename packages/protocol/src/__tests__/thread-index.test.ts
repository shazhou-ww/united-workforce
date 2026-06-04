import { describe, expect, test } from "vitest";
import {
  createThreadIndexEntry,
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
    });
  });

  test("updateThreadHead clears suspend metadata", () => {
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
    });
  });

  test("parseThreadsIndex round-trip", () => {
    const raw = {
      "01THREAD0000000000000001": "HEAD00000000001",
      "01THREAD0000000000000002": {
        head: "HEAD00000000002",
        suspendedRole: "reviewer",
        suspendMessage: "Need input",
      },
    };
    const parsed = parseThreadsIndex(raw);
    expect(serializeThreadsIndex(parsed)).toEqual(raw);
  });
});
