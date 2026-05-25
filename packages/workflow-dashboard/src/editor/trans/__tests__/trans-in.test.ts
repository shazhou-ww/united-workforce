import { describe, expect, it } from "vitest";
import { transIn } from "../trans-in.js";
import type { WorkFlowStep } from "../type.js";

function makeStep(name: string, transitions: WorkFlowStep["transitions"]): WorkFlowStep {
  return {
    role: {
      name,
      description: "",
      identity: "",
      prepare: "",
      execute: "",
      report: "",
    },
    transitions,
  };
}

describe("transIn", () => {
  it("4.1 Empty steps → start + end nodes, no edges", () => {
    const { nodes, edges } = transIn([]);
    expect(nodes).toHaveLength(2);
    expect(nodes.find((n) => n.id === "start")).toBeDefined();
    expect(nodes.find((n) => n.id === "end")).toBeDefined();
    expect(edges).toHaveLength(0);
  });

  it("4.2 Single step with no END transition → start→role edge exists", () => {
    const steps = [makeStep("A", [])];
    const { nodes, edges } = transIn(steps);
    expect(nodes).toHaveLength(3); // start, end, role-A
    const startEdge = edges.find((e) => e.source === "start");
    expect(startEdge).toBeDefined();
    const roleNode = nodes.find((n) => n.type === "role");
    expect(startEdge?.target).toBe(roleNode?.id);
  });

  it("4.3 Single step with END transition → edge to end node exists", () => {
    const steps = [makeStep("A", [{ status: "_", target: "END" }])];
    const { edges } = transIn(steps);
    const endEdge = edges.find((e) => e.target === "end");
    expect(endEdge).toBeDefined();
  });

  it("4.4 Two steps with default transitions chain", () => {
    const steps = [
      makeStep("A", [{ status: "_", target: "B" }]),
      makeStep("B", [{ status: "_", target: "END" }]),
    ];
    const { edges } = transIn(steps);
    // Should have start→A, A→B, B→end
    expect(edges.find((e) => e.source === "start")).toBeDefined();
    const nodeAId = edges.find((e) => e.source === "start")?.target;
    expect(edges.find((e) => e.source === nodeAId && e.target !== "end")).toBeDefined();
    expect(edges.find((e) => e.target === "end")).toBeDefined();
    // No status edges for single default transitions
    expect(edges.every((e) => e.type !== "status")).toBe(true);
  });

  it("4.5 Step with multiple transitions → status edges", () => {
    const steps = [
      makeStep("A", [
        { status: "_", target: "B" },
        { status: "approved", target: "C" },
      ]),
      makeStep("B", []),
      makeStep("C", []),
    ];
    const { edges } = transIn(steps);
    const nodeAId = edges.find((e) => e.source === "start")?.target;
    const outEdges = edges.filter((e) => e.source === nodeAId);
    expect(outEdges.every((e) => e.type === "status")).toBe(true);
  });

  it("4.5b Multiple transitions include expected status values", () => {
    const steps = [
      makeStep("A", [
        { status: "_", target: "B" },
        { status: "approved", target: "C" },
      ]),
      makeStep("B", []),
      makeStep("C", []),
    ];
    const { edges } = transIn(steps);
    const nodeAId = edges.find((e) => e.source === "start")?.target;
    const outEdges = edges.filter((e) => e.source === nodeAId);
    const defaultEdge = outEdges.find(
      (e) => (e as { data?: { status?: string } }).data?.status === "_",
    );
    expect(defaultEdge).toBeDefined();
    const approvedEdge = outEdges.find(
      (e) => (e as { data?: { status?: string } }).data?.status === "approved",
    );
    expect(approvedEdge).toBeDefined();
  });

  it("4.6 With 1 incoming edge: targetHandle = 'input'; with 2: first gets 'input'", () => {
    const steps = [
      makeStep("A", [{ status: "_", target: "END" }]),
      makeStep("B", [{ status: "_", target: "END" }]),
    ];
    const { edges } = transIn(steps);
    // start→A and start→B; end has 2 incoming edges
    const incomingToEnd = edges.filter((e) => e.target === "end");
    expect(incomingToEnd[0].targetHandle).toBe("input");
  });

  it("4.7 Same role name maps to same node id across steps", () => {
    const steps = [
      makeStep("A", [{ status: "_", target: "B" }]),
      makeStep("B", [{ status: "_", target: "A" }]),
    ];
    const { edges } = transIn(steps);
    const aId = edges.find((e) => e.source === "start")?.target;
    // B→A edge target should be same node as start→A edge target
    const bToAEdge = edges.find(
      (e) => e.source !== "start" && e.target === aId && e.target !== "end",
    );
    expect(bToAEdge).toBeDefined();
  });
});
