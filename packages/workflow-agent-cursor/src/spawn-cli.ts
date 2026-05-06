import { spawn } from "node:child_process";

import { err, ok, type Result } from "@uncaged/workflow";

export type SpawnCliError =
  | { kind: "non_zero_exit"; exitCode: number | null; stdout: string; stderr: string }
  | { kind: "timeout" }
  | { kind: "spawn_failed"; message: string };

export function spawnCli(
  command: string,
  args: string[],
  options: { cwd: string | null; timeoutMs: number | null },
): Promise<Result<string, SpawnCliError>> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd === null ? undefined : options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    if (options.timeoutMs !== null) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, options.timeoutMs);
    }

    child.on("error", (cause) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      const message = cause instanceof Error ? cause.message : String(cause);
      resolve(err({ kind: "spawn_failed", message }));
    });

    child.on("close", (code) => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      if (timedOut) {
        resolve(err({ kind: "timeout" }));
        return;
      }
      if (code === 0) {
        resolve(ok(stdout));
        return;
      }
      resolve(err({ kind: "non_zero_exit", exitCode: code, stdout, stderr }));
    });
  });
}
