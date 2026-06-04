import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { parseScenario, selectMockStep } from "../src/mock-agent.js";

const FIXTURE = join(__dirname, "fixtures", "simple-scenario.yaml");

describe("parseScenario", () => {
  test("parses the 2-step fixture in order", async () => {
    const scenario = parseScenario(await readFile(FIXTURE, "utf8"));
    expect(scenario.steps).toHaveLength(2);
    expect(scenario.steps[0].role).toBe("planner");
    expect(scenario.steps[1].role).toBe("developer");
    expect(scenario.steps[0].output).toContain("$status: ready");
    expect(scenario.steps[1].output).toContain("branch: fix/1-test");
  });

  test("rejects documents without a steps array", () => {
    expect(() => parseScenario("foo: bar")).toThrow(/steps/);
  });

  test("rejects steps missing role or output", () => {
    expect(() => parseScenario("steps:\n  - role: planner")).toThrow(/role.*output/);
  });
});

describe("selectMockStep", () => {
  const scenario = {
    steps: [
      { role: "planner", output: "plan-output" },
      { role: "developer", output: "dev-output" },
    ],
  };

  test("step index counts existing steps to pick the current step", () => {
    expect(selectMockStep(scenario, 0, "planner").output).toBe("plan-output");
    expect(selectMockStep(scenario, 1, "developer").output).toBe("dev-output");
  });

  test("throws when the moderator routes to an unexpected role", () => {
    expect(() => selectMockStep(scenario, 0, "developer")).toThrow(/expected role "planner"/);
  });

  test("throws when the step index runs past the scripted steps", () => {
    expect(() => selectMockStep(scenario, 2, "planner")).toThrow(/no step at index 2/);
  });
});
