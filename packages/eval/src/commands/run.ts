import type { Command } from "commander";

export function registerRunCommand(program: Command): void {
  program
    .command("run <task>")
    .description("Run eval on a task directory or tarball")
    .option("--agent <name>", "agent adapter to use", "hermes")
    .option("--model <model>", "model override")
    .option("--count <n>", "number of eval runs", "1")
    .action(async (_task: string, _opts: Record<string, unknown>) => {
      process.stderr.write("uwf-eval run: not yet implemented\n");
      process.exitCode = 1;
    });
}
