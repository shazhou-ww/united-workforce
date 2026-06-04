import type { Command } from "commander";

export function registerReportCommand(program: Command): void {
  program
    .command("report <hash>")
    .description("Show eval run results")
    .action(async (_hash: string) => {
      process.stderr.write("uwf-eval report: not yet implemented\n");
      process.exitCode = 1;
    });
}
