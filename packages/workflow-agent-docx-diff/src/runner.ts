import { stat } from "node:fs/promises";
import { spawnCli } from "@uncaged/workflow-util-agent";
import type { SpawnCliError } from "@uncaged/workflow-util-agent";
import type { DocxDiffAgentConfig } from "./types.js";

type SpawnCliFn = typeof spawnCli;

function throwSpawnError(e: SpawnCliError): never {
  if (e.kind === "non_zero_exit")
    throw new Error(`docx-diff failed (exit ${e.exitCode}): ${e.stderr}`);
  if (e.kind === "timeout")
    throw new Error("docx-diff: timed out");
  throw new Error(`docx-diff: spawn failed: ${e.message}`);
}

export async function runDocxDiff(
  config: DocxDiffAgentConfig,
  sourceDocx: string,
  modifiedDocx: string,
  diffDocx: string,
  spawnCliFn: SpawnCliFn = spawnCli,
): Promise<string> {
  const command = config.command ?? "docx-diff";
  const result = await spawnCliFn(
    command,
    [sourceDocx, modifiedDocx, "--output", "docx", "--out-file", diffDocx],
    { cwd: null, timeoutMs: null },
  );

  if (!result.ok) {
    const e = result.error;
    // exit 1 = changes found (normal for docx-diff)
    if (e.kind === "non_zero_exit" && e.exitCode === 1) {
      // fall through to file check
    } else {
      throwSpawnError(e);
    }
  }

  try {
    await stat(diffDocx);
  } catch {
    throw new Error(`docx-diff: diff file not found: ${diffDocx}`);
  }

  return JSON.stringify({ sourceDocx, modifiedDocx, diffDocx });
}
