import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const HERMES_COMMAND = "hermes";
const PROMPT_TIMEOUT_MS = 10 * 60 * 1000;

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params: Record<string, unknown>;
};

type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result: unknown;
  error?: { code: number; message: string };
};

type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
};

type SessionUpdateParams = {
  update: {
    sessionUpdate: string;
    content?: {
      text?: string;
    };
  };
};

function isSessionUpdateParams(params: unknown): params is SessionUpdateParams {
  return (
    typeof params === "object" &&
    params !== null &&
    "update" in params &&
    typeof (params as Record<string, unknown>).update === "object"
  );
}

export class HermesAcpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private sessionId: string | null = null;
  private pending = new Map<number, PendingRequest>();
  private stderrBuffer = "";
  private messageChunks: string[] = [];

  /** Spawn hermes acp, initialize, create session */
  async connect(cwd: string): Promise<string> {
    const child = spawn(HERMES_COMMAND, ["acp"], {
      env: process.env,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this.process = child;

    child.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBuffer += chunk.toString();
    });

    child.on("error", (cause) => {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.rejectAll(new Error(`hermes acp spawn failed: ${message}`));
    });

    child.on("close", (code) => {
      if (code !== 0 && this.pending.size > 0) {
        const detail = this.stderrBuffer.trim() !== "" ? ` stderr=${this.stderrBuffer.trim()}` : "";
        this.rejectAll(
          new Error(`hermes acp exited unexpectedly with code ${code ?? "null"}${detail}`),
        );
      }
    });

    if (child.stdout === null) {
      throw new Error("hermes acp process stdout is not available");
    }
    const rl = createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      this.handleLine(line.trim());
    });

    const initResponse = await this.sendRequest("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "uwf", version: "0.1.0" },
      capabilities: {},
    });

    if ((initResponse as { error?: unknown }).error !== undefined) {
      throw new Error(
        `initialize failed: ${JSON.stringify((initResponse as { error: unknown }).error)}`,
      );
    }

    this.sendNotification("initialized");

    const sessionResponse = (await this.sendRequest("session/new", {
      cwd,
      mcpServers: [],
    })) as { result: { sessionId: string } };

    const sessionId = sessionResponse.result?.sessionId;
    if (typeof sessionId !== "string" || sessionId === "") {
      throw new Error(`session/new did not return a sessionId: ${JSON.stringify(sessionResponse)}`);
    }

    this.sessionId = sessionId;
    return sessionId;
  }

  /** Send prompt and collect full response text */
  async prompt(text: string): Promise<{ text: string; sessionId: string }> {
    if (this.sessionId === null) {
      throw new Error("Not connected — call connect() first");
    }

    this.messageChunks = [];

    const response = await this.sendRequest(
      "session/prompt",
      {
        sessionId: this.sessionId,
        prompt: [{ type: "text", text }],
      },
      PROMPT_TIMEOUT_MS,
    );

    if ((response as { error?: unknown }).error !== undefined) {
      throw new Error(
        `session/prompt failed: ${JSON.stringify((response as { error: unknown }).error)}`,
      );
    }

    return {
      text: this.messageChunks.join(""),
      sessionId: this.sessionId,
    };
  }

  /** Close the connection */
  async close(): Promise<void> {
    if (this.process === null) {
      return;
    }
    this.process.stdin?.end();
    const proc = this.process;
    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
      setTimeout(resolve, 5000);
    });
    this.process = null;
  }

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 30_000,
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
    const message: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
    return new Promise<JsonRpcResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Timeout waiting for response to ${method} (id=${id})`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      this.writeLine(JSON.stringify(message));
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const message: JsonRpcNotification = { jsonrpc: "2.0", method };
    if (params !== undefined) {
      message.params = params;
    }
    this.writeLine(JSON.stringify(message));
  }

  private writeLine(line: string): void {
    if (this.process?.stdin === null || this.process?.stdin === undefined) {
      throw new Error("Cannot write: hermes acp process stdin not available");
    }
    this.process.stdin.write(`${line}\n`);
  }

  private handleLine(line: string): void {
    if (line === "") {
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }

    const msg = parsed as Record<string, unknown>;

    if ("id" in msg && msg.id !== undefined && msg.id !== null) {
      const response = msg as unknown as JsonRpcResponse;
      const handler = this.pending.get(response.id);
      if (handler !== undefined) {
        this.pending.delete(response.id);
        handler.resolve(response);
      }
      return;
    }

    if (msg.method === "session/update" && isSessionUpdateParams(msg.params)) {
      const updateType = msg.params.update.sessionUpdate;
      if (updateType === "agent_message_chunk") {
        const chunk = msg.params.update.content?.text;
        if (typeof chunk === "string") {
          this.messageChunks.push(chunk);
        }
      }
    }
  }

  private rejectAll(err: Error): void {
    for (const handler of this.pending.values()) {
      handler.reject(err);
    }
    this.pending.clear();
  }
}
