import { describe, expect, it } from 'vitest';
import type { Edge, Node } from "@xyflow/react";
import { LayoutLR } from "../index.js";

function makeNode(id: string): Node {
  return { id, type: "role", data: {}, position: { x: 0, y: 0 } } as Node;
}

function makeEdge(source: string, target: string): Edge {
  return { id: `${source}-${target}`, source, target } as Edge;
}

describe("LayoutLR / assignLayers", () => {
  it("1.1 Empty graph: start gets layer 0, end gets higher layer", () => {
    const nodes = [makeNode("start"), makeNode("end")];
    const result = LayoutLR(nodes, []);
    const start = result.find((n) => n.id === "start");
    const end = result.find((n) => n.id === "end");
    // start has no position change necessarily, but positions should be assigned
    expect(start).toBeDefined();
    expect(end).toBeDefined();
    // end should be to the right of start
    expect((end?.position.x ?? 0) > (start?.position.x ?? 0)).toBe(true);
  });

  it("1.2 Linear chain: start → A → B → end — layers assigned in order", () => {
    const nodes = [makeNode("start"), makeNode("A"), makeNode("B"), makeNode("end")];
    const edges = [makeEdge("start", "A"), makeEdge("A", "B"), makeEdge("B", "end")];
    const result = LayoutLR(nodes, edges);
    const xOf = (id: string) => result.find((n) => n.id === id)?.position.x ?? 0;
    expect(xOf("start") < xOf("A")).toBe(true);
    expect(xOf("A") < xOf("B")).toBe(true);
    expect(xOf("B") < xOf("end")).toBe(true);
  });

  it("1.3 Diamond: A and B share same layer", () => {
    const nodes = [makeNode("start"), makeNode("A"), makeNode("B"), makeNode("C"), makeNode("end")];
    const edges = [
      makeEdge("start", "A"),
      makeEdge("start", "B"),
      makeEdge("A", "C"),
      makeEdge("B", "C"),
      makeEdge("C", "end"),
    ];
    const result = LayoutLR(nodes, edges);
    const xOf = (id: string) => result.find((n) => n.id === id)?.position.x ?? 0;
    expect(xOf("A")).toBe(xOf("B")); // same layer
    expect(xOf("A") < xOf("C")).toBe(true);
    expect(xOf("C") < xOf("end")).toBe(true);
  });

  it("1.4 Isolated node placed in middle layer (not layer 0, not end layer)", () => {
    const nodes = [makeNode("start"), makeNode("A"), makeNode("isolated"), makeNode("end")];
    const edges = [makeEdge("start", "A"), makeEdge("A", "end")];
    const result = LayoutLR(nodes, edges);
    const xOf = (id: string) => result.find((n) => n.id === id)?.position.x ?? 0;
    const xIsolated = xOf("isolated");
    expect(xIsolated > xOf("start")).toBe(true);
    expect(xIsolated < xOf("end")).toBe(true);
  });

  it("1.5 end node is always last (highest x)", () => {
    const nodes = [makeNode("start"), makeNode("A"), makeNode("B"), makeNode("end")];
    const edges = [makeEdge("start", "A"), makeEdge("A", "B"), makeEdge("B", "end")];
    const result = LayoutLR(nodes, edges);
    const endX = result.find((n) => n.id === "end")?.position.x ?? 0;
    for (const node of result) {
      if (node.id !== "end") {
        expect(node.position.x < endX).toBe(true);
      }
    }
  });

  it("1.6 start node is always first (x = 0 or smallest x)", () => {
    const nodes = [makeNode("start"), makeNode("A"), makeNode("end")];
    const edges = [makeEdge("start", "A"), makeEdge("A", "end")];
    const result = LayoutLR(nodes, edges);
    const startX = result.find((n) => n.id === "start")?.position.x ?? 0;
    for (const node of result) {
      expect(node.position.x >= startX).toBe(true);
    }
  });
});
