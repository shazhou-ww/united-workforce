import { copyFile, mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { SpawnCliError } from "@uncaged/workflow-util-agent";
import { spawnCli } from "@uncaged/workflow-util-agent";
import type { OfficeAgentConfig } from "./types.js";

type SpawnCliFn = typeof spawnCli;

function throwSpawnError(e: SpawnCliError): never {
  if (e.kind === "non_zero_exit")
    throw new Error(`office-agent failed (exit ${e.exitCode}): ${e.stderr}`);
  if (e.kind === "timeout") throw new Error("office-agent: timed out");
  throw new Error(`office-agent: spawn failed: ${e.message}`);
}

async function assertFileExists(path: string): Promise<void> {
  try {
    await stat(path);
  } catch {
    throw new Error(`office-agent: output file not found: ${path}`);
  }
}

export async function generateDocument(
  config: OfficeAgentConfig,
  threadId: string,
  prompt: string,
  spawnCliFn: SpawnCliFn = spawnCli,
): Promise<{ outputDocx: string; sourceDocx: null }> {
  const outputDir = join(config.outputDir, threadId);
  await mkdir(outputDir, { recursive: true });
  const command = config.command ?? "office-agent";
  const result = await spawnCliFn(command, ["create", prompt, "-o", "output.docx"], {
    cwd: outputDir,
    timeoutMs: config.timeout,
  });
  if (!result.ok) throwSpawnError(result.error);
  const outputDocx = join(outputDir, "output.docx");
  await assertFileExists(outputDocx);
  return { outputDocx, sourceDocx: null };
}

export async function editDocument(
  config: OfficeAgentConfig,
  threadId: string,
  prompt: string,
  inputDocx: string,
  spawnCliFn: SpawnCliFn = spawnCli,
): Promise<{ outputDocx: string; sourceDocx: string }> {
  const outputDir = join(config.outputDir, threadId);
  await mkdir(outputDir, { recursive: true });
  const originalDocx = join(outputDir, "original.docx");
  const modifiedDocx = join(outputDir, "modified.docx");
  await copyFile(inputDocx, originalDocx);
  await copyFile(inputDocx, modifiedDocx);
  const command = config.command ?? "office-agent";
  const result = await spawnCliFn(command, ["edit", "modified.docx", prompt], {
    cwd: outputDir,
    timeoutMs: config.timeout,
  });
  if (!result.ok) throwSpawnError(result.error);
  await assertFileExists(modifiedDocx);
  return { outputDocx: modifiedDocx, sourceDocx: originalDocx };
}
