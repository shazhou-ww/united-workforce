import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CasStore } from "@uncaged/workflow-cas";
import { createCasStore, parseCasThreadNode } from "@uncaged/workflow-cas";
import type { StartNode, StateNode } from "@uncaged/workflow-protocol";
import type {
  RoleOutput,
  ThreadContext,
  WorkflowCompletion,
  WorkflowFn,
  WorkflowRuntime,
} from "@uncaged/workflow-runtime";

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
    parentStateHash: null,
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
}> {
  const storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-merkle-"));
  await writeFile(join(storageRoot, "workflow.yaml"), TEST_REGISTRY_YAML, "utf8");
  const casDir = join(storageRoot, "cas");
  await mkdir(casDir, { recursive: true });
  return { storageRoot, casDir };
}

async function loadStartNode(cas: CasStore, endHash: string): Promise<StartNode> {
  const endBlob = await cas.get(endHash);
  const endParsed = parseCasThreadNode(endBlob ?? "");
  if (endParsed?.kind !== "state") throw new Error("expected state node");
  const startBlob = await cas.get(endParsed.node.payload.start);
  const startParsed = parseCasThreadNode(startBlob ?? "");
  if (startParsed?.kind !== "start") throw new Error("expected start node");
  return startParsed.node;
}

async function loadStateNode(cas: CasStore, hash: string): Promise<StateNode> {
  const blob = await cas.get(hash);
  const parsed = parseCasThreadNode(blob ?? "");
  if (parsed?.kind !== "state") throw new Error("expected state node");
  return parsed.node;
}

describe("Merkle call stack — cross-thread DAG linking (Phase 2)", () => {
  let storageRoot: string;
  let casDir: string;

  beforeEach(async () => {
    const setup = await setupStorage();
    storageRoot = setup.storageRoot;
    casDir = setup.casDir;
  });

  afterEach(async () => {
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("parentStateHash is written into child start node's parentState and refs", async () => {
    const cas = createCasStore(casDir);

    // biome-ignore lint/correctness/useYield: testing start-only path
    const parentWf: WorkflowFn = async function* (
      _thread: ThreadContext,
      _runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      return { returnCode: 0, summary: "parent done" };
    };

    const parentResult = await executeThread(
      parentWf,
      "parent-wf",
      { prompt: "parent task", steps: [] },
      makeOptions({ storageRoot }),
      {
        threadId: "P_THREAD_01",
        hash: "PARENTHASH0001",
        infoJsonlPath: join(storageRoot, "logs", "PARENTHASH0001", "P1.info.jsonl"),
        cas,
      },
      noLogger(),
    );

    // biome-ignore lint/correctness/useYield: testing start-only path
    const childWf: WorkflowFn = async function* (
      _thread: ThreadContext,
      _runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      return { returnCode: 0, summary: "child done" };
    };

    const childResult = await executeThread(
      childWf,
      "child-wf",
      { prompt: "child task", steps: [] },
      makeOptions({ storageRoot, depth: 1, parentStateHash: parentResult.rootHash }),
      {
        threadId: "C_THREAD_01",
        hash: "CHILDHASH00001",
        infoJsonlPath: join(storageRoot, "logs", "CHILDHASH00001", "C1.info.jsonl"),
        cas,
      },
      noLogger(),
    );

    const childStart = await loadStartNode(cas, childResult.rootHash);
    expect(childStart.payload.parentState).toBe(parentResult.rootHash);
    expect(childStart.refs).toContain(parentResult.rootHash);
  });

  test("childThread on parent state node points to child's final state and is in refs", async () => {
    const cas = createCasStore(casDir);
    const childFinalHash = "CHILD_FINAL_001";

    const parentWf: WorkflowFn = async function* (
      _thread: ThreadContext,
      runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      const h = await runtime.cas.put("developer output");
      yield {
        role: "developer",
        contentHash: h,
        meta: { action: "delegate" },
        refs: [h],
        childThread: childFinalHash,
      };
      return { returnCode: 0, summary: "parent complete" };
    };

    const result = await executeThread(
      parentWf,
      "parent-wf",
      { prompt: "parent task", steps: [] },
      makeOptions({ storageRoot }),
      {
        threadId: "P_THREAD_02",
        hash: "CTHREAD_TEST01",
        infoJsonlPath: join(storageRoot, "logs", "CTHREAD_TEST01", "P2.info.jsonl"),
        cas,
      },
      noLogger(),
    );

    const endNode = await loadStateNode(cas, result.rootHash);
    const devStateHash = endNode.payload.ancestors[0] ?? "";
    const devNode = await loadStateNode(cas, devStateHash);

    expect(devNode.payload.role).toBe("developer");
    expect(devNode.payload.childThread).toBe(childFinalHash);
    expect(devNode.refs).toContain(childFinalHash);
  });

  test("parent state with no child has childThread: null", async () => {
    const cas = createCasStore(casDir);

    const wf: WorkflowFn = async function* (
      _thread: ThreadContext,
      runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      const h = await runtime.cas.put("prep output");
      yield { role: "preparer", contentHash: h, meta: {}, refs: [h], childThread: null };
      return { returnCode: 0, summary: "done" };
    };

    const result = await executeThread(
      wf,
      "test-wf",
      { prompt: "task", steps: [] },
      makeOptions({ storageRoot }),
      {
        threadId: "NULL_CT_01",
        hash: "NULLCT_TEST001",
        infoJsonlPath: join(storageRoot, "logs", "NULLCT_TEST001", "N1.info.jsonl"),
        cas,
      },
      noLogger(),
    );

    const endNode = await loadStateNode(cas, result.rootHash);
    const prepHash = endNode.payload.ancestors[0] ?? "";
    const prepNode = await loadStateNode(cas, prepHash);

    expect(prepNode.payload.childThread).toBeNull();
    expect(prepNode.refs).not.toContain(null);
  });

  test("full bidirectional: child parentState is traversable to parent's context", async () => {
    const cas = createCasStore(casDir);
    const parentHash = "BIDIR_PARENT01";

    const parentWf: WorkflowFn = async function* (
      _thread: ThreadContext,
      runtime: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      const h1 = await runtime.cas.put("preparation output");
      yield {
        role: "preparer",
        contentHash: h1,
        meta: { repoPath: "/test" },
        refs: [h1],
        childThread: null,
      };
      const h2 = await runtime.cas.put("developer output");
      yield {
        role: "developer",
        contentHash: h2,
        meta: { action: "code" },
        refs: [h2],
        childThread: "CHILD_END_HASH1",
      };
      return { returnCode: 0, summary: "all done" };
    };

    const observedHeads: string[] = [];
    const opts = makeOptions({
      storageRoot,
      awaitAfterEachYield: async () => {
        const bundleDir = join(storageRoot, "bundles", parentHash);
        const text = await readFile(join(bundleDir, "threads.json"), "utf8");
        const parsed = JSON.parse(text) as Record<string, { head: string }>;
        const head = parsed.BIDIR_T_001?.head ?? null;
        if (head !== null) observedHeads.push(head);
      },
    });

    await executeThread(
      parentWf,
      "bidir-wf",
      { prompt: "bidir test", steps: [] },
      opts,
      {
        threadId: "BIDIR_T_001",
        hash: parentHash,
        infoJsonlPath: join(storageRoot, "logs", parentHash, "BD1.info.jsonl"),
        cas,
      },
      noLogger(),
    );

    expect(observedHeads.length).toBe(2);
    const preparerStateHash = observedHeads[0] ?? "";

    // Execute child with parentState pointing to parent's preparer state
    // biome-ignore lint/correctness/useYield: testing start-only path
    const childWf: WorkflowFn = async function* (
      _t: ThreadContext,
      _r: WorkflowRuntime,
    ): AsyncGenerator<RoleOutput, WorkflowCompletion> {
      return { returnCode: 0, summary: "child ok" };
    };

    const childResult = await executeThread(
      childWf,
      "bidir-child",
      { prompt: "child bidir", steps: [] },
      makeOptions({ storageRoot, depth: 1, parentStateHash: preparerStateHash }),
      {
        threadId: "BIDIR_C_001",
        hash: "BIDIR_CHILD001",
        infoJsonlPath: join(storageRoot, "logs", "BIDIR_CHILD001", "BC1.info.jsonl"),
        cas,
      },
      noLogger(),
    );

    // Upward traversal: child start → parentState → preparer state → meta.repoPath
    const childStart = await loadStartNode(cas, childResult.rootHash);
    expect(childStart.payload.parentState).toBe(preparerStateHash);

    const parentPrep = await loadStateNode(cas, preparerStateHash);
    expect(parentPrep.payload.meta.repoPath).toBe("/test");
  });
});
