import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Runs `git` with args in `cwd`; throws if git exits non-zero. */
export async function gitExec(cwd: string, args: readonly string[]): Promise<string> {
  try {
    const r = await execFileAsync("git", [...args], {
      cwd,
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
    });
    return r.stdout;
  } catch (e) {
    const stderr =
      typeof e === "object" &&
      e !== null &&
      "stderr" in e &&
      typeof (e as { stderr: unknown }).stderr === "string"
        ? (e as { stderr: string }).stderr
        : "";
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`git ${args.join(" ")} failed: ${msg}${stderr ? ` (${stderr.trim()})` : ""}`);
  }
}
