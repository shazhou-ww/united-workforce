import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { getRegisteredWorkflow, readWorkflowRegistry } from "@uncaged/workflow";
import { cmdAdd } from "../src/cmd-add.js";
import { cmdHistory } from "../src/cmd-history.js";
import { cmdList, formatListLines } from "../src/cmd-list.js";
import { cmdRemove } from "../src/cmd-remove.js";
import { cmdRollback } from "../src/cmd-rollback.js";
import { cmdShow } from "../src/cmd-show.js";
import { addCliArgs, MINIMAL_DESCRIPTOR_YAML } from "./bundle-fixture.js";

describe("cli workflow commands", () => {
  let prevEnv: string | undefined;
  let storageRoot: string;

  beforeEach(async () => {
    prevEnv = process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    storageRoot = await mkdtemp(join(tmpdir(), "uncaged-wf-"));
    process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = storageRoot;
  });

  afterEach(async () => {
    if (prevEnv === undefined) {
      delete process.env.UNCAGED_WORKFLOW_STORAGE_ROOT;
    } else {
      process.env.UNCAGED_WORKFLOW_STORAGE_ROOT = prevEnv;
    }
    await rm(storageRoot, { recursive: true, force: true });
  });

  test("add / list / show / remove roundtrip", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `import fs from "node:fs";

export default async function* (input) {
  fs.existsSync(".");
  yield { role: "noop", content: input.prompt, meta: { done: true } };
  return { returnCode: 0, summary: "done" };
}
`,
      "utf8",
    );
    await writeFile(join(bundleDir, "demo.yaml"), MINIMAL_DESCRIPTOR_YAML, "utf8");

    const added = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(added.ok).toBe(true);

    const listed = await cmdList(storageRoot);
    expect(listed.ok).toBe(true);
    if (listed.ok) {
      const lines = formatListLines(listed.value);
      expect(lines.some((l) => l.startsWith("solve-issue\t"))).toBe(true);
    }

    const shown = await cmdShow(storageRoot, "solve-issue");
    expect(shown.ok).toBe(true);
    if (!shown.ok) {
      return;
    }
    expect(shown.value.hash.length).toBe(13);

    const bundleOnDisk = await readFile(
      join(storageRoot, "bundles", `${shown.value.hash}.esm.js`),
      "utf8",
    );
    expect(bundleOnDisk.length).toBeGreaterThan(0);

    const removed = await cmdRemove(storageRoot, "solve-issue");
    expect(removed.ok).toBe(true);

    const listedAfter = await cmdList(storageRoot);
    expect(listedAfter.ok).toBe(true);
    if (listedAfter.ok) {
      expect(formatListLines(listedAfter.value)[0]).toBe("(no workflows registered)");
    }
  });

  test("add rejects invalid bundles", async () => {
    const bundlePath = join(storageRoot, "bad.esm.js");
    await writeFile(
      bundlePath,
      'import x from "./local";\nexport default async function* (input) { return { returnCode: 0, summary: input.prompt }; }\n',
      "utf8",
    );
    const r = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(r.ok).toBe(false);
  });

  test("add rejects .esm.js without companion YAML", async () => {
    const bundlePath = join(storageRoot, "solo.esm.js");
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "x", content: input.prompt, meta: {} };
  return { returnCode: 0, summary: "ok" };
}
`,
      "utf8",
    );
    const r = await cmdAdd(storageRoot, addCliArgs("solo", bundlePath));
    expect(r.ok).toBe(false);
    if (r.ok) {
      return;
    }
    expect(r.error).toContain("descriptor YAML not found");
  });

  test("add from .ts builds bundle + yaml + d.ts and registers hash", async () => {
    const helloTs = fileURLToPath(new URL("../../../examples/hello-world.ts", import.meta.url));
    const added = await cmdAdd(storageRoot, addCliArgs("hello", helloTs));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const { hash } = added.value;
    const bundles = join(storageRoot, "bundles");
    const esm = await readFile(join(bundles, `${hash}.esm.js`), "utf8");
    expect(esm.length).toBeGreaterThan(100);
    const yaml = await readFile(join(bundles, `${hash}.yaml`), "utf8");
    expect(yaml).toContain("hello world");
    const dts = await readFile(join(bundles, `${hash}.d.ts`), "utf8");
    expect(dts).toContain("export type Roles");
    expect(dts).toContain("WorkflowFn");

    const reg = await readWorkflowRegistry(storageRoot);
    expect(reg.ok).toBe(true);
    if (!reg.ok) {
      return;
    }
    const entry = getRegisteredWorkflow(reg.value, "hello");
    expect(entry).not.toBeNull();
    if (entry === null) {
      return;
    }
    expect(entry.hash).toBe(hash);
  });

  test("add from .esm.js with --descriptor uses explicit YAML path", async () => {
    const bundleDir = join(storageRoot, "w");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "app.esm.js");
    const yamlPath = join(bundleDir, "desc.yaml");
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "a", content: "x", meta: {} };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    await writeFile(yamlPath, MINIMAL_DESCRIPTOR_YAML, "utf8");

    const added = await cmdAdd(storageRoot, {
      name: "app",
      filePath: bundlePath,
      descriptorPath: yamlPath,
      typesPath: null,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const yamlStored = await readFile(
      join(storageRoot, "bundles", `${added.value.hash}.yaml`),
      "utf8",
    );
    expect(yamlStored).toContain("fixture");
  });

  test("add from .esm.js warns when optional .d.ts is missing", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "a", content: "x", meta: {} };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    await writeFile(join(bundleDir, "demo.yaml"), MINIMAL_DESCRIPTOR_YAML, "utf8");

    const added = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(added.value.warnings.length).toBe(1);
    expect(added.value.warnings[0]).toContain("demo.d.ts");
  });

  test("history lists current + prior versions sorted by time descending", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    const v1 = `export default async function* (input) {
  yield { role: "a", content: "v1", meta: {} };
  return { returnCode: 0, summary: "v1" };
}
`;
    const v2 = `export default async function* (input) {
  yield { role: "a", content: "v2", meta: {} };
  return { returnCode: 0, summary: "v2" };
}
`;
    await writeFile(bundlePath, v1, "utf8");
    await writeFile(join(bundleDir, "demo.yaml"), MINIMAL_DESCRIPTOR_YAML, "utf8");
    const add1 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add1.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 15));
    await writeFile(bundlePath, v2, "utf8");
    const add2 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add2.ok).toBe(true);

    const hist = await cmdHistory(storageRoot, "solve-issue");
    expect(hist.ok).toBe(true);
    if (!hist.ok) {
      return;
    }
    expect(hist.value.length).toBe(2);
    const dates = hist.value.map((line) => {
      const parts = line.split("\t");
      return Date.parse(parts[1] ?? "");
    });
    expect(Number.isFinite(dates[0])).toBe(true);
    expect(Number.isFinite(dates[1])).toBe(true);
    expect(dates[0] >= dates[1]).toBe(true);
    expect(hist.value.some((l) => l.endsWith("(current)"))).toBe(true);
  });

  test("rollback swaps registry head with a history hash", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    const v1 = `export default async function* (input) {
  yield { role: "a", content: "v1", meta: {} };
  return { returnCode: 0, summary: "v1" };
}
`;
    const v2 = `export default async function* (input) {
  yield { role: "a", content: "v2", meta: {} };
  return { returnCode: 0, summary: "v2" };
}
`;
    await writeFile(bundlePath, v1, "utf8");
    await writeFile(join(bundleDir, "demo.yaml"), MINIMAL_DESCRIPTOR_YAML, "utf8");
    const add1 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add1.ok).toBe(true);
    if (!add1.ok) {
      return;
    }
    const hash1 = add1.value.hash;
    await writeFile(bundlePath, v2, "utf8");
    const add2 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add2.ok).toBe(true);
    if (!add2.ok) {
      return;
    }
    const hash2 = add2.value.hash;

    const rb = await cmdRollback(storageRoot, "solve-issue", null);
    expect(rb.ok).toBe(true);

    const reg = await readWorkflowRegistry(storageRoot);
    expect(reg.ok).toBe(true);
    if (!reg.ok) {
      return;
    }
    const entry = getRegisteredWorkflow(reg.value, "solve-issue");
    expect(entry).not.toBeNull();
    if (entry === null) {
      return;
    }
    expect(entry.hash).toBe(hash1);
    expect(entry.history.some((h) => h.hash === hash2)).toBe(true);
  });

  test("rollback rejects a hash that is not in history", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "a", content: "x", meta: {} };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    await writeFile(join(bundleDir, "demo.yaml"), MINIMAL_DESCRIPTOR_YAML, "utf8");
    const add1 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add1.ok).toBe(true);
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "a", content: "y", meta: {} };
  return { returnCode: 0, summary: "y" };
}
`,
      "utf8",
    );
    const add2 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add2.ok).toBe(true);

    const bad = await cmdRollback(storageRoot, "solve-issue", "0000000000000");
    expect(bad.ok).toBe(false);
  });

  test("rollback rejects missing bundle file for target hash", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "a", content: "x", meta: {} };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    await writeFile(join(bundleDir, "demo.yaml"), MINIMAL_DESCRIPTOR_YAML, "utf8");
    const add1 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add1.ok).toBe(true);
    if (!add1.ok) {
      return;
    }
    const hash1 = add1.value.hash;
    await writeFile(
      bundlePath,
      `export default async function* (input) {
  yield { role: "a", content: "y", meta: {} };
  return { returnCode: 0, summary: "y" };
}
`,
      "utf8",
    );
    const add2 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add2.ok).toBe(true);
    if (!add2.ok) {
      return;
    }

    await unlink(join(storageRoot, "bundles", `${hash1}.esm.js`));

    const rb = await cmdRollback(storageRoot, "solve-issue", hash1);
    expect(rb.ok).toBe(false);
  });
});
