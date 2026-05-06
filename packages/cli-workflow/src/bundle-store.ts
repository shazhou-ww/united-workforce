import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { err, ok, type Result } from "@uncaged/workflow";

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

export type BundleFileSource = { kind: "text"; text: string } | { kind: "path"; path: string };

export type WorkflowBundleStoreInput = {
  esmJs: BundleFileSource;
  yaml: BundleFileSource;
  dts: BundleFileSource | null;
};

async function resolveSourceText(src: BundleFileSource): Promise<Result<string, string>> {
  if (src.kind === "text") {
    return ok(src.text);
  }
  try {
    return ok(await readFile(src.path, "utf8"));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to read bundle artifact: ${message}`);
  }
}

async function ensureMatchingOrWrite(
  destPath: string,
  text: string,
  label: string,
): Promise<Result<void, string>> {
  if (!(await pathExists(destPath))) {
    try {
      await writeFile(destPath, text, "utf8");
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return err(`failed to write ${label}: ${message}`);
    }
    return ok(undefined);
  }

  let existing: string;
  try {
    existing = await readFile(destPath, "utf8");
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to read existing ${label}: ${message}`);
  }
  if (existing !== text) {
    return err(
      `${label} for this hash already exists with different contents; refusing to overwrite`,
    );
  }
  return ok(undefined);
}

/** Store `.esm.js`, `.yaml`, and optional `.d.ts` under `bundles/` keyed by hash. */
export async function storeWorkflowBundleArtifacts(
  storageRoot: string,
  hash: string,
  input: WorkflowBundleStoreInput,
): Promise<Result<void, string>> {
  const bundlesDir = join(storageRoot, "bundles");
  try {
    await mkdir(bundlesDir, { recursive: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to store bundle: ${message}`);
  }

  const esmText = await resolveSourceText(input.esmJs);
  if (!esmText.ok) {
    return esmText;
  }
  const yamlText = await resolveSourceText(input.yaml);
  if (!yamlText.ok) {
    return yamlText;
  }

  let dtsText: string | null = null;
  if (input.dts !== null) {
    const dtsResolved = await resolveSourceText(input.dts);
    if (!dtsResolved.ok) {
      return dtsResolved;
    }
    dtsText = dtsResolved.value;
  }

  const destEsm = join(bundlesDir, `${hash}.esm.js`);
  const destYaml = join(bundlesDir, `${hash}.yaml`);
  const destDts = join(bundlesDir, `${hash}.d.ts`);

  const w1 = await ensureMatchingOrWrite(destEsm, esmText.value, "bundle");
  if (!w1.ok) {
    return w1;
  }
  const w2 = await ensureMatchingOrWrite(destYaml, yamlText.value, "descriptor");
  if (!w2.ok) {
    return w2;
  }

  if (dtsText !== null) {
    const w3 = await ensureMatchingOrWrite(destDts, dtsText, "types");
    if (!w3.ok) {
      return w3;
    }
  }

  return ok(undefined);
}
