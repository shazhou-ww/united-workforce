import { execFileSync } from "node:child_process";

import { createLogger } from "@united-workforce/util";

import type { ExecuteInput, ExecuteResult } from "./types.js";

const log = createLogger({ sink: { kind: "stderr" } });

const LOG_START = "EX5M2T9V";
const LOG_EXEC = "EX7Q4K2N";

/** Resolve the uwf CLI binary. Override with `UWF_BIN` for testing. */
function uwfBin(): string {
  const override = process.env.UWF_BIN;
  return override !== undefined && override !== "" ? override : "uwf";
}

/** Run a uwf subcommand and return trimmed stdout. */
function runUwf(args: string[], cwd: string): string {
  try {
    return execFileSync(uwfBin(), args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 50 * 1024 * 1024,
      cwd,
    }).trim();
  } catch (e) {
    const err = e as NodeJS.ErrnoException & { stderr?: Buffer | string | null };
    const stderr =
      err.stderr == null
        ? ""
        : typeof err.stderr === "string"
          ? err.stderr
          : err.stderr.toString("utf8");
    const detail = stderr.trim() !== "" ? `: ${stderr.trim()}` : "";
    // Find the subcommand group + subcommand by skipping leading global flags
    // (e.g. `--format raw-json`). The first non-flag token is the group.
    const groupIdx = args.findIndex((a) => !a.startsWith("--"));
    const group = groupIdx >= 0 ? (args[groupIdx] ?? "") : "";
    const subcmd = groupIdx >= 0 ? (args[groupIdx + 1] ?? "") : "";
    throw new Error(`uwf ${group} ${subcmd} failed${detail}`);
  }
}

/** Parse the thread ID from `uwf thread start --format raw-json` output (`{ threadId, workflowHash }`). */
function parseThreadId(stdout: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`uwf thread start did not emit valid JSON: ${stdout || "(empty)"}`);
  }
  const obj = parsed as Record<string, unknown>;
  const threadId = obj.threadId;
  if (typeof threadId !== "string" || threadId === "") {
    throw new Error(`uwf thread start output missing threadId: ${stdout}`);
  }
  return threadId;
}

/**
 * Execute a workflow: create a thread, then run it for up to `maxSteps` steps.
 * Shells out to the uwf CLI rather than importing it directly.
 *
 * Both `thread start` and `thread exec` are invoked with `--format raw-json`
 * so the legacy bare-value JSON shape is emitted (the 0.6 default is text).
 * See `specs/cli-ocas-envelope-in-repo-consumer-migration.md`.
 */
export async function execute(input: ExecuteInput): Promise<ExecuteResult> {
  const startOut = runUwf(
    [
      "--format",
      "raw-json",
      "thread",
      "start",
      input.workflow,
      "-p",
      input.prompt,
      "--cwd",
      input.workDir,
    ],
    input.workDir,
  );
  const threadId = parseThreadId(startOut);
  log(LOG_START, `thread started thread=${threadId} workflow=${input.workflow}`);

  runUwf(
    [
      "--format",
      "raw-json",
      "thread",
      "exec",
      threadId,
      "--agent",
      input.agent,
      "-c",
      String(input.maxSteps),
    ],
    input.workDir,
  );
  log(LOG_EXEC, `thread executed thread=${threadId} maxSteps=${input.maxSteps}`);

  return { threadId };
}

/** Best-effort lookup of the uwf engine version (`uwf -V`); "unknown" on failure. */
export function getEngineVersion(): string {
  try {
    return execFileSync(uwfBin(), ["-V"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}
