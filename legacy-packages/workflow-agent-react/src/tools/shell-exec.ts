import { execSync } from "node:child_process";
import type { ToolEntry } from "./types.js";

const MAX_OUTPUT = 10000;

function truncate(text: string): string {
  return text.length > MAX_OUTPUT ? `${text.slice(0, MAX_OUTPUT)}\n...(truncated)` : text;
}

function classifyExecError(err: unknown): string {
  if (
    err &&
    typeof err === "object" &&
    "status" in err &&
    (err as { status: unknown }).status === null
  ) {
    return "Error: command timed out";
  }
  if (err && typeof err === "object" && "stderr" in err) {
    const e = err as { stderr: string; stdout: string; status: number };
    const combined = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    return truncate(combined) || `Error: command exited with status ${e.status}`;
  }
  return `Error: ${err instanceof Error ? err.message : String(err)}`;
}

export const shellExecTool: ToolEntry = {
  definition: {
    type: "function",
    function: {
      name: "shell_exec",
      description: "Execute a shell command and return stdout + stderr.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run" },
          timeout: { type: ["number", "null"], description: "Timeout in seconds (default: 30)" },
        },
        required: ["command"],
      },
    },
  },
  handler: async (args: string): Promise<string> => {
    try {
      const parsed = JSON.parse(args) as { command: string; timeout: number | null };
      const timeoutMs = (parsed.timeout ?? 30) * 1000;
      const output = execSync(parsed.command, {
        encoding: "utf-8",
        timeout: timeoutMs,
        stdio: ["pipe", "pipe", "pipe"],
        maxBuffer: MAX_OUTPUT * 2,
      });
      return truncate(output);
    } catch (err: unknown) {
      return classifyExecError(err);
    }
  },
};
