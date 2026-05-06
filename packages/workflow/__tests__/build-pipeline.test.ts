import { describe, expect, test } from "bun:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildWorkflowFromTypeScript } from "../src/build-pipeline.js";

describe("buildWorkflowFromTypeScript", () => {
  test("produces valid ESM bundle text, YAML, and d.ts from hello-world.ts", async () => {
    const helloTs = fileURLToPath(new URL("../../../examples/hello-world.ts", import.meta.url));
    const r = await buildWorkflowFromTypeScript(helloTs);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }
    expect(r.value.esmJsSource.length).toBeGreaterThan(500);
    expect(r.value.yamlSource).toContain("hello world");
    expect(r.value.dtsSource).toContain("greeter");
    expect(r.value.dtsSource).toContain("greeting: string");
  });

  test("built bundle default export is executable", async () => {
    const helloTs = fileURLToPath(new URL("../../../examples/hello-world.ts", import.meta.url));
    const r = await buildWorkflowFromTypeScript(helloTs);
    expect(r.ok).toBe(true);
    if (!r.ok) {
      return;
    }

    const tmp = `/tmp/uncaged-wf-build-test-${Date.now()}.esm.js`;
    await Bun.write(tmp, r.value.esmJsSource);

    const href = pathToFileURL(tmp).href;
    const mod = (await import(href)) as { default: unknown };
    expect(typeof mod.default).toBe("function");
  });
});
