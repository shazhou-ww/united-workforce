#!/usr/bin/env -S node --disable-warning=ExperimentalWarning

// eslint-disable-next-line -- dynamic import for version
const pkg = await import("../package.json", { with: { type: "json" } });
if (process.argv.includes("--version") || process.argv.includes("-V")) {
  process.stdout.write(`${pkg.default.version}\n`);
  process.exit(0);
}

import { createHermesAgent } from "./hermes.js";
import { isResumeDisabled } from "./session-cache.js";
import { resolveHermesTimeoutMs } from "./timeout.js";

const timeoutResult = resolveHermesTimeoutMs(process.argv.slice(2), process.env);
if (!timeoutResult.ok) {
  process.stderr.write(`${timeoutResult.error}\n`);
  process.exit(1);
}

const resumeDisabled = isResumeDisabled(process.env.UWF_HERMES_RESUME ?? null);
const main = createHermesAgent(resumeDisabled, timeoutResult.value);
void main();
