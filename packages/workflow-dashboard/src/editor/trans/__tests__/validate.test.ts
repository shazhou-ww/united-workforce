import { describe, expect, it } from "vitest";
import type { AnyWorkEdge, AnyWorkNode } from "../../type.js";
import { validate } from "../validate.js";

function roleNode(id: string): AnyWorkNode {
  return {
    id,
    type: "role",
    data: { name: id, description: "", identity: "", prepare: "", execute: "", report: "" },
    position: { x: 0, y: 0 },
  } as AnyWorkNode;
}

function startNode(): AnyWorkNode {
  return {
    id: "start",
    type: "start",
    data: { label: "Start" },
    position: { x: 0, y: 0 },
  } as AnyWorkNode;
}

function endNode(): AnyWorkNode {
  return {
    id: "end",
    type: "end",
    data: { label: "End" },
    position: { x: 0, y: 0 },
  } as AnyWorkNode;
}

function defaultEdge(source: string, target: string): AnyWorkEdge {
  return { id: `${source}-${target}`, source, target, animated: true } as AnyWorkEdge;
}

function conditionalEdge(source: string, target: string, condition: string): AnyWorkEdge {
  return {
    id: `${source}-${target}-cond`,
    source,
    target,
    type: "conditional" as const,
    data: { condition },
    animated: true,
  } as AnyWorkEdge;
}

// Helper: build a minimal valid graph with 2 role nodes for validateRoleNodes tests
function baseNodes(...roles: AnyWorkNode[]): AnyWorkNode[] {
  return [startNode(), ...roles, endNode()];
}

describe("validateRoleNodes (via validate)", () => {
  it("5.1 Role node with no incoming edge → error about missing input", () => {
    const n1 = roleNode("n1");
    const n2 = roleNode("n2");
    const nodes = baseNodes(n1, n2);
    // n1 has no incoming, n2 has incoming+outgoing
    const edges = [defaultEdge("start", "n2"), defaultEdge("n1", "end"), defaultEdge("n2", "end")];
    const result = validate(nodes, edges);
    const nodeErrors = result.errors.filter((e) => e.nodeId === "n1");
    expect(nodeErrors.some((e) => e.message.includes("缺少输入连接"))).toBe(true);
  });

  it("5.2 Role node with no outgoing edge → error about missing output", () => {
    const n1 = roleNode("n1");
    const n2 = roleNode("n2");
    const nodes = baseNodes(n1, n2);
    const edges = [
      defaultEdge("start", "n1"),
      defaultEdge("start", "n2"),
      defaultEdge("n2", "end"),
      // n1 has no outgoing
    ];
    const result = validate(nodes, edges);
    const nodeErrors = result.errors.filter((e) => e.nodeId === "n1");
    expect(nodeErrors.some((e) => e.message.includes("缺少输出连接"))).toBe(true);
  });

  it("5.3 Empty condition on non-first conditional edge → error", () => {
    const n1 = roleNode("n1");
    const n2 = roleNode("n2");
    const n3 = roleNode("n3");
    const nodes = baseNodes(n1, n2, n3);
    const edges = [
      defaultEdge("start", "n1"),
      conditionalEdge("n1", "n2", ""), // else-branch (index 0) - exempt
      conditionalEdge("n1", "n3", ""), // if-branch (index 1) - empty condition → error
      defaultEdge("n2", "end"),
      defaultEdge("n3", "end"),
    ];
    const result = validate(nodes, edges);
    expect(result.errors.some((e) => e.message.includes("条件表达式不能为空"))).toBe(true);
  });

  it("5.4 Mix of conditional and non-conditional outgoing → error", () => {
    const n1 = roleNode("n1");
    const n2 = roleNode("n2");
    const n3 = roleNode("n3");
    const nodes = baseNodes(n1, n2, n3);
    const edges = [
      defaultEdge("start", "n1"),
      conditionalEdge("n1", "n2", "x>0"),
      defaultEdge("n1", "n3"), // mix → error
      defaultEdge("n2", "end"),
      defaultEdge("n3", "end"),
    ];
    const result = validate(nodes, edges);
    expect(result.errors.some((e) => e.message.includes("所有出边必须附带条件"))).toBe(true);
  });

  it("5.5 Valid role node (1 in, 1 out default) → no errors for that node", () => {
    const n1 = roleNode("n1");
    const n2 = roleNode("n2");
    const nodes = baseNodes(n1, n2);
    const edges = [defaultEdge("start", "n1"), defaultEdge("n1", "n2"), defaultEdge("n2", "end")];
    const result = validate(nodes, edges);
    const roleErrors = result.errors.filter((e) => e.nodeId === "n1" || e.nodeId === "n2");
    expect(roleErrors).toHaveLength(0);
  });

  it("5.6 Valid role node (1 in, 2 conditional out with conditions) → no errors", () => {
    const n1 = roleNode("n1");
    const n2 = roleNode("n2");
    const n3 = roleNode("n3");
    const nodes = baseNodes(n1, n2, n3);
    const edges = [
      defaultEdge("start", "n1"),
      conditionalEdge("n1", "n2", ""), // else-branch
      conditionalEdge("n1", "n3", "x>0"), // if-branch
      defaultEdge("n2", "end"),
      defaultEdge("n3", "end"),
    ];
    const result = validate(nodes, edges);
    const n1Errors = result.errors.filter((e) => e.nodeId === "n1");
    expect(n1Errors).toHaveLength(0);
  });
});
