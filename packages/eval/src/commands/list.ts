import { createLogger } from "@united-workforce/util";
import type { Command } from "commander";

import { createEvalStore } from "../storage/index.js";
import { formatList, selectEntries } from "./format.js";
import { readEvalEntries } from "./read.js";

const log = createLogger({ sink: { kind: "stderr" } });
const LOG_LIST = "H5KX9R2B";

type ListCliOptions = {
  task: string | undefined;
  limit: string;
};

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List past eval runs")
    .option("--task <name>", "filter by task name")
    .option("--limit <n>", "max results", "20")
    .action(async (opts: ListCliOptions) => {
      const limit = Number.parseInt(opts.limit, 10);
      if (!Number.isInteger(limit) || limit < 1) {
        process.stderr.write("--limit must be a positive integer\n");
        process.exitCode = 1;
        return;
      }

      try {
        const evalStore = await createEvalStore();
        const entries = readEvalEntries(evalStore);
        const task = opts.task ?? null;
        const selected = selectEntries(entries, task, limit);
        log(LOG_LIST, `list task=${task ?? "*"} found=${entries.length} shown=${selected.length}`);
        process.stdout.write(formatList(selected));
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        process.stderr.write(`${message}\n`);
        process.exitCode = 1;
      }
    });
}
