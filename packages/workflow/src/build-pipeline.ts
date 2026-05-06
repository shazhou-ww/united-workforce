import { access, constants } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { validateWorkflowBundle } from "./bundle-validator.js";
import { stringifyWorkflowDescriptor } from "./generate-descriptor.js";
import { generateWorkflowBundleTypes } from "./generate-types.js";
import { err, ok, type Result } from "./result.js";
import {
  validateWorkflowDescriptor,
  type WorkflowDescriptor,
} from "./workflow-descriptor.js";

export type BuildPipelineResult = {
  esmJsSource: string;
  yamlSource: string;
  dtsSource: string;
};

async function findPackageRoot(startDir: string): Promise<string> {
  let dir = startDir;
  for (;;) {
    try {
      await access(join(dir, "package.json"), constants.R_OK);
      return dir;
    } catch {
      const parent = dirname(dir);
      if (parent === dir) {
        return startDir;
      }
      dir = parent;
    }
  }
}

async function loadDescriptorFromSourceTs(absoluteTsPath: string): Promise<
  Result<WorkflowDescriptor, string>
> {
  let mod: Record<string, unknown>;
  try {
    const href = pathToFileURL(absoluteTsPath).href;
    // Dynamic import required: user workflow source path resolved at add/build time
    mod = (await import(href)) as Record<string, unknown>;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to import workflow source for descriptor: ${message}`);
  }

  const raw = mod.descriptor;
  return validateWorkflowDescriptor(raw);
}

/**
 * Bundle a `.ts` workflow entry with Bun, read `export const descriptor`, and emit
 * companion YAML + `.d.ts` text alongside validated ESM bundle source.
 */
export async function buildWorkflowFromTypeScript(
  absoluteTsPath: string,
): Promise<Result<BuildPipelineResult, string>> {
  let rootDir: string;
  try {
    rootDir = await findPackageRoot(dirname(absoluteTsPath));
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to resolve package root: ${message}`);
  }

  let buildResult: Awaited<ReturnType<typeof Bun.build>>;
  try {
    buildResult = await Bun.build({
      entrypoints: [absoluteTsPath],
      target: "node",
      format: "esm",
      external: ["node:*"],
      root: rootDir,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`Bun.build failed: ${message}`);
  }

  if (!buildResult.success) {
    const logs = buildResult.logs.map((l) => l.message).join("; ");
    return err(`Bun.build failed: ${logs || "unknown error"}`);
  }

  const entry = buildResult.outputs.find((o) => o.kind === "entry-point");
  if (entry === undefined) {
    return err("Bun.build produced no entry-point output");
  }

  let esmJsSource: string;
  try {
    esmJsSource = await entry.text();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(`failed to read bundle output: ${message}`);
  }

  const descriptorLoaded = await loadDescriptorFromSourceTs(absoluteTsPath);
  if (!descriptorLoaded.ok) {
    return descriptorLoaded;
  }
  const descriptor = descriptorLoaded.value;

  const validated = validateWorkflowBundle({
    filePath: joinVirtualEsmPath(absoluteTsPath),
    source: esmJsSource,
  });
  if (!validated.ok) {
    return validated;
  }

  const yamlSource = stringifyWorkflowDescriptor(descriptor);
  const dtsSource = generateWorkflowBundleTypes(descriptor);

  return ok({ esmJsSource, yamlSource, dtsSource });
}

function joinVirtualEsmPath(absoluteTsPath: string): string {
  return `${absoluteTsPath}.esm.js`;
}
