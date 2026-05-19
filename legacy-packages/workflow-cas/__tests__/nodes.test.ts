import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";

import { createCasStore } from "../src/cas.js";
import { parseCasThreadNode, putStartNode, putStateNode } from "../src/nodes.js";

describe("putStartNode — parentState in refs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wf-cas-nodes-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("refs contains only promptHash when parentState is null", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const promptHash = await cas.put("hello");
    const startHash = await putStartNode(
      cas,
      { name: "demo", hash: "BUNDLEAAAAAAAAA", depth: 0, parentState: null },
      promptHash,
    );

    const blob = await cas.get(startHash);
    expect(blob).not.toBeNull();
    const parsed = parseCasThreadNode(blob ?? "");
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("start");
    if (parsed?.kind !== "start") return;

    expect(parsed.node.refs).toEqual([promptHash]);
    expect(parsed.node.payload.parentState).toBeNull();
  });

  test("refs contains [promptHash, parentStateHash] when parentState is set", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const parentStateHash = await cas.put("fake-parent-state");
    const promptHash = await cas.put("child-prompt");
    const startHash = await putStartNode(
      cas,
      { name: "develop", hash: "BUNDLEBBBBBBBBB", depth: 1, parentState: parentStateHash },
      promptHash,
    );

    const blob = await cas.get(startHash);
    expect(blob).not.toBeNull();
    const parsed = parseCasThreadNode(blob ?? "");
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("start");
    if (parsed?.kind !== "start") return;

    expect(parsed.node.refs).toEqual([promptHash, parentStateHash]);
    expect(parsed.node.payload.parentState).toBe(parentStateHash);
  });
});

describe("putStateNode — childThread in refs", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "wf-cas-nodes-state-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("refs does not include childThread when childThread is null", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const startHash = await cas.put("start");
    const contentHash = await cas.put("content");
    const stateHash = await putStateNode(cas, {
      role: "planner",
      meta: {},
      start: startHash,
      content: contentHash,
      ancestors: [],
      compact: null,
      timestamp: 1000,
      childThread: null,
    });

    const blob = await cas.get(stateHash);
    expect(blob).not.toBeNull();
    const parsed = parseCasThreadNode(blob ?? "");
    expect(parsed?.kind).toBe("state");
    if (parsed?.kind !== "state") return;

    expect(parsed.node.refs).not.toContain("anything-else");
    expect(parsed.node.refs).toEqual([startHash, contentHash]);
    expect(parsed.node.payload.childThread).toBeNull();
  });

  test("refs includes childThread hash when childThread is set", async () => {
    const cas = createCasStore(join(dir, "cas"));
    const startHash = await cas.put("start");
    const contentHash = await cas.put("content");
    const childEndHash = await cas.put("child-end-state");
    const stateHash = await putStateNode(cas, {
      role: "developer",
      meta: { pr: 42 },
      start: startHash,
      content: contentHash,
      ancestors: [],
      compact: null,
      timestamp: 2000,
      childThread: childEndHash,
    });

    const blob = await cas.get(stateHash);
    expect(blob).not.toBeNull();
    const parsed = parseCasThreadNode(blob ?? "");
    expect(parsed?.kind).toBe("state");
    if (parsed?.kind !== "state") return;

    expect(parsed.node.refs).toContain(childEndHash);
    expect(parsed.node.payload.childThread).toBe(childEndHash);
  });
});

describe("parseCasThreadNode — legacy node compatibility", () => {
  test("start node without parentState field defaults to null", () => {
    const yaml = stringify({
      type: "start",
      payload: { name: "demo", hash: "BUNDLEAAAAAAAAA", depth: 0 },
      refs: ["PROMPTHASH00001"],
    });
    const parsed = parseCasThreadNode(yaml);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("start");
    if (parsed?.kind !== "start") return;
    expect(parsed.node.payload.parentState).toBeNull();
  });

  test("state node without childThread field defaults to null", () => {
    const yaml = stringify({
      type: "state",
      payload: {
        role: "planner",
        meta: {},
        start: "STARTHASH00001",
        content: "CONTENTHASH0001",
        ancestors: [],
        compact: null,
        timestamp: 1000,
      },
      refs: ["STARTHASH00001", "CONTENTHASH0001"],
    });
    const parsed = parseCasThreadNode(yaml);
    expect(parsed).not.toBeNull();
    expect(parsed?.kind).toBe("state");
    if (parsed?.kind !== "state") return;
    expect(parsed.node.payload.childThread).toBeNull();
  });
});
