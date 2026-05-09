import { describe, expect, test } from "bun:test";
import type { StateNode } from "@uncaged/workflow-protocol";

import { collectRefs } from "../src/collect-refs.js";

function payload(
  partial: Partial<StateNode["payload"]> & Pick<StateNode["payload"], "role">,
): StateNode["payload"] {
  return {
    role: partial.role,
    meta: partial.meta ?? {},
    start: partial.start ?? "STARTHASH000000000000001",
    content: partial.content ?? "CONTENTHASH00000000000001",
    ancestors: partial.ancestors ?? [],
    compact: partial.compact ?? null,
    timestamp: partial.timestamp ?? 0,
  };
}

describe("collectRefs", () => {
  test("collects start, content, ancestors, and compact hashes in order", () => {
    const refs = collectRefs(
      payload({
        role: "coder",
        start: "01START00000000000000001",
        content: "01CONTENT0000000000000001",
        ancestors: ["01PARENT0000000000000001", "01GRAND000000000000000001"],
        compact: "01COMPACT0000000000000001",
      }),
    );
    expect(refs).toEqual([
      "01START00000000000000001",
      "01CONTENT0000000000000001",
      "01PARENT0000000000000001",
      "01GRAND000000000000000001",
      "01COMPACT0000000000000001",
    ]);
  });

  test("does not collect compact when compact is null", () => {
    const refs = collectRefs(
      payload({
        role: "coder",
        start: "S1",
        content: "C1",
        ancestors: ["A1"],
        compact: null,
      }),
    );
    expect(refs).toEqual(["S1", "C1", "A1"]);
  });

  test("returns only start and content when ancestors is empty", () => {
    const refs = collectRefs(
      payload({
        role: "coder",
        start: "S2",
        content: "C2",
        ancestors: [],
        compact: null,
      }),
    );
    expect(refs).toEqual(["S2", "C2"]);
  });
});
