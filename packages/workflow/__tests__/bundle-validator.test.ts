import { describe, expect, test } from "bun:test";

import { validateWorkflowBundle } from "../src/bundle-validator.js";

describe("validateWorkflowBundle", () => {
  test("accepts minimal valid builtin-only bundle", () => {
    const source = `import fs from "node:fs";

export default async function run() {
  fs.existsSync(".");
  return { returnCode: 0, summary: "ok" };
}
`;
    const r = validateWorkflowBundle({ filePath: "/tmp/w.esm.js", source });
    expect(r.ok).toBe(true);
  });

  test("rejects wrong filename suffix", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.js",
      source: "export default async function run() { return { returnCode: 0, summary: '' }; }\n",
    });
    expect(r.ok).toBe(false);
  });

  test("rejects missing default export", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: "export const x = 1;\n",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("default export");
    }
  });

  test("rejects non-builtin imports", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source:
        'import x from "some-package";\nexport default async function run() { return { returnCode: 0, summary: "" }; }\n',
    });
    expect(r.ok).toBe(false);
  });

  test("rejects dynamic import", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source:
        'export default async function run() { await import("fs"); return { returnCode: 0, summary: "" }; }\n',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("dynamic import");
    }
  });

  test("rejects require()", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source:
        'export default async function run() { require("fs"); return { returnCode: 0, summary: "" }; }\n',
    });
    expect(r.ok).toBe(false);
  });
});
