import { describe, expect, test } from "bun:test";
import { packageDescriptor } from "../src/package-descriptor.js";
import { createDocxDiffAgent } from "../src/agent.js";

describe("createDocxDiffAgent", () => {
  test("returns an AdapterFn (function)", () => {
    const agent = createDocxDiffAgent({ command: null });
    expect(typeof agent).toBe("function");
  });

  test("AdapterFn returns a RoleFn (function)", () => {
    const agent = createDocxDiffAgent({ command: null });
    const roleFn = agent("", expect.anything() as never);
    expect(typeof roleFn).toBe("function");
  });
});

describe("packageDescriptor", () => {
  test("has correct name", () => {
    expect(packageDescriptor.name).toBe("@uncaged/workflow-agent-docx-diff");
  });
});
