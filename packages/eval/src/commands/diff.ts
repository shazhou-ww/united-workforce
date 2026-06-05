import { createLogger } from "@united-workforce/util";
import type { Command } from "commander";

import { createEvalStore } from "../storage/index.js";
import { formatDiff } from "./format.js";
import { readEvalRun } from "./read.js";

const log = createLogger({ sink: { kind: "stderr" } });
const LOG_DIFF = "D3WZ8N5T";

export function registerDiffCommand(program: Command): void {
  program
    .command("diff <hash1> <hash2>")
    .description("Compare two eval runs side-by-side")
    .action(async (hash1: string, hash2: string) => {
      try {
        const evalStore = await createEvalStore();
        const payloadA = readEvalRun(evalStore, hash1);
        if (payloadA === null) {
          process.stderr.write(`eval run not found: ${hash1}\n`);
          process.exitCode = 1;
          return;
        }
        const payloadB = readEvalRun(evalStore, hash2);
        if (payloadB === null) {
          process.stderr.write(`eval run not found: ${hash2}\n`);
          process.exitCode = 1;
          return;
        }
        log(LOG_DIFF, `diff a=${hash1} b=${hash2}`);
        process.stdout.write(formatDiff(payloadA, hash1, payloadB, hash2));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
}
