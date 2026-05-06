import { describe, expect, test } from "bun:test";

import {
  buildForkPlan,
  parseThreadDataJsonl,
  selectForkHistoricalSteps,
} from "../src/fork-thread.js";

const sampleDataJsonl = `{"name":"demo","hash":"C9NMV6V2TQT81","threadId":"01AAA1111111111111111111","parameters":{"prompt":"hi","options":{"maxRounds":5}},"timestamp":100}
{"role":"planner","content":"p","meta":{},"timestamp":101}
{"role":"coder","content":"c","meta":{},"timestamp":102}
{"role":"reviewer","content":"r","meta":{},"timestamp":103}
`;

describe("fork-thread", () => {
  test("parseThreadDataJsonl reads start + role steps", () => {
    const r = parseThreadDataJsonl(sampleDataJsonl);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.start.workflowName).toBe("demo");
    expect(r.value.start.hash).toBe("C9NMV6V2TQT81");
    expect(r.value.start.threadId).toBe("01AAA1111111111111111111");
    expect(r.value.start.prompt).toBe("hi");
    expect(r.value.start.maxRounds).toBe(5);
    expect(r.value.roleSteps.length).toBe(3);
    expect(r.value.roleSteps[0]?.role).toBe("planner");
  });

  test("selectForkHistoricalSteps: --from-role keeps through first matching role", () => {
    const parsed = parseThreadDataJsonl(sampleDataJsonl);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const sel = selectForkHistoricalSteps(parsed.value.roleSteps, "planner");
    expect(sel.ok).toBe(true);
    if (!sel.ok) {
      return;
    }
    expect(sel.value.length).toBe(1);
    expect(sel.value[0]?.role).toBe("planner");
  });

  test("selectForkHistoricalSteps: retry last drops final step", () => {
    const parsed = parseThreadDataJsonl(sampleDataJsonl);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const sel = selectForkHistoricalSteps(parsed.value.roleSteps, null);
    expect(sel.ok).toBe(true);
    if (!sel.ok) {
      return;
    }
    expect(sel.value.map((s) => s.role)).toEqual(["planner", "coder"]);
  });

  test("selectForkHistoricalSteps: unknown role lists available names", () => {
    const parsed = parseThreadDataJsonl(sampleDataJsonl);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    const sel = selectForkHistoricalSteps(parsed.value.roleSteps, "nope");
    expect(sel.ok).toBe(false);
    if (sel.ok) {
      return;
    }
    expect(sel.error).toContain("planner");
    expect(sel.error).toContain("coder");
    expect(sel.error).toContain("reviewer");
  });

  test("buildForkPlan composes worker payload", () => {
    const r = buildForkPlan(sampleDataJsonl, "planner");
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.sourceThreadId).toBe("01AAA1111111111111111111");
    expect(r.value.workflowName).toBe("demo");
    expect(r.value.historicalSteps.length).toBe(1);
    expect(r.value.historicalSteps[0]?.timestamp).toBe(101);
    expect(r.value.runOptions).toEqual({ maxRounds: 5 });
  });
});
