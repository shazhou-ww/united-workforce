import { execFileSync } from "node:child_process";

import type { StepEntry, ThreadStepsOutput } from "@united-workforce/protocol";

/** Shell out to `uwf step list` and return the parsed step entries (excludes start entry). */
export function readThreadSteps(threadId: string): StepEntry[] {
  const stdout = execFileSync("uwf", ["step", "list", threadId], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  const parsed = JSON.parse(stdout) as ThreadStepsOutput;
  // steps[0] is the StartEntry; the rest are StepEntry records.
  return parsed.steps.slice(1) as StepEntry[];
}
