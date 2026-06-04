import type { Command } from "commander";

export function registerDiffCommand(program: Command): void {
  program
    .command("diff <hash1> <hash2>")
    .description("Compare two eval runs side-by-side")
    .action(async (_hash1: string, _hash2: string) => {
      process.stderr.write("uwf-eval diff: not yet implemented\n");
      process.exitCode = 1;
    });
}
