import { spawnCli } from "@uncaged/workflow-util-agent";

/** Runs `git` with args in `cwd`; throws if git exits non-zero. */
export async function gitExec(cwd: string, args: readonly string[]): Promise<string> {
  const result = await spawnCli("git", [...args], { cwd, timeoutMs: null });
  if (result.ok) {
    return result.value;
  }
  const error = result.error;
  switch (error.kind) {
    case "non_zero_exit":
      throw new Error(
        `git ${args.join(" ")} failed (exit ${error.exitCode}): ${error.stderr.trim() || error.stdout.trim()}`,
      );
    case "timeout":
      throw new Error(`git ${args.join(" ")} timed out`);
    case "spawn_failed":
      throw new Error(`git ${args.join(" ")} spawn failed: ${error.message}`);
  }
}
