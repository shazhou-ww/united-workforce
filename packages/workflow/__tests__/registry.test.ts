import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readWorkflowRegistry,
  registerWorkflowVersion,
  rollbackWorkflowToHistoryHash,
  unregisterWorkflow,
  writeWorkflowRegistry,
} from "../src/registry.js";

describe("workflow registry", () => {
  test("roundtrips through workflow.yaml", async () => {
    const dir = join(tmpdir(), `wf-reg-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });

    const empty = await readWorkflowRegistry(dir);
    expect(empty.ok).toBe(true);
    if (!empty.ok) {
      return;
    }

    const r1 = registerWorkflowVersion(empty.value, "solve-issue", "AAAAAAAAAAAAA", 100);
    const w1 = await writeWorkflowRegistry(dir, r1);
    expect(w1.ok).toBe(true);

    const back = await readWorkflowRegistry(dir);
    expect(back.ok).toBe(true);
    if (!back.ok) {
      await rm(dir, { recursive: true, force: true });
      return;
    }
    expect(back.value.workflows["solve-issue"]?.hash).toBe("AAAAAAAAAAAAA");

    const r2 = registerWorkflowVersion(back.value, "solve-issue", "BBBBBBBBBBBBB", 200);
    expect(r2.workflows["solve-issue"]?.history[0]?.hash).toBe("AAAAAAAAAAAAA");

    const removed = unregisterWorkflow(r2, "solve-issue");
    expect(removed.ok).toBe(true);
    if (!removed.ok) {
      await rm(dir, { recursive: true, force: true });
      return;
    }

    const w2 = await writeWorkflowRegistry(dir, removed.value);
    expect(w2.ok).toBe(true);

    const finalRead = await readWorkflowRegistry(dir);
    expect(finalRead.ok).toBe(true);
    if (finalRead.ok) {
      expect(finalRead.value.workflows["solve-issue"]).toBeUndefined();
    }

    await rm(dir, { recursive: true, force: true });
  });

  test("treats missing registry as empty", async () => {
    const dir = join(tmpdir(), `wf-reg2-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const empty = await readWorkflowRegistry(dir);
    expect(empty.ok).toBe(true);
    if (empty.ok) {
      expect(Object.keys(empty.value.workflows).length).toBe(0);
    }
    await rm(dir, { recursive: true, force: true });
  });

  test("rollbackWorkflowToHistoryHash swaps head with a prior version", () => {
    let reg = registerWorkflowVersion({ workflows: {} }, "solve-issue", "H1", 100);
    reg = registerWorkflowVersion(reg, "solve-issue", "H2", 200);
    reg = registerWorkflowVersion(reg, "solve-issue", "H3", 300);
    const entry = reg.workflows["solve-issue"];
    expect(entry).toBeDefined();
    if (entry === undefined) {
      return;
    }
    expect(entry.hash).toBe("H3");
    expect(entry.history.map((h) => h.hash)).toEqual(["H2", "H1"]);

    const toH2 = rollbackWorkflowToHistoryHash(entry, null);
    expect(toH2.ok).toBe(true);
    if (!toH2.ok) {
      return;
    }
    expect(toH2.value.hash).toBe("H2");
    expect(toH2.value.history.map((h) => h.hash)).toEqual(["H3", "H1"]);

    const toH1 = rollbackWorkflowToHistoryHash(toH2.value, "H1");
    expect(toH1.ok).toBe(true);
    if (!toH1.ok) {
      return;
    }
    expect(toH1.value.hash).toBe("H1");
    expect(toH1.value.history.map((h) => h.hash)).toEqual(["H2", "H3"]);

    const bad = rollbackWorkflowToHistoryHash(toH1.value, "NONE");
    expect(bad.ok).toBe(false);
  });

  test("parse errors on invalid shape", async () => {
    const dir = join(tmpdir(), `wf-reg3-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "workflow.yaml"), 'workflows: "broken"\n', "utf8");
    const bad = await readWorkflowRegistry(dir);
    expect(bad.ok).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
