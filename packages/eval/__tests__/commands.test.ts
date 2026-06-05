import { bootstrap, createMemoryStore, putSchema } from "@ocas/core";
import type { CasRef } from "@united-workforce/protocol";
import { describe, expect, test } from "vitest";

import {
  formatDiff,
  formatList,
  formatReport,
  readEvalEntries,
  readEvalRun,
  selectEntries,
} from "../src/commands/index.js";
import type { EvalRunPayload, EvalStore } from "../src/storage/index.js";
import { EVAL_RUN_SCHEMA, setEvalLatest } from "../src/storage/index.js";

function makeEvalStore(): EvalStore {
  const store = createMemoryStore();
  bootstrap(store);
  return { store, varStore: store.var };
}

function makePayload(
  task: string,
  overall: number,
  timestamp: number,
  judges: EvalRunPayload["judges"] = [
    {
      name: "frontmatter-compliance",
      score: 1.0,
      weight: 0.6,
      dataHash: "AAAAAAAAAAAAA" as CasRef,
    },
    { name: "token-stats", score: 0.5, weight: 0, dataHash: "BBBBBBBBBBBBB" as CasRef },
  ],
  config: EvalRunPayload["config"] = {
    agent: "hermes",
    model: "claude-sonnet-4",
    engineVersion: "1.0.0",
  },
): EvalRunPayload {
  return { task, config, threadId: "THREAD0123456789", judges, overall, timestamp };
}

/** Store an eval-run node in CAS and index it under @uwf/eval/<task>/latest. */
function storeRun(evalStore: EvalStore, payload: EvalRunPayload): string {
  const schemaHash = putSchema(evalStore.store, EVAL_RUN_SCHEMA);
  const hash = evalStore.store.cas.put(schemaHash, payload);
  setEvalLatest(evalStore.varStore, payload.task, hash);
  return hash;
}

describe("formatReport", () => {
  test("includes task, overall, config and judges", () => {
    const payload = makePayload("fix-off-by-one", 0.8, Date.UTC(2026, 0, 2, 3, 4, 5));
    const output = formatReport(payload, "RUNHASH123456");

    expect(output).toContain("fix-off-by-one");
    expect(output).toContain("0.8000");
    expect(output).toContain("hermes");
    expect(output).toContain("claude-sonnet-4");
    expect(output).toContain("1.0.0");
    expect(output).toContain("frontmatter-compliance");
    expect(output).toContain("token-stats");
    expect(output).toContain("THREAD0123456789");
    expect(output).toContain("RUNHASH123456");
  });

  test("round-trips a stored run via readEvalRun", () => {
    const evalStore = makeEvalStore();
    const payload = makePayload("fix-off-by-one", 0.75, Date.now());
    const hash = storeRun(evalStore, payload);

    const loaded = readEvalRun(evalStore, hash);
    expect(loaded).not.toBeNull();
    const output = formatReport(loaded as EvalRunPayload, hash);
    expect(output).toContain("fix-off-by-one");
    expect(output).toContain("0.7500");
  });

  test("readEvalRun returns null for a missing hash", () => {
    const evalStore = makeEvalStore();
    expect(readEvalRun(evalStore, "NOPENOPENOPE0")).toBeNull();
  });
});

describe("list", () => {
  test("lists eval runs stored under different tasks", () => {
    const evalStore = makeEvalStore();
    storeRun(evalStore, makePayload("fix-off-by-one", 0.8, 2000));
    storeRun(evalStore, makePayload("write-docs", 0.6, 1000));

    const entries = readEvalEntries(evalStore);
    expect(entries).toHaveLength(2);

    const output = formatList(selectEntries(entries, null, 20));
    expect(output).toContain("fix-off-by-one");
    expect(output).toContain("write-docs");
  });

  test("sorts newest-first by timestamp", () => {
    const evalStore = makeEvalStore();
    storeRun(evalStore, makePayload("old-task", 0.5, 1000));
    storeRun(evalStore, makePayload("new-task", 0.5, 2000));

    const selected = selectEntries(readEvalEntries(evalStore), null, 20);
    expect(selected[0]?.task).toBe("new-task");
    expect(selected[1]?.task).toBe("old-task");
  });

  test("--task filter only shows the matching task", () => {
    const evalStore = makeEvalStore();
    storeRun(evalStore, makePayload("fix-off-by-one", 0.8, 2000));
    storeRun(evalStore, makePayload("write-docs", 0.6, 1000));

    const output = formatList(selectEntries(readEvalEntries(evalStore), "write-docs", 20));
    expect(output).toContain("write-docs");
    expect(output).not.toContain("fix-off-by-one");
  });

  test("--limit caps the number of rows", () => {
    const evalStore = makeEvalStore();
    storeRun(evalStore, makePayload("task-a", 0.8, 3000));
    storeRun(evalStore, makePayload("task-b", 0.6, 2000));
    storeRun(evalStore, makePayload("task-c", 0.4, 1000));

    const selected = selectEntries(readEvalEntries(evalStore), null, 2);
    expect(selected).toHaveLength(2);
    expect(selected.map((e) => e.task)).toEqual(["task-a", "task-b"]);
  });

  test("empty store renders a placeholder", () => {
    const evalStore = makeEvalStore();
    const output = formatList(selectEntries(readEvalEntries(evalStore), null, 20));
    expect(output).toContain("(no eval runs found)");
  });
});

describe("formatDiff", () => {
  test("shows an upward delta when B scores higher", () => {
    const a = makePayload("fix-off-by-one", 0.6, 1000);
    const b = makePayload("fix-off-by-one", 0.8, 2000);
    const output = formatDiff(a, "HASHA00000000", b, "HASHB00000000");

    expect(output).toContain("▲");
    expect(output).toContain("HASHA00000000");
    expect(output).toContain("HASHB00000000");
  });

  test("shows a downward delta when B scores lower", () => {
    const a = makePayload("fix-off-by-one", 0.9, 1000);
    const b = makePayload("fix-off-by-one", 0.4, 2000);
    const output = formatDiff(a, "HASHA00000000", b, "HASHB00000000");
    expect(output).toContain("▼");
  });

  test("marks differing config values", () => {
    const a = makePayload("fix-off-by-one", 0.6, 1000, undefined, {
      agent: "hermes",
      model: "claude-sonnet-4",
      engineVersion: "1.0.0",
    });
    const b = makePayload("fix-off-by-one", 0.6, 2000, undefined, {
      agent: "claude-code",
      model: "claude-sonnet-4",
      engineVersion: "1.0.0",
    });
    const output = formatDiff(a, "HASHA00000000", b, "HASHB00000000");
    expect(output).toContain("≠");
    expect(output).toContain("claude-code");
  });
});
