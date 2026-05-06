import { describe, expect, test } from "bun:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readWorkflowRegistry,
  registerWorkflowVersion,
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

  test("parse errors on invalid shape", async () => {
    const dir = join(tmpdir(), `wf-reg3-${process.pid}-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "workflow.yaml"), 'workflows: "broken"\n', "utf8");
    const bad = await readWorkflowRegistry(dir);
    expect(bad.ok).toBe(false);
    await rm(dir, { recursive: true, force: true });
  });
});
