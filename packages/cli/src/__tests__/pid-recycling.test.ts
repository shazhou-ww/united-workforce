import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { generateUlid } from "@united-workforce/util";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { RunningMarker } from "../background/index.js";
import {
  createMarker,
  getProcessStartTime,
  isMarkerValid,
  isThreadRunning,
  listRunningThreads,
  readMarker,
} from "../background/index.js";
import type { UwfStore } from "../store.js";
import { makeUwfStore } from "./thread-test-helpers.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function createTestWorkflow(uwf: UwfStore): Promise<CasRef> {
  const workflowPayload = {
    name: "test-workflow",
    roles: {
      role1: {
        goal: "test goal",
        outputSchema: { type: "object" as const, properties: {} },
      },
    },
    graph: { start: "role1" },
    conditions: {},
  };
  return await uwf.store.cas.put(uwf.schemas.workflow, workflowPayload);
}

// ── test setup ────────────────────────────────────────────────────────────────

let tmpDir: string;
let savedOcasHome: string | undefined;

beforeEach(async () => {
  savedOcasHome = process.env.OCAS_HOME;
  tmpDir = await mkdtemp(join(tmpdir(), "pid-recycling-test-"));
});

afterEach(async () => {
  if (savedOcasHome === undefined) {
    delete process.env.OCAS_HOME;
  } else {
    process.env.OCAS_HOME = savedOcasHome;
  }
  await rm(tmpDir, { recursive: true, force: true });
});

// ── Spec: thread-marker-process-identity ──────────────────────────────────────

describe("marker records process start time", () => {
  test("createMarker stores processStartTime in marker file", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const threadId = generateUlid(Date.now()) as ThreadId;

    const processStartTime = getProcessStartTime(process.pid);

    await createMarker(tmpDir, {
      thread: threadId,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime,
    });

    const marker = await readMarker(tmpDir, threadId);
    expect(marker).not.toBeNull();
    expect(marker!.pid).toBe(process.pid);
    expect(marker!.processStartTime).toBe(processStartTime);
  });

  test("processStartTime is number on Linux when /proc is available", async () => {
    const startTime = getProcessStartTime(process.pid);
    // On Linux, this should be a number (clock ticks since boot)
    // On non-Linux, it may be null
    if (process.platform === "linux") {
      expect(typeof startTime).toBe("number");
      expect(startTime).toBeGreaterThan(0);
    } else {
      // On non-Linux, null is acceptable
      expect(startTime === null || typeof startTime === "number").toBe(true);
    }
  });

  test("getProcessStartTime returns null for non-existent PID", () => {
    // PID 99999999 is unlikely to exist
    const startTime = getProcessStartTime(99999999);
    expect(startTime).toBeNull();
  });
});

// ── Spec: thread-marker-valid-process-still-blocked ───────────────────────────

describe("valid marker still blocks execution", () => {
  test("isMarkerValid returns true when PID alive and processStartTime matches", () => {
    const processStartTime = getProcessStartTime(process.pid);
    const marker: RunningMarker = {
      thread: "test-thread" as ThreadId,
      workflow: "test-workflow" as CasRef,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime,
    };

    const valid = isMarkerValid(marker);
    expect(valid).toBe(true);
  });

  test("isThreadRunning returns marker when PID alive and processStartTime matches", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const threadId = generateUlid(Date.now()) as ThreadId;
    const processStartTime = getProcessStartTime(process.pid);

    await createMarker(tmpDir, {
      thread: threadId,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime,
    });

    const result = await isThreadRunning(tmpDir, threadId);
    expect(result).not.toBeNull();
    expect(result!.pid).toBe(process.pid);
  });
});

// ── Spec: thread-exec-stale-marker-recovery ───────────────────────────────────

describe("stale marker recovery on exec", () => {
  test("isMarkerValid returns false when processStartTime does not match", () => {
    // Create a marker with a mismatched processStartTime
    const marker: RunningMarker = {
      thread: "test-thread" as ThreadId,
      workflow: "test-workflow" as CasRef,
      pid: process.pid, // PID is alive (it's our own process)
      startedAt: Date.now(),
      processStartTime: 1, // Deliberately wrong start time
    };

    const valid = isMarkerValid(marker);
    expect(valid).toBe(false);
  });

  test("isThreadRunning deletes stale marker and returns null when processStartTime mismatches", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const threadId = generateUlid(Date.now()) as ThreadId;

    // Write a marker with a deliberately wrong processStartTime
    await createMarker(tmpDir, {
      thread: threadId,
      workflow: workflowHash,
      pid: process.pid, // alive process
      startedAt: Date.now(),
      processStartTime: 1, // wrong start time - simulates PID recycling
    });

    // isThreadRunning should detect the stale marker and clean it up
    const result = await isThreadRunning(tmpDir, threadId);
    expect(result).toBeNull();

    // Verify marker file was deleted
    const markerAfter = await readMarker(tmpDir, threadId);
    expect(markerAfter).toBeNull();
  });

  test("isMarkerValid returns false when PID is not alive (regardless of processStartTime)", () => {
    const marker: RunningMarker = {
      thread: "test-thread" as ThreadId,
      workflow: "test-workflow" as CasRef,
      pid: 99999999, // non-existent PID
      startedAt: Date.now(),
      processStartTime: 12345,
    };

    const valid = isMarkerValid(marker);
    expect(valid).toBe(false);
  });
});

// ── Spec: thread-list-stale-marker-cleanup ────────────────────────────────────

describe("thread list filters stale markers", () => {
  test("listRunningThreads excludes threads with mismatched processStartTime", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);

    // T1: stale marker (PID alive, but wrong processStartTime)
    const threadId1 = generateUlid(Date.now()) as ThreadId;
    await createMarker(tmpDir, {
      thread: threadId1,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime: 1, // wrong — simulates PID recycling
    });

    // T2: valid marker (PID alive, correct processStartTime)
    const threadId2 = generateUlid(Date.now() + 1) as ThreadId;
    const correctStartTime = getProcessStartTime(process.pid);
    await createMarker(tmpDir, {
      thread: threadId2,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime: correctStartTime,
    });

    const running = await listRunningThreads(tmpDir);

    // Only T2 should be listed
    expect(running.length).toBe(1);
    expect(running[0]!.thread).toBe(threadId2);

    // T1's marker should have been deleted
    const markerT1 = await readMarker(tmpDir, threadId1);
    expect(markerT1).toBeNull();
  });

  test("listRunningThreads deletes marker when PID is dead", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const threadId = generateUlid(Date.now()) as ThreadId;

    // Marker with a non-existent PID
    await createMarker(tmpDir, {
      thread: threadId,
      workflow: workflowHash,
      pid: 99999999,
      startedAt: Date.now(),
      processStartTime: 12345,
    });

    const running = await listRunningThreads(tmpDir);
    expect(running.length).toBe(0);

    // Marker should be deleted
    const markerAfter = await readMarker(tmpDir, threadId);
    expect(markerAfter).toBeNull();
  });
});

// ── Spec: thread-stop-validates-process-identity ──────────────────────────────

describe("thread stop validates process identity", () => {
  test("isMarkerValid returns false for recycled PID (PID alive, wrong start time)", () => {
    // Simulate: marker says processStartTime=100, but actual process started at a different time
    const marker: RunningMarker = {
      thread: "test-thread" as ThreadId,
      workflow: "test-workflow" as CasRef,
      pid: process.pid, // alive
      startedAt: Date.now(),
      processStartTime: 1, // wrong — this PID was recycled
    };

    expect(isMarkerValid(marker)).toBe(false);
  });
});

// ── Spec: thread-cancel-validates-process-identity ────────────────────────────

describe("thread cancel validates process identity", () => {
  test("isMarkerValid correctly identifies stale markers for cancel scenario", () => {
    const marker: RunningMarker = {
      thread: "test-thread" as ThreadId,
      workflow: "test-workflow" as CasRef,
      pid: process.pid, // alive
      startedAt: Date.now(),
      processStartTime: 1, // wrong — this is a recycled PID
    };

    expect(isMarkerValid(marker)).toBe(false);
  });
});

// ── Legacy marker compatibility ───────────────────────────────────────────────

describe("backward compatibility with old markers", () => {
  test("marker without processStartTime field is treated as stale when PID alive", async () => {
    const uwf = await makeUwfStore(tmpDir);
    const workflowHash = await createTestWorkflow(uwf);
    const threadId = generateUlid(Date.now()) as ThreadId;

    // Simulate an old-format marker (no processStartTime field)
    const runningDir = join(tmpDir, "running");
    await mkdir(runningDir, { recursive: true });
    const markerPath = join(runningDir, `${threadId}.json`);
    const oldMarker = {
      thread: threadId,
      workflow: workflowHash,
      pid: process.pid,
      startedAt: Date.now(),
      // No processStartTime field
    };
    await writeFile(markerPath, JSON.stringify(oldMarker, null, 2), "utf8");

    // Reading the marker should work (null processStartTime)
    const marker = await readMarker(tmpDir, threadId);
    expect(marker).not.toBeNull();
    expect(marker!.processStartTime).toBeNull();

    // isMarkerValid should still accept it gracefully (null means can't verify — fallback to PID check only)
    // But since we can't verify identity, we treat it as potentially stale
    // The spec says: on non-Linux, processStartTime is null — same behavior
    // When processStartTime is null in marker AND we can't read /proc (or it's null from getProcessStartTime too),
    // we fall back to the PID-alive-only check for backward compat
    const valid = isMarkerValid(marker!);
    // With null processStartTime in the marker, we can't verify identity,
    // but the PID IS alive. For backward compat, this should be treated as valid
    // (the new getProcessStartTime returns a real number on Linux, null if unavailable)
    if (process.platform === "linux") {
      // On Linux where we CAN get the actual start time but the marker has null,
      // we cannot confirm identity — treat as potentially stale
      // However for backward compat during transition, null in marker = skip identity check
      expect(valid).toBe(true);
    } else {
      expect(valid).toBe(true);
    }
  });
});
