import { describe, expect, test } from "bun:test";
import { packageDescriptor } from "../src/package-descriptor.js";
import { createOfficeAgent } from "../src/agent.js";

describe("createOfficeAgent", () => {
  test("returns an AdapterFn (function)", () => {
    const agent = createOfficeAgent({ outputDir: "/tmp", command: null, timeout: null });
    expect(typeof agent).toBe("function");
  });

  test("AdapterFn returns a RoleFn (function)", () => {
    const agent = createOfficeAgent({ outputDir: "/tmp", command: null, timeout: null });
    const roleFn = agent("", expect.anything() as never);
    expect(typeof roleFn).toBe("function");
  });
});

describe("packageDescriptor", () => {
  test("has correct name", () => {
    expect(packageDescriptor.name).toBe("@uncaged/workflow-agent-office");
  });

  test("has outputDir in configSchema required", () => {
    const schema = packageDescriptor.configSchema as { required: string[] };
    expect(schema.required).toContain("outputDir");
  });
});
