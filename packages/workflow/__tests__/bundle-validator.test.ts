import { describe, expect, test } from "bun:test";

import { validateWorkflowBundle } from "../src/bundle-validator.js";

const minimalDescriptor = `export const descriptor = { description: "x", roles: {} };
`;

describe("validateWorkflowBundle", () => {
  test("accepts export { local as run } when local is a call expression result", () => {
    const source = `${minimalDescriptor}var wf = createFn({});
export { wf as run };
`;
    const r = validateWorkflowBundle({ filePath: "/tmp/w.esm.js", source });
    expect(r.ok).toBe(true);
  });

  test("accepts minimal valid builtin-only bundle", () => {
    const source = `${minimalDescriptor}import fs from "node:fs";

export const run = async function* (input) {
  fs.existsSync(".");
  return { returnCode: 0, summary: input.prompt };
};
`;
    const r = validateWorkflowBundle({ filePath: "/tmp/w.esm.js", source });
    expect(r.ok).toBe(true);
  });

  test("rejects wrong filename suffix", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.js",
      source: `${minimalDescriptor}export const run = async function* (input) { return { returnCode: 0, summary: input.prompt }; }\n`,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects default export", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `${minimalDescriptor}export default async function* (input) { return { returnCode: 0, summary: input.prompt }; }\n`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("default export");
    }
  });

  test("rejects run export that is not a callable bundle shape", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `${minimalDescriptor}export const run = { x: 1 };
`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("run");
    }
  });

  test("rejects missing run export", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `${minimalDescriptor}export const x = 1;\n`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("run");
    }
  });

  test("rejects missing descriptor export", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `export const run = async function* (input) {
  return { returnCode: 0, summary: input.prompt };
};
`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("descriptor");
    }
  });

  test("rejects non-builtin imports", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `${minimalDescriptor}import x from "some-package";
export const run = async function* (input) { return { returnCode: 0, summary: input.prompt }; }
`,
    });
    expect(r.ok).toBe(false);
  });

  test("rejects dynamic import", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `${minimalDescriptor}export const run = async function* (input) { await import("fs"); return { returnCode: 0, summary: input.prompt }; }
`,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("dynamic import");
    }
  });

  test("rejects require()", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: `${minimalDescriptor}export const run = async function* (input) { require("fs"); return { returnCode: 0, summary: input.prompt }; }
`,
    });
    expect(r.ok).toBe(false);
  });
});
