import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasRef, ThreadId } from "@united-workforce/protocol";
import { createThreadIndexEntry } from "@united-workforce/protocol";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMarker,
  deleteMarker,
  getProcessStartTime,
  isThreadRunning,
} from "../background/index.js";
import { cmdThreadJoin } from "../commands/thread.js";
import { makeUwfStore, seedThread } from "./thread-test-helpers.js";

describe("cmdThreadJoin", () => {
  let storageRoot: string;
  let savedOcasHome: string | undefined;

  beforeEach(async () => {
    savedOcasHome = process.env.OCAS_HOME;
    storageRoot = join(
      tmpdir(),
      `uwf-test-join-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    await mkdir(storageRoot, { recursive: true });
  });

  afterEach(async () => {
    if (savedOcasHome !== undefined) {
      process.env.OCAS_HOME = savedOcasHome;
    } else {
      delete process.env.OCAS_HOME;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  it("throws when thread does not exist", async () => {
    await makeUwfStore(storageRoot);
    const threadId = "01JF0000000000NOTEXIST0" as ThreadId;
    await expect(cmdThreadJoin(storageRoot, threadId, null)).rejects.toThrow(
      /thread not found|process\.exit/,
    );
  });

  it("times out when thread keeps running", async () => {
    const threadId = "01JF0000000000TESTJOIN03" as ThreadId;
    await makeUwfStore(storageRoot);
    // Seed a thread so existence check passes
    const uwf = await makeUwfStore(storageRoot);
    const head = (await uwf.store.cas.put(uwf.schemas.text, "join-timeout-test")) as CasRef;
    await seedThread(storageRoot, threadId, createThreadIndexEntry(head));

    // Create a running marker with our PID (it will stay alive)
    await createMarker(storageRoot, {
      thread: threadId,
      workflow: "AAAAAAAAAAAAA" as CasRef,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime: getProcessStartTime(process.pid),
    });

    // Timeout after 100ms — should fail because marker never disappears
    await expect(cmdThreadJoin(storageRoot, threadId, 100)).rejects.toThrow(
      /join timed out|process\.exit/,
    );

    // Cleanup
    await deleteMarker(storageRoot, threadId);
  });

  it("poll loop exits when marker is removed", async () => {
    const threadId = "01JF0000000000TESTJOIN04" as ThreadId;
    const uwf = await makeUwfStore(storageRoot);
    const head = (await uwf.store.cas.put(uwf.schemas.text, "join-poll-test")) as CasRef;
    await seedThread(storageRoot, threadId, createThreadIndexEntry(head));

    // Create a running marker
    await createMarker(storageRoot, {
      thread: threadId,
      workflow: "AAAAAAAAAAAAA" as CasRef,
      pid: process.pid,
      startedAt: Date.now(),
      processStartTime: getProcessStartTime(process.pid),
    });

    // Confirm marker is valid
    expect(await isThreadRunning(storageRoot, threadId)).not.toBeNull();

    // Remove it after a short delay — simulates background worker finishing
    setTimeout(() => {
      deleteMarker(storageRoot, threadId);
    }, 300);

    // cmdThreadJoin will poll and wait. It will exit the poll loop after marker
    // disappears, then try to resolve workflow from head. Our simple text node
    // won't resolve, so it will fail — but the key test is that the poll loop
    // DID exit (it didn't time out). We use a generous timeout to prove this.
    await expect(cmdThreadJoin(storageRoot, threadId, 5000)).rejects.toThrow(
      /failed to resolve workflow|process\.exit/,
    );
  });
});
