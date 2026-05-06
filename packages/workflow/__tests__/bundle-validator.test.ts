import { describe, expect, test } from "bun:test";

import { validateWorkflowBundle } from "../src/bundle-validator.js";

describe("validateWorkflowBundle", () => {
  test("accepts export { local as default } when local is a call expression result", () => {
    const source = `var wf = createFn({});
export { wf as default };
`;
    const r = validateWorkflowBundle({ filePath: "/tmp/w.esm.js", source });
    expect(r.ok).toBe(true);
  });

  test("accepts minimal valid builtin-only bundle", () => {
    const source = `import fs from "node:fs";

export default async function* (input) {
  fs.existsSync(".");
  return { returnCode: 0, summary: input.prompt };
}
`;
    const r = validateWorkflowBundle({ filePath: "/tmp/w.esm.js", source });
    expect(r.ok).toBe(true);
  });

  test("rejects wrong filename suffix", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.js",
      source:
        "export default async function* (input) { return { returnCode: 0, summary: input.prompt }; }\n",
    });
    expect(r.ok).toBe(false);
  });

  test("rejects default export that is not a callable bundle shape", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source: 'export default { name: "x", roles: {}, moderator() { return "__end__"; } };\n',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("default export must be a function");
    }
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
        'import x from "some-package";\nexport default async function* (input) { return { returnCode: 0, summary: input.prompt }; }\n',
    });
    expect(r.ok).toBe(false);
  });

  test("rejects dynamic import", () => {
    const r = validateWorkflowBundle({
      filePath: "/tmp/w.esm.js",
      source:
        'export default async function* (input) { await import("fs"); return { returnCode: 0, summary: input.prompt }; }\n',
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
        'export default async function* (input) { require("fs"); return { returnCode: 0, summary: input.prompt }; }\n',
    });
    expect(r.ok).toBe(false);
  });
});
