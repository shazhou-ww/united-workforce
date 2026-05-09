import { describe, expect, test } from "bun:test";
import type { CasStore } from "@uncaged/workflow-protocol";
import { stringify } from "yaml";

import { findReachableHashes } from "../src/reachable.js";

function yamlBlob(refs: readonly string[]): string {
  return stringify({ type: "node", payload: {}, refs: [...refs] }, { indent: 2 });
}

function memoryCas(entries: Record<string, string>): CasStore {
  const map = { ...entries };
  return {
    async put(): Promise<string> {
      throw new Error("memoryCas.put not used in tests");
    },
    async get(hash: string): Promise<string | null> {
      return map[hash] ?? null;
    },
    async delete(): Promise<void> {},
    async list(): Promise<string[]> {
      return Object.keys(map);
    },
  };
}

describe("findReachableHashes", () => {
  test("walks refs recursively from a single root", async () => {
    const cas = memoryCas({
      R1: yamlBlob(["R2"]),
      R2: yamlBlob(["R3"]),
      R3: yamlBlob([]),
    });
    const reachable = await findReachableHashes(["R1"], cas);
    expect([...reachable].sort()).toEqual(["R1", "R2", "R3"]);
  });

  test("union of reachability from multiple roots", async () => {
    const cas = memoryCas({
      A: yamlBlob(["X"]),
      B: yamlBlob(["Y"]),
      X: yamlBlob([]),
      Y: yamlBlob(["Z"]),
      Z: yamlBlob([]),
    });
    const reachable = await findReachableHashes(["A", "B"], cas);
    expect([...reachable].sort()).toEqual(["A", "B", "X", "Y", "Z"]);
  });

  test("handles cycles via visited set", async () => {
    const cas = memoryCas({
      C1: yamlBlob(["C2"]),
      C2: yamlBlob(["C1"]),
    });
    const reachable = await findReachableHashes(["C1"], cas);
    expect(reachable.size).toBe(2);
    expect(reachable.has("C1")).toBe(true);
    expect(reachable.has("C2")).toBe(true);
  });

  test("does not throw when a ref points to a missing blob", async () => {
    const cas = memoryCas({
      H1: yamlBlob(["MISSINGHASH0000000000001"]),
    });
    const reachable = await findReachableHashes(["H1"], cas);
    expect(reachable.has("H1")).toBe(true);
    expect(reachable.has("MISSINGHASH0000000000001")).toBe(false);
  });
});
