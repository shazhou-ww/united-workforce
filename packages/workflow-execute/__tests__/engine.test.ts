import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCasStore } from "@uncaged/workflow-cas";

import type {
  RoleOutput,
  ThreadContext,
  WorkflowCompletion,
  WorkflowFn,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";
import { parse as parseYaml } from "yaml";

import { executeThread } from "../src/engine/engine.js";
import type { ExecuteThreadIo, ExecuteThreadOptions } from "../src/engine/types.js";

const TEST_REGISTRY_YAML = `config:
  maxDepth: 3
  supervisorInterval: 0
  providers:
    stub:
      baseUrl: http://127.0.0.1:9
      apiKey: test
  models:
    default: stub/m
workflows: {}
`;

function noLogger(): (tag: string, content: string) => void {
  return () => {};
}

function makeOptions(overrides: Partial<ExecuteThreadOptions>): ExecuteThreadOptions {
  return {
    depth: 0,
    signal: new AbortController().signal,
    awaitAfterEachYield: async () => {},
    forkSourceThreadId: null,
    prefilledDiskSteps: null,
    forkContinuation: null,
    replayTimestamps: null,
    storageRoot: "/tmp/never",
    ...overrides,
  };
}

async function setupStorage(): Promise<{
  storageRoot: string;
  casDir: string;
  bundleHash: string;
  bundleDir: string;
}> {
  const storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-engine-"));
  await writeFile(join(storageRoot, "workflow.yaml"), TEST_REGISTRY_YAML, "utf8");
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  const bundleHash = "TESTHASH00001";
  const bundleDir = join(storageRoot, "bundles", bundleHash);
  return { storageRoot, casDir, bundleHash, bundleDir };
}

function readCasNode(casDir: string, hash: string): Record<string, unknown> {
  const text = require("node:fs").readFileSync(join(casDir, `${hash}.txt`), "utf8") as string;
  return parseYaml(text) as Record<string, unknown>;
}

describe("executeThread (Phase 2 — CAS thread storage)", () => {
  let storageRoot: string;
  let casDir: string;
  let bundleHash: string;
  let bundleDir: string;

  beforeEach(async () => {
    const setup = await setupStorage();
    storageRoot = setup.storageRoot;
    casDir = setup.casDir;
    bundleHash = setup.bundleHash;
    bundleDir = setup.bundleDir;
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("writes a StartNode whose refs[0] is the prompt CAS hash", async () => {
    const cas = createCasStore(casDir);

    // biome-ignore lint/correctness/useYield: deliberately empty generator — exercises the start/end path with no role steps
    const wf: WorkflowFn = async function* (
      _thread: ThreadContext,
      _runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      return { returnCode: 0, summary: "no-op" };
    };

    const io: ExecuteThreadIo = {
      threadId: "T01",
      hash: bundleHash,
      infoJsonlPath: join(storageRoot, "logs", bundleHash, "T01.info.jsonl"),
      cas,
    };

    const result = await executeThread(
      wf,
      "demo",
      { prompt: "hello", steps: [] },
      makeOptions({ storageRoot }),
      io,
      noLogger(),
    );

    expect(result.returnCode).toBe(0);

    const historyText = await readFile(
      (await import("node:fs/promises")).readdir ? await firstHistoryFile(bundleDir) : "",
      "utf8",
    );
    const histLine = historyText.trim().split("\n")[0] ?? "";
    const histEntry = JSON.parse(histLine) as Record<string, unknown>;
    expect(histEntry.threadId).toBe("T01");

    const startHash = histEntry.start as string;
    const startNode = readCasNode(casDir, startHash);
    expect(startNode.type).toBe("start");
    expect((startNode.payload as Record<string, unknown>).name).toBe("demo");
    expect((startNode.payload as Record<string, unknown>).hash).toBe(bundleHash);

    const refs = startNode.refs as string[];
    expect(refs.length).toBe(1);

    const promptBlob = await cas.get(refs[0] ?? "");
    expect(promptBlob).not.toBeNull();
    const promptParsed = parseYaml(promptBlob ?? "") as Record<string, unknown>;
    expect(promptParsed.payload).toBe("hello");
  });

  test("each role yield produces a chained StateNode and updates threads.json head", async () => {
    const cas = createCasStore(casDir);

    const wf: WorkflowFn = async function* (
      _thread: ThreadContext,
      runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      const h1 = await runtime.cas.put("plan-text");
      yield { role: "planner", contentHash: h1, meta: { plan: 1 }, refs: [h1] };
      const h2 = await runtime.cas.put("code-text");
      yield { role: "coder", contentHash: h2, meta: { diff: "y" }, refs: [h2] };
      return { returnCode: 0, summary: "done" };
    };

    const io: ExecuteThreadIo = {
      threadId: "T02",
      hash: bundleHash,
      infoJsonlPath: join(storageRoot, "logs", bundleHash, "T02.info.jsonl"),
      cas,
    };

    let observedHead: string | null = null;
    let observedHeadAtSecondYield: string | null = null;

    const opts = makeOptions({
      storageRoot,
      awaitAfterEachYield: async () => {
        const text = await readFile(join(bundleDir, "threads.json"), "utf8");
        const parsed = JSON.parse(text) as Record<string, { head: string }>;
        const head = parsed.T02?.head ?? null;
        if (observedHead === null) {
          observedHead = head;
        } else if (observedHeadAtSecondYield === null) {
          observedHeadAtSecondYield = head;
        }
      },
    });

    const result = await executeThread(
      wf,
      "demo",
      { prompt: "p", steps: [] },
      opts,
      io,
      noLogger(),
    );
    expect(result.returnCode).toBe(0);

    expect(observedHead).not.toBeNull();
    expect(observedHeadAtSecondYield).not.toBeNull();
    expect(observedHead).not.toBe(observedHeadAtSecondYield);

    const firstState = readCasNode(casDir, observedHead ?? "");
    expect(firstState.type).toBe("state");
    expect((firstState.payload as Record<string, unknown>).role).toBe("planner");
    expect((firstState.payload as Record<string, unknown>).ancestors).toEqual([]);

    const secondState = readCasNode(casDir, observedHeadAtSecondYield ?? "");
    expect(secondState.type).toBe("state");
    expect((secondState.payload as Record<string, unknown>).role).toBe("coder");
    expect((secondState.payload as Record<string, unknown>).ancestors).toEqual([observedHead]);
    expect((secondState.payload as Record<string, unknown>).start).toBe(
      (firstState.payload as Record<string, unknown>).start,
    );
  });

  test("on completion: removes threads.json entry, appends history with __end__ head", async () => {
    const cas = createCasStore(casDir);

    const wf: WorkflowFn = async function* (
      _thread: ThreadContext,
      runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      const h = await runtime.cas.put("only-step");
      yield { role: "only", contentHash: h, meta: {}, refs: [h] };
      return { returnCode: 0, summary: "completed" };
    };

    const io: ExecuteThreadIo = {
      threadId: "T03",
      hash: bundleHash,
      infoJsonlPath: join(storageRoot, "logs", bundleHash, "T03.info.jsonl"),
      cas,
    };

    const result = await executeThread(
      wf,
      "demo",
      { prompt: "p", steps: [] },
      makeOptions({ storageRoot }),
      io,
      noLogger(),
    );

    expect(result.returnCode).toBe(0);

    const indexText = await readFile(join(bundleDir, "threads.json"), "utf8");
    const indexParsed = JSON.parse(indexText) as Record<string, unknown>;
    expect(indexParsed).toEqual({});

    const historyPath = await firstHistoryFile(bundleDir);
    const historyText = await readFile(historyPath, "utf8");
    const lines = historyText.trim().split("\n");
    expect(lines.length).toBe(1);
    const entry = JSON.parse(lines[0] ?? "") as Record<string, unknown>;
    expect(entry.threadId).toBe("T03");
    expect(entry.head).toBe(result.rootHash);

    const endNode = readCasNode(casDir, String(entry.head));
    expect(endNode.type).toBe("state");
    expect((endNode.payload as Record<string, unknown>).role).toBe("__end__");
    expect((endNode.payload as Record<string, unknown>).meta).toEqual({
      returnCode: 0,
      summary: "completed",
    });
  });

  test("does not write any .data.jsonl file under storageRoot", async () => {
    const cas = createCasStore(casDir);

    const wf: WorkflowFn = async function* (
      _thread: ThreadContext,
      runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      const h = await runtime.cas.put("step");
      yield { role: "only", contentHash: h, meta: {}, refs: [h] };
      return { returnCode: 0, summary: "done" };
    };

    const io: ExecuteThreadIo = {
      threadId: "T04",
      hash: bundleHash,
      infoJsonlPath: join(storageRoot, "logs", bundleHash, "T04.info.jsonl"),
      cas,
    };

    await executeThread(
      wf,
      "demo",
      { prompt: "p", steps: [] },
      makeOptions({ storageRoot }),
      io,
      noLogger(),
    );

    const fsp = await import("node:fs/promises");
    const found: string[] = [];
    async function walk(dir: string): Promise<void> {
      let entries: { name: string; isDirectory: () => boolean; isFile: () => boolean }[];
      try {
        entries = await fsp.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const ent of entries) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) {
          await walk(p);
        } else if (ent.isFile() && ent.name.endsWith(".data.jsonl")) {
          found.push(p);
        }
      }
    }
    await walk(storageRoot);
    expect(found).toEqual([]);
  });
});

async function firstHistoryFile(bundleDir: string): Promise<string> {
  const fsp = await import("node:fs/promises");
  const dir = join(bundleDir, "history");
  const entries = await fsp.readdir(dir);
  const file = entries.find((n) => n.endsWith(".jsonl"));
  if (file === undefined) {
    throw new Error(`no history file under ${dir}`);
  }
  return join(dir, file);
}
