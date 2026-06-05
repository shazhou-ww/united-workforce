import { access, cp, mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLogger } from "@united-workforce/util";

import { loadTaskManifest } from "../task/index.js";
import type { PrepareResult } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const LOG_PREPARE = "PRE4K2NQ";
const LOG_FIXTURE = "PRE7M3VX";

/** Check whether a path exists. */
async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Prepare a task for execution: read its manifest and copy the fixture
 * directory into a fresh temp working directory.
 */
export async function prepare(taskDir: string): Promise<PrepareResult> {
  const manifest = await loadTaskManifest(taskDir);
  log(LOG_PREPARE, `loaded task manifest name=${manifest.name} workflow=${manifest.workflow}`);

  const workDir = await mkdtemp(join(tmpdir(), "uwf-eval-"));

  const fixtureDir = join(taskDir, "fixture");
  if (await pathExists(fixtureDir)) {
    await cp(fixtureDir, workDir, { recursive: true });
    log(LOG_FIXTURE, `copied fixture into workDir=${workDir}`);
  } else {
    await mkdir(workDir, { recursive: true });
    log(LOG_FIXTURE, `no fixture/ found, using empty workDir=${workDir}`);
  }

  return { taskDir, workDir, manifest };
}
