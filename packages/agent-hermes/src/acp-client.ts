import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

const HERMES_COMMAND = "hermes";
const PROTOCOL_VERSION = 1;

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
};

type PendingRequest = {
  resolve: (value: JsonRpcResponse) => void;
  reject: (reason: Error) => void;
};

/** Token usage returned by ACP PromptResponse. */
export type AcpUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type AcpPromptResult = {
  text: string;
  sessionId: string;
  usage: AcpUsage | null;
};

export class HermesAcpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private sessionId: string | null = null;
  private stderrBuffer = "";
  private pending = new Map<number, PendingRequest>();

  /** Accumulated assistant text chunks from agent_message_chunk updates. */
  private messageChunks: string[] = [];

  /** Spawn hermes acp, initialize, create session */
  async connect(cwd: string): Promise<string> {
    await this.ensureProcess();
    await this.initialize();

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

  /** Spawn hermes acp, initialize, resume an existing session */
  async resume(sessionId: string, cwd: string): Promise<string> {
    await this.ensureProcess();
    await this.initialize();

    const response = await this.sendRequest("session/resume", {
      cwd,
      sessionId,
      mcpServers: [],
    });

    if ((response as { error?: unknown }).error !== undefined) {
      throw new Error(
        `session/resume failed: ${JSON.stringify((response as { error: unknown }).error)}`,
      );
    }

    this.sessionId = sessionId;
    return sessionId;
  }

  /** Return the current session ID, or null if not connected. */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Send prompt and collect final assistant text from ACP stream chunks. */
  async prompt(text: string): Promise<AcpPromptResult> {
    if (this.sessionId === null) {
      throw new Error("Not connected — call connect() first");
    }

    this.messageChunks = [];

    const response = await this.sendRequest("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });

    if ((response as { error?: unknown }).error !== undefined) {
      throw new Error(
        `session/prompt failed: ${JSON.stringify((response as { error: unknown }).error)}`,
      );
    }

    // Extract token usage from ACP PromptResponse.result.usage (camelCase wire format)
    const result = (response as { result?: Record<string, unknown> }).result;
    const rawUsage = result?.usage as Record<string, unknown> | undefined;
    const usage: AcpUsage | null =
      rawUsage !== undefined &&
      typeof rawUsage.inputTokens === "number" &&
      typeof rawUsage.outputTokens === "number" &&
      typeof rawUsage.totalTokens === "number"
        ? {
            inputTokens: rawUsage.inputTokens,
            outputTokens: rawUsage.outputTokens,
            totalTokens: rawUsage.totalTokens,
          }
        : null;

    return {
      text: this.messageChunks.join(""),
      sessionId: this.sessionId,
      usage,
    };
  }

  /** Close the connection */
  async close(): Promise<void> {
    if (this.process === null) {
      return;
    }
    this.sessionId = null;
    this.process.stdin?.end();
    const proc = this.process;
    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
      setTimeout(resolve, 5000);
    });
    this.process = null;
  }

  // ---- JSON-RPC transport ----

  private sendRequest(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = 10 * 60 * 1000,
  ): Promise<JsonRpcResponse> {
    const id = this.nextId++;
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

      this.writeLine(JSON.stringify({ jsonrpc: "2.0", id, method, params }));
    });
  }

  private sendNotification(method: string, params?: Record<string, unknown>): void {
    const message: Record<string, unknown> = { jsonrpc: "2.0", method };
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

    const hasId = "id" in msg && msg.id !== undefined && msg.id !== null;
    const hasMethod = typeof msg.method === "string";

    // JSON-RPC response to one of our requests (has "id" but no "method")
    if (hasId && !hasMethod) {
      const response = msg as unknown as JsonRpcResponse;
      const handler = this.pending.get(response.id);
      if (handler !== undefined) {
        this.pending.delete(response.id);
        handler.resolve(response);
      }
      return;
    }

    // Server-initiated JSON-RPC request: session/request_permission (has "id" + "method")
    if (msg.method === "session/request_permission" && hasId) {
      const params = msg.params as Record<string, unknown> | undefined;
      const options = (params?.options ?? []) as Array<{ optionId?: string }>;
      const firstOptionId = options[0]?.optionId ?? "";
      this.writeLine(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { outcome: { outcome: "selected", optionId: firstOptionId } },
        }),
      );
      return;
    }

    // JSON-RPC notification — session/update (no "id")
    if (msg.method === "session/update") {
      const params = msg.params as Record<string, unknown> | undefined;
      const update = params?.update as Record<string, unknown> | undefined;
      if (update !== undefined) {
        this.handleSessionUpdate(update);
      }
      return;
    }
  }

  private handleSessionUpdate(update: Record<string, unknown>): void {
    if (update.sessionUpdate !== "agent_message_chunk") {
      return;
    }
    const content = update.content as { type?: string; text?: string } | undefined;
    if (content?.type === "text" && typeof content.text === "string") {
      this.messageChunks.push(content.text);
    }
  }

  private rejectAll(err: Error): void {
    for (const handler of this.pending.values()) {
      handler.reject(err);
    }
    this.pending.clear();
  }

  private async ensureProcess(): Promise<void> {
    if (this.process !== null) {
      return;
    }

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
  }

  private async initialize(): Promise<void> {
    const initResponse = await this.sendRequest("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: { name: "uwf", version: "0.1.0" },
      capabilities: {},
    });

    if ((initResponse as { error?: unknown }).error !== undefined) {
      throw new Error(
        `initialize failed: ${JSON.stringify((initResponse as { error: unknown }).error)}`,
      );
    }

    this.sendNotification("initialized");
  }
}
