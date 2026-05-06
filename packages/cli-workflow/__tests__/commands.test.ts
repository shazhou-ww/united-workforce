import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { cmdAdd } from "../src/cmd-add.js";
import { cmdList, formatListLines } from "../src/cmd-list.js";
import { cmdRemove } from "../src/cmd-remove.js";
import { cmdShow } from "../src/cmd-show.js";

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

export default {
  name: "solve-issue",
  roles: {
    noop: async () => {
      fs.existsSync(".");
      return { content: "ok", meta: { done: true } };
    },
  },
  moderator(ctx) {
    if (ctx.steps.length === 0) {
      return "noop";
    }
    return "__end__";
  },
};
`,
      "utf8",
    );

    const added = await cmdAdd(storageRoot, "solve-issue", bundlePath);
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
      'import x from "./local";\nexport default async function run() { return { returnCode: 0, summary: "" }; }\n',
      "utf8",
    );
    const r = await cmdAdd(storageRoot, "solve-issue", bundlePath);
    expect(r.ok).toBe(false);
  });
});
