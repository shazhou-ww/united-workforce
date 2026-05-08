import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getGlobalCasDir, getRegisteredWorkflow, readWorkflowRegistry } from "@uncaged/workflow";
import { cmdCasGet } from "../src/commands/cas/get.js";
import { cmdCasList } from "../src/commands/cas/list.js";
import { cmdCasPut } from "../src/commands/cas/put.js";
import { cmdCasRm } from "../src/commands/cas/rm.js";
import { cmdAdd } from "../src/commands/workflow/add.js";
import { cmdHistory } from "../src/commands/workflow/history.js";
import { cmdList, formatListLines } from "../src/commands/workflow/list.js";
import { cmdRemove } from "../src/commands/workflow/rm.js";
import { cmdRollback } from "../src/commands/workflow/rollback.js";
import { cmdShow } from "../src/commands/workflow/show.js";
import { addCliArgs } from "./bundle-fixture.js";

const fixtureDescriptor = `export const descriptor = { description: "fixture", roles: {} };
`;

const wfPutImport = `import { putContentMerkleNode } from "@uncaged/workflow";
`;

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
      `${fixtureDescriptor}${wfPutImport}import fs from "node:fs";

export const run = async function* (input, options) {
  fs.existsSync(".");
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, input.prompt);
  yield { role: "noop", contentHash: h, meta: { done: true }, refs: [h] };
  return { returnCode: 0, summary: "done" };
}
`,
      "utf8",
    );

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
      `${fixtureDescriptor}import x from "./local";
export const run = async function* (input) { return { returnCode: 0, summary: input.prompt }; }
`,
      "utf8",
    );
    const r = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(r.ok).toBe(false);
  });

  test("add rejects .ts sources", async () => {
    const tsPath = join(storageRoot, "solo.ts");
    await writeFile(tsPath, "export const x = 1;\n", "utf8");
    const r = await cmdAdd(storageRoot, addCliArgs("solo", tsPath));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("build your .ts file first");
    }
  });

  test("add rejects bundle without descriptor export", async () => {
    const bundlePath = join(storageRoot, "solo.esm.js");
    await writeFile(
      bundlePath,
      `export const run = async function* () {
  yield { role: "x", contentHash: "STUBHASH00000000000000001", meta: {}, refs: [] };
  return { returnCode: 0, summary: "ok" };
}
`,
      "utf8",
    );
    const r = await cmdAdd(storageRoot, addCliArgs("solo", bundlePath));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("descriptor");
    }
  });

  test("add from .esm.js writes yaml from descriptor export", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "hello.esm.js");
    await writeFile(
      bundlePath,
      `export const descriptor = {
  description: "hello world fixture",
  roles: {
    greeter: {
      description: "greet",
      schema: { type: "object", properties: { greeting: { type: "string" } } },
    },
  },
};
${wfPutImport}
export const run = async function* (input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, input.prompt);
  yield { role: "greeter", contentHash: h, meta: { greeting: "hi" }, refs: [h] };
  return { returnCode: 0, summary: "ok" };
};
`,
      "utf8",
    );
    const added = await cmdAdd(storageRoot, addCliArgs("hello", bundlePath));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const { hash } = added.value;
    const bundles = join(storageRoot, "bundles");
    const esm = await readFile(join(bundles, `${hash}.esm.js`), "utf8");
    expect(esm.length).toBeGreaterThan(100);
    const yaml = await readFile(join(bundles, `${hash}.yaml`), "utf8");
    expect(yaml).toContain("hello world fixture");
    expect(yaml).toContain("greeter");

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

  test("add from .esm.js copies optional sidecar .d.ts", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "x");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    await writeFile(
      join(bundleDir, "demo.d.ts"),
      "export type DemoHint = { hint: string };\n",
      "utf8",
    );

    const added = await cmdAdd(storageRoot, addCliArgs("typed-demo", bundlePath));
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const dts = await readFile(join(storageRoot, "bundles", `${added.value.hash}.d.ts`), "utf8");
    expect(dts).toContain("DemoHint");
  });

  test("add from .esm.js with --types uses explicit d.ts path", async () => {
    const bundleDir = join(storageRoot, "w");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "app.esm.js");
    const dtsPath = join(bundleDir, "types.d.ts");
    await writeFile(
      bundlePath,
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "x");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    await writeFile(dtsPath, "export type App = 1;\n", "utf8");

    const added = await cmdAdd(storageRoot, {
      name: "app",
      filePath: bundlePath,
      typesPath: dtsPath,
    });
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    const dtsStored = await readFile(
      join(storageRoot, "bundles", `${added.value.hash}.d.ts`),
      "utf8",
    );
    expect(dtsStored).toContain("App");
  });

  test("add from .esm.js warns when optional .d.ts is missing", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "x");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );

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
    const v1 = `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "v1");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "v1" };
}
`;
    const v2 = `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "v2");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "v2" };
}
`;
    await writeFile(bundlePath, v1, "utf8");
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
    const v1 = `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "v1");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "v1" };
}
`;
    const v2 = `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "v2");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "v2" };
}
`;
    await writeFile(bundlePath, v1, "utf8");
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
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "x");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    const add1 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add1.ok).toBe(true);
    await writeFile(
      bundlePath,
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "y");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
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

  test("cas put/get/list/rm use global cas dir (thread id not required for storage)", async () => {
    const put = await cmdCasPut(storageRoot, "nonexistent-thread-id", "phase doc");
    expect(put.ok).toBe(true);
    if (!put.ok) {
      return;
    }
    const hash = put.value;
    const blobPath = join(getGlobalCasDir(storageRoot), `${hash}.txt`);
    expect(await readFile(blobPath, "utf8")).toBe("phase doc");

    const got = await cmdCasGet(storageRoot, "other-thread", hash);
    expect(got.ok).toBe(true);
    if (!got.ok) {
      return;
    }
    expect(got.value).toBe("phase doc");

    const listed = await cmdCasList(storageRoot, "another-thread");
    expect(listed.ok).toBe(true);
    if (!listed.ok) {
      return;
    }
    expect(listed.value).toContain(hash);

    const removed = await cmdCasRm(storageRoot, "rm-thread", hash);
    expect(removed.ok).toBe(true);

    const missing = await cmdCasGet(storageRoot, "after-rm", hash);
    expect(missing.ok).toBe(false);
  });

  test("rollback rejects missing bundle file for target hash", async () => {
    const bundleDir = join(storageRoot, "src");
    await mkdir(bundleDir, { recursive: true });
    const bundlePath = join(bundleDir, "demo.esm.js");
    await writeFile(
      bundlePath,
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "x");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
  return { returnCode: 0, summary: "x" };
}
`,
      "utf8",
    );
    const add1 = await cmdAdd(storageRoot, addCliArgs("solve-issue", bundlePath));
    expect(add1.ok).toBe(true);
    if (!add1.ok) {
      return;
    }
    const hash1 = add1.value.hash;
    await writeFile(
      bundlePath,
      `${fixtureDescriptor}${wfPutImport}export const run = async function* (_input, options) {
  const cas = options.cas;
  const h = await putContentMerkleNode(cas, "y");
  yield { role: "a", contentHash: h, meta: {}, refs: [h] };
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
