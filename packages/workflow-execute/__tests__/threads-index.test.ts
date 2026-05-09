import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  appendThreadHistoryEntry,
  removeThreadEntry,
  upsertThreadEntry,
} from "../src/engine/threads-index.js";

describe("threads-index", () => {
  let bundleDir: string;

  beforeEach(async () => {
    bundleDir = await mkdtemp(join(tmpdir(), "uncaged-wf-threads-"));
  });

  afterEach(async () => {
    await rm(bundleDir, { recursive: true, force: true });
  });

  test("upsertThreadEntry creates threads.json and persists entries", async () => {
    await upsertThreadEntry(bundleDir, "T1", { head: "H1", start: "S1", updatedAt: 100 });
    const text = await readFile(join(bundleDir, "threads.json"), "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual({
      T1: { head: "H1", start: "S1", updatedAt: 100 },
    });
  });

  test("upsertThreadEntry overwrites the head while preserving siblings", async () => {
    await upsertThreadEntry(bundleDir, "T1", { head: "H1", start: "S1", updatedAt: 100 });
    await upsertThreadEntry(bundleDir, "T2", { head: "H2", start: "S2", updatedAt: 200 });
    await upsertThreadEntry(bundleDir, "T1", { head: "H1B", start: "S1", updatedAt: 300 });
    const text = await readFile(join(bundleDir, "threads.json"), "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual({
      T1: { head: "H1B", start: "S1", updatedAt: 300 },
      T2: { head: "H2", start: "S2", updatedAt: 200 },
    });
  });

  test("removeThreadEntry deletes the entry but keeps the file", async () => {
    await upsertThreadEntry(bundleDir, "T1", { head: "H1", start: "S1", updatedAt: 100 });
    await upsertThreadEntry(bundleDir, "T2", { head: "H2", start: "S2", updatedAt: 200 });
    await removeThreadEntry(bundleDir, "T1");
    const text = await readFile(join(bundleDir, "threads.json"), "utf8");
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed).toEqual({
      T2: { head: "H2", start: "S2", updatedAt: 200 },
    });
  });

  test("removeThreadEntry on a missing thread is a no-op", async () => {
    await removeThreadEntry(bundleDir, "MISSING");
    const dirEntries = await readdir(bundleDir);
    expect(dirEntries.includes("threads.json")).toBe(false);
  });

  test("appendThreadHistoryEntry writes one JSONL line per call into a date-keyed file", async () => {
    const ts = Date.UTC(2026, 4, 9, 12, 0, 0);
    await appendThreadHistoryEntry(bundleDir, {
      threadId: "T1",
      head: "H1",
      start: "S1",
      completedAt: ts,
    });
    await appendThreadHistoryEntry(bundleDir, {
      threadId: "T2",
      head: "H2",
      start: "S2",
      completedAt: ts,
    });
    const text = await readFile(join(bundleDir, "history", "2026-05-09.jsonl"), "utf8");
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0] ?? "{}")).toEqual({
      threadId: "T1",
      head: "H1",
      start: "S1",
      completedAt: ts,
    });
    expect(JSON.parse(lines[1] ?? "{}")).toEqual({
      threadId: "T2",
      head: "H2",
      start: "S2",
      completedAt: ts,
    });
  });
});
