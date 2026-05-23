import { spawn } from "node:child_process";
import { resolvePath } from "./path.js";
import type { BuiltinTool } from "./types.js";

const COMMAND_TIMEOUT_MS = 60_000;
const MAX_OUTPUT_CHARS = 32_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars)}\n...(truncated)`;
}

function runShell(
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      env: process.env,
      shell: true,
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

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, COMMAND_TIMEOUT_MS);

    child.on("error", (cause) => {
      clearTimeout(timer);
      const message = cause instanceof Error ? cause.message : String(cause);
      reject(new Error(message));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
}

export const runCommandTool: BuiltinTool = {
  name: "run_command",
  description:
    "Run a shell command. Output is truncated to 32KB.",
  parameters: {
    type: "object",
    required: ["command"],
    properties: {
      command: { type: "string", description: "Shell command to execute." },
      cwd: {
        type: "string",
        description: "Optional working directory relative to workspace root.",
      },
    },
    additionalProperties: false,
  },
  execute: async (args, ctx) => {
    if (!isRecord(args) || typeof args.command !== "string") {
      return "Error: command must be a string";
    }
    let workDir = ctx.cwd;
    if (args.cwd !== undefined && args.cwd !== null) {
      if (typeof args.cwd !== "string") {
        return "Error: cwd must be a string";
      }
      workDir = resolvePath(ctx.cwd, args.cwd);
    }
    try {
      const { stdout, stderr, code } = await runShell(args.command, workDir);
      const out = truncate(
        `exit_code: ${code}\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`,
        MAX_OUTPUT_CHARS,
      );
      return out;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      return `Error: ${message}`;
    }
  },
};
