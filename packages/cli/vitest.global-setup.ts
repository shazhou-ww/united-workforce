/**
 * Vitest globalSetup — passive safety net for env var leaks + tmpdir sweep.
 *
 * 1. Captures OCAS_HOME and UWF_HOME at suite start, compares on teardown.
 *    Warns (does not fail) if any test file mutated them without restoring.
 *
 * 2. On teardown, sweeps /tmp for directories matching known test prefixes
 *    that were created DURING this suite run. This catches tmpdir leaks from
 *    workers that were killed before their afterEach could run (OOM, SIGKILL,
 *    resource contention on 2-core machines).
 */

import { readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ENV_KEYS = ["OCAS_HOME", "UWF_HOME"] as const;

type Snapshot = Record<string, string | undefined>;

let snapshot: Snapshot;
let suiteStartMs: number;

/**
 * Known test tmpdir prefixes. Only directories matching one of these are
 * candidates for cleanup. This whitelist prevents accidental deletion of
 * non-test directories (cursor-agent-logs, node-compile-cache, etc.).
 */
const TEST_PREFIXES = [
  "uwf-",
  "cli-uwf-",
  "cli-e2e-",
  "cli-build-",
  "cli-clear-",
  "broker-",
  "thread-",
  "wf-validate-",
  "concurrency-test-",
  "include-tag-test-",
  "pid-recycling-test-",
  "test-config-",
  "active-turns-",
  "step-turns-",
  "turn-chain-",
];

export function setup(): void {
  snapshot = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
  suiteStartMs = Date.now();
}

export function teardown(): void {
  checkEnvLeaks();
  sweepTestTmpdirs();
}

function checkEnvLeaks(): void {
  for (const key of ENV_KEYS) {
    const before = snapshot[key];
    const after = process.env[key];
    if (before !== after) {
      // biome-ignore lint/suspicious/noConsole: globalSetup diagnostic output
      console.warn(
        `⚠️  ENV LEAK DETECTED: ${key} changed during test suite.\n` +
          `   Before: ${before === undefined ? "(unset)" : before}\n` +
          `   After:  ${after === undefined ? "(unset)" : after}\n` +
          `   A test file set ${key} without restoring it in afterEach.`,
      );
    }
  }
}

function sweepTestTmpdirs(): void {
  const tmp = tmpdir();
  let swept = 0;
  try {
    const entries = readdirSync(tmp);
    for (const entry of entries) {
      if (!TEST_PREFIXES.some((prefix) => entry.startsWith(prefix))) continue;
      swept += sweepEntry(join(tmp, entry));
    }
  } catch {
    // readdir failure is non-fatal — /tmp might have permission issues
  }
  if (swept > 0) {
    // biome-ignore lint/suspicious/noConsole: globalSetup diagnostic output
    console.warn(`🧹 globalSetup sweep: cleaned ${swept} leaked test tmpdir(s)`);
  }
}

function sweepEntry(fullPath: string): number {
  try {
    const stat = statSync(fullPath);
    if (!stat.isDirectory()) return 0;
    if (stat.mtimeMs < suiteStartMs) return 0;
    rmSync(fullPath, { recursive: true, force: true });
    return 1;
  } catch {
    return 0;
  }
}
