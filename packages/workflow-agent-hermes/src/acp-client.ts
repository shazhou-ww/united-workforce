import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";

import type { HermesSessionMessage } from "./types.js";

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

/** Tracks in-flight tool calls so we can build complete messages when they finish. */
type PendingToolCall = {
  name: string;
  args: string;
};

export type AcpPromptResult = {
  text: string;
  sessionId: string;
  messages: HermesSessionMessage[];
};

export class HermesAcpClient {
  private process: ChildProcess | null = null;
  private nextId = 1;
  private sessionId: string | null = null;
  private stderrBuffer = "";
  private pending = new Map<number, PendingRequest>();

  // Message collection state
  private messageChunks: string[] = [];
  private reasoningChunks: string[] = [];
  private pendingTools = new Map<string, PendingToolCall>();
  messages: HermesSessionMessage[] = [];

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

  /** Send prompt and collect full response text + structured messages. */
  async prompt(text: string): Promise<AcpPromptResult> {
    if (this.sessionId === null) {
      throw new Error("Not connected — call connect() first");
    }

    this.messageChunks = [];
    this.reasoningChunks = [];

    const response = await this.sendRequest("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });

    if ((response as { error?: unknown }).error !== undefined) {
      throw new Error(
        `session/prompt failed: ${JSON.stringify((response as { error: unknown }).error)}`,
      );
    }

    // Flush any trailing assistant text that wasn't followed by a tool call.
    this.flushAssistantMessage();

    // Extract the final assistant text from collected messages.
    let finalText = "";
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (
        msg !== undefined &&
        msg.role === "assistant" &&
        msg.content !== null &&
        msg.content.trim() !== ""
      ) {
        finalText = msg.content;
        break;
      }
    }

    return {
      text: finalText,
      sessionId: this.sessionId,
      messages: this.messages,
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

  // ---- Session update → structured messages ----

  private handleSessionUpdate(update: Record<string, unknown>): void {
    switch (update.sessionUpdate as string) {
      case "agent_message_chunk":
        this.handleAgentMessageChunk(update);
        break;
      case "agent_thought_chunk":
        this.handleAgentThoughtChunk(update);
        break;
      case "tool_call":
        this.handleToolCall(update);
        break;
      case "tool_call_update":
        this.handleToolCallUpdate(update);
        break;
      default:
        break;
    }
  }

  private handleAgentMessageChunk(update: Record<string, unknown>): void {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (content?.type === "text" && typeof content.text === "string") {
      this.messageChunks.push(content.text);
    }
  }

  private handleAgentThoughtChunk(update: Record<string, unknown>): void {
    const content = update.content as { type?: string; text?: string } | undefined;
    if (content?.type === "text" && typeof content.text === "string") {
      this.reasoningChunks.push(content.text);
    }
  }

  private handleToolCall(update: Record<string, unknown>): void {
    const title = (update.title as string) ?? "";
    const rawInput = update.rawInput;
    const args = rawInput !== undefined && rawInput !== null ? JSON.stringify(rawInput) : "";
    const toolCallId = update.toolCallId as string;
    this.pendingTools.set(toolCallId, { name: title, args });
    this.flushAssistantMessage();
  }

  private handleToolCallUpdate(update: Record<string, unknown>): void {
    const status = update.status as string | undefined;
    if (status !== "completed" && status !== "failed") return;
    const toolCallId = update.toolCallId as string;
    const pending = this.pendingTools.get(toolCallId);
    const toolName = pending?.name ?? toolCallId;
    const rawOutput = update.rawOutput;
    const outputStr =
      rawOutput !== undefined && rawOutput !== null
        ? typeof rawOutput === "string"
          ? rawOutput
          : JSON.stringify(rawOutput)
        : "";
    this.messages.push({
      role: "assistant",
      content: null,
      reasoning: null,
      tool_calls: [{ function: { name: toolName, arguments: pending?.args ?? "" } }],
    });
    this.messages.push({
      role: "tool",
      content: outputStr,
      reasoning: null,
      tool_calls: null,
    });
    this.pendingTools.delete(toolCallId);
  }

  /** Flush any accumulated text/reasoning into an assistant message. */
  private flushAssistantMessage(): void {
    const text = this.messageChunks.join("");
    const reasoning = this.reasoningChunks.join("");
    if (text !== "" || reasoning !== "") {
      this.messages.push({
        role: "assistant",
        content: text || null,
        reasoning: reasoning || null,
        tool_calls: null,
      });
    }
    this.messageChunks = [];
    this.reasoningChunks = [];
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
