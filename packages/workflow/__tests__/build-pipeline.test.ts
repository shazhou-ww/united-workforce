import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildWorkflowFromTypeScript } from "../src/build-pipeline.js";

describe("buildWorkflowFromTypeScript", () => {
  test("produces ESM + YAML + d.ts and the bundle default export runs", async () => {
    const thisFile = fileURLToPath(import.meta.url);
    const entryTs = join(dirname(thisFile), "fixtures/minimal-build-workflow.ts");

    const r = await buildWorkflowFromTypeScript(entryTs);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.esmJsSource.length).toBeGreaterThan(200);
    expect(r.value.yamlSource).toContain("minimal fixture");
    expect(r.value.dtsSource).toContain("r:");
    expect(r.value.dtsSource).toContain("x: string");

    const dir = await mkdtemp(join(tmpdir(), "uncaged-wf-build-"));
    try {
      const out = join(dir, "workflow.esm.js");
      await writeFile(out, r.value.esmJsSource, "utf8");
      const mod = (await import(pathToFileURL(out).href)) as { default: unknown };
      expect(typeof mod.default).toBe("function");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
