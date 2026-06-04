import type { Command } from "commander";

export function registerListCommand(program: Command): void {
  program
    .command("list")
    .description("List past eval runs")
    .option("--task <name>", "filter by task name")
    .option("--limit <n>", "max results", "20")
    .action(async (_opts: Record<string, unknown>) => {
      process.stderr.write("uwf-eval list: not yet implemented\n");
      process.exitCode = 1;
    });
}
