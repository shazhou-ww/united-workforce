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

const HERMES_COMMAND = "hermes";

class UwfAcpClient implements Client {
  private messageChunks: string[] = [];

  resetChunks(): void {
    this.messageChunks = [];
  }

  collectChunks(): string {
    return this.messageChunks.join("");
  }

  async sessionUpdate(params: SessionNotification): Promise<void> {
    const { update } = params;
    if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
      this.messageChunks.push(update.content.text);
    }
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

  /** Send prompt and collect full response text */
  async prompt(text: string): Promise<{ text: string; sessionId: string }> {
    if (this.connection === null || this.sessionId === null) {
      throw new Error("Not connected — call connect() first");
    }

    this.client.resetChunks();

    await this.connection.prompt({
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    });

    return {
      text: this.client.collectChunks(),
      sessionId: this.sessionId,
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
