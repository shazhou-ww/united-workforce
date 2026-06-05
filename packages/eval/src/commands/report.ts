import { createLogger } from "@united-workforce/util";
import type { Command } from "commander";

import { createEvalStore } from "../storage/index.js";
import { formatReport } from "./format.js";
import { readEvalRun } from "./read.js";

const log = createLogger({ sink: { kind: "stderr" } });
const LOG_REPORT = "R7QP2M4K";

export function registerReportCommand(program: Command): void {
  program
    .command("report <hash>")
    .description("Show eval run results")
    .action(async (hash: string) => {
      try {
        const evalStore = await createEvalStore();
        const payload = readEvalRun(evalStore, hash);
        if (payload === null) {
          process.stderr.write(`eval run not found: ${hash}\n`);
          process.exitCode = 1;
          return;
        }
        log(LOG_REPORT, `report task=${payload.task} hash=${hash}`);
        process.stdout.write(formatReport(payload, hash));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
}
