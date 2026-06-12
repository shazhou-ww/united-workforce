/**
 * Vitest globalSetup — passive safety net for env var leaks.
 *
 * Captures OCAS_HOME and UWF_HOME at suite start, compares on teardown.
 * Warns (does not fail) if any test file mutated them without restoring.
 */

const ENV_KEYS = ["OCAS_HOME", "UWF_HOME"] as const;

type Snapshot = Record<string, string | undefined>;

let snapshot: Snapshot;

export function setup(): void {
  snapshot = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }
}

export function teardown(): void {
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
