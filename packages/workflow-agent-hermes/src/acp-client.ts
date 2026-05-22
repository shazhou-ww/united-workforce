import type { ChildProcess } from "node:child_process";
import { spawn } from "node:child_process";
import { Readable, Writable } from "node:stream";
import type {
  Client,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionNotification,
} from "@agentclientprotocol/sdk";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from "@agentclientprotocol/sdk";

import type { HermesSessionMessage } from "./types.js";

const HERMES_COMMAND = "hermes";

/** Tracks in-flight tool calls so we can build complete messages when they finish. */
type PendingToolCall = {
  name: string;
  args: string;
};

/**
 * Collects ACP session/update events into a list of {@link HermesSessionMessage}
 * that mirrors what Hermes writes to its session JSONL files.
 */
class UwfAcpClient implements Client {
  private messageChunks: string[] = [];
  private reasoningChunks: string[] = [];
  private pendingTools = new Map<string, PendingToolCall>();
  messages: HermesSessionMessage[] = [];

  resetPerPrompt(): void {
    this.messageChunks = [];
    this.reasoningChunks = [];
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const { update } = params;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (update.content.type === "text") {
          this.messageChunks.push(update.content.text);
        }
        break;

      case "agent_thought_chunk":
        if (update.content.type === "text") {
          this.reasoningChunks.push(update.content.text);
        }
        break;

      case "tool_call": {
        // Agent is invoking a tool — record the call.
        const title = update.title ?? "";
        const rawInput =
          update.rawInput !== undefined && update.rawInput !== null
            ? JSON.stringify(update.rawInput)
            : "";
        this.pendingTools.set(update.toolCallId, { name: title, args: rawInput });

        // Flush accumulated assistant text + reasoning as an assistant message
        // (the agent "spoke" before calling the tool).
        this.flushAssistantMessage();
        break;
      }

      case "tool_call_update": {
        if (update.status === "completed" || update.status === "failed") {
          const pending = this.pendingTools.get(update.toolCallId);
          const toolName = pending?.name ?? update.toolCallId;
          const rawOutput =
            update.rawOutput !== undefined && update.rawOutput !== null
              ? typeof update.rawOutput === "string"
                ? update.rawOutput
                : JSON.stringify(update.rawOutput)
              : "";
          this.messages.push({
            role: "assistant",
            content: null,
            reasoning: null,
            tool_calls: [{ function: { name: toolName, arguments: pending?.args ?? "" } }],
          });
          this.messages.push({
            role: "tool",
            content: rawOutput,
            reasoning: null,
            tool_calls: null,
          });
          this.pendingTools.delete(update.toolCallId);
        }
        break;
      }

      default:
        break;
    }
  }

  /** Flush any accumulated text/reasoning into an assistant message. */
  flushAssistantMessage(): void {
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

  async requestPermission(params: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const firstOption = params.options[0];
    return {
      outcome: {
        outcome: "selected",
        optionId: firstOption?.optionId ?? "",
      },
    };
  }
}

export type AcpPromptResult = {
  text: string;
  sessionId: string;
  messages: HermesSessionMessage[];
};

export class HermesAcpClient {
  private process: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private sessionId: string | null = null;
  private stderrBuffer = "";
  private client = new UwfAcpClient();

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

    if (child.stdin === null || child.stdout === null) {
      throw new Error("hermes acp process stdio is not available");
    }

    const input = Writable.toWeb(child.stdin);
    const output = Readable.toWeb(child.stdout);
    const stream = ndJsonStream(input, output);

    const clientRef = this.client;
    const connection = new ClientSideConnection((_agent) => clientRef, stream);
    this.connection = connection;

    connection.signal.addEventListener("abort", () => {
      if (this.sessionId !== null) {
        const detail = this.stderrBuffer.trim() !== "" ? ` stderr=${this.stderrBuffer.trim()}` : "";
        throw new Error(`hermes acp connection closed unexpectedly${detail}`);
      }
    });

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    });

    const sessionResult = await connection.newSession({ cwd, mcpServers: [] });
    const { sessionId } = sessionResult;

    this.sessionId = sessionId;
    return sessionId;
  }

  /** Send prompt and collect full response text + structured messages. */
  async prompt(text: string): Promise<AcpPromptResult> {
    if (this.connection === null || this.sessionId === null) {
      throw new Error("Not connected — call connect() first");
    }

    this.client.resetPerPrompt();

    await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });

    // Flush any trailing assistant text that wasn't followed by a tool call.
    this.client.flushAssistantMessage();

    // Extract the final assistant text from collected messages.
    const messages = this.client.messages;
    let finalText = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg !== undefined && msg.role === "assistant" && msg.content !== null && msg.content.trim() !== "") {
        finalText = msg.content;
        break;
      }
    }

    return {
      text: finalText,
      sessionId: this.sessionId,
      messages,
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
    this.connection = null;
  }
}
