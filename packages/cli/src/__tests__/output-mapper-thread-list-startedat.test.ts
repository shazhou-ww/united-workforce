import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { generateUlid } from "@united-workforce/util";
import { describe, expect, test } from "vitest";
import type { ThreadListItemWithStatus } from "../commands/thread.js";
import { toThreadListPayload } from "../output-mappers.js";

const OUTPUT_MAPPERS_PATH = fileURLToPath(new URL("../output-mappers.ts", import.meta.url));

function makeItem(threadId: string): ThreadListItemWithStatus {
  return {
    thread: threadId as ThreadId,
    workflow: "WORKFLOWHASH1" as CasRef,
    head: "HEADHASH00001" as CasRef,
    status: "idle",
    currentRole: null,
    statusDisplay: "idle",
    workflowName: "test-workflow",
  };
}

describe("toThreadListPayload — issue #343 (ULID timestamp decoded with padding stripped)", () => {
  test("startedAt equals the millisecond timestamp originally passed to generateUlid", () => {
    const ts = 1781219097830; // 2026-06-11T23:04:57.830Z
    const ulid = generateUlid(ts);

    const payload = toThreadListPayload([makeItem(ulid)]);

    expect(payload.items).toHaveLength(1);
    expect(payload.items[0]!.startedAt).toBe(ts);
  });

  test("startedAt is NOT the raw 50-bit value (i.e. NOT timestamp << 2)", () => {
    const ts = 1781219097830;
    const ulid = generateUlid(ts);

    const payload = toThreadListPayload([makeItem(ulid)]);

    // The buggy decoder produced ts * 4 = 7124876391323, pushing year to 2195.
    expect(payload.items[0]!.startedAt).not.toBe(ts * 4);
    expect(payload.items[0]!.startedAt).not.toBe(7124876391323);
  });

  test("startedAt decodes to year 2026 for the issue-reported ULID timestamp", () => {
    const ts = 1781219097830;
    const ulid = generateUlid(ts);

    const payload = toThreadListPayload([makeItem(ulid)]);

    const startedAt = payload.items[0]!.startedAt;
    expect(startedAt).not.toBeNull();
    if (startedAt === null) return;
    const isoDate = new Date(startedAt).toISOString().slice(0, 10);
    expect(isoDate).toBe("2026-06-11");
  });

  test("round-trips correctly across several timestamps", () => {
    const timestamps = [
      0,
      Date.UTC(2020, 0, 1, 0, 0, 0),
      Date.UTC(2023, 5, 15, 12, 30, 45),
      Date.UTC(2026, 4, 20, 0, 0, 0),
      Date.UTC(2030, 11, 31, 23, 59, 59),
    ];
    const items = timestamps.map((t) => makeItem(generateUlid(t)));

    const payload = toThreadListPayload(items);

    for (let i = 0; i < timestamps.length; i++) {
      expect(payload.items[i]!.startedAt).toBe(timestamps[i]);
    }
  });

  test("startedAt is null for thread ids that are not valid 26-char Crockford Base32 ULIDs", () => {
    const cases = ["", "TOOSHORT", "TOOLONGAAAAAAAAAAAAAAAAAA", "INVALID!@#$%^&CHARACTERS"];
    const items = cases.map((id) => makeItem(id));

    const payload = toThreadListPayload(items);

    for (const item of payload.items) {
      expect(item.startedAt).toBeNull();
    }
  });

  test("preserves other thread-list item fields verbatim", () => {
    const ts = 1781219097830;
    const ulid = generateUlid(ts);
    const item: ThreadListItemWithStatus = {
      thread: ulid as ThreadId,
      workflow: "WORKFLOWHASH9" as CasRef,
      head: "HEADHASH99999" as CasRef,
      status: "running",
      currentRole: "developer",
      statusDisplay: "running",
      workflowName: "solve-issue",
    };

    const payload = toThreadListPayload([item]);

    expect(payload.items[0]).toEqual({
      threadId: ulid,
      workflowHash: "WORKFLOWHASH9",
      workflowName: "solve-issue",
      status: "running",
      currentRole: "developer",
      startedAt: ts,
      completedAt: null,
    });
  });
});

describe("output-mappers.ts source — issue #343 refactor", () => {
  test("does NOT contain a local extractUlidTime function (removed in favor of util)", async () => {
    const source = await readFile(OUTPUT_MAPPERS_PATH, "utf8");
    expect(source).not.toMatch(/function\s+extractUlidTime\b/);
  });

  test("imports extractUlidTimestamp from @united-workforce/util", async () => {
    const source = await readFile(OUTPUT_MAPPERS_PATH, "utf8");
    expect(source).toMatch(/extractUlidTimestamp/);
    expect(source).toMatch(/@united-workforce\/util/);
  });
});
