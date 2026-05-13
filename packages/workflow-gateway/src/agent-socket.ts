/** One Durable Object instance per agent name; holds the reverse WebSocket from the agent CLI. */
import { DurableObject } from "cloudflare:workers";

import { parseWsRequestJson, parseWsResponseJson, type WsResponse } from "./ws-protocol.js";

type AgentSocketEnv = {
  GATEWAY_SECRET: string;
};

export const AGENT_SOCKET_INTERNAL_STATUS_PATH = "/internal/agent-socket/status";
export const AGENT_SOCKET_INTERNAL_PROXY_PATH = "/internal/agent-socket/proxy";

const PROXY_TIMEOUT_MS = 30_000;

type PendingEntry = {
  resolve: (r: Response) => void;
  timer: ReturnType<typeof setTimeout>;
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function wsResponseToHttp(wr: WsResponse): Response {
  const headers = new Headers();
  for (const [k, v] of Object.entries(wr.headers)) {
    headers.set(k, v);
  }
  return new Response(wr.body, { status: wr.status, headers });
}

export class AgentSocket extends DurableObject<AgentSocketEnv> {
  private readonly pending = new Map<string, PendingEntry>();

  private requireAuth(request: Request): Response | null {
    const auth = request.headers.get("Authorization");
    if (auth !== `Bearer ${this.env.GATEWAY_SECRET}`) {
      return jsonResponse(401, { error: "unauthorized" });
    }
    return null;
  }

  private handleStatusGet(request: Request): Response {
    const denied = this.requireAuth(request);
    if (denied !== null) {
      return denied;
    }
    const sockets = this.ctx.getWebSockets();
    const connected = sockets.length > 0;
    return new Response(JSON.stringify({ connected, connectedCount: sockets.length }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  private async handleProxyPost(request: Request): Promise<Response> {
    const denied = this.requireAuth(request);
    if (denied !== null) {
      return denied;
    }
    const raw = await request.text();
    const wsRequest = parseWsRequestJson(raw);
    if (wsRequest === null) {
      return jsonResponse(400, { error: "invalid proxy body" });
    }

    const sockets = this.ctx.getWebSockets();
    const ws = sockets[0];
    if (ws === undefined) {
      return jsonResponse(503, { error: "no active websocket" });
    }

    return await new Promise<Response>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(wsRequest.id);
        resolve(jsonResponse(504, { error: "gateway timeout" }));
      }, PROXY_TIMEOUT_MS);

      this.pending.set(wsRequest.id, {
        resolve: (r: Response) => {
          clearTimeout(timer);
          this.pending.delete(wsRequest.id);
          resolve(r);
        },
        timer,
      });

      try {
        ws.send(JSON.stringify(wsRequest));
      } catch {
        clearTimeout(timer);
        this.pending.delete(wsRequest.id);
        resolve(jsonResponse(502, { error: "websocket send failed" }));
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === AGENT_SOCKET_INTERNAL_STATUS_PATH && request.method === "GET") {
      return this.handleStatusGet(request);
    }

    if (url.pathname === AGENT_SOCKET_INTERNAL_PROXY_PATH && request.method === "POST") {
      return this.handleProxyPost(request);
    }

    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("expected WebSocket upgrade", { status: 426 });
    }

    for (const ws of this.ctx.getWebSockets()) {
      ws.close(1000, "replaced by new connection");
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const text = typeof message === "string" ? message : new TextDecoder().decode(message);
    const wr = parseWsResponseJson(text);
    if (wr === null) {
      return;
    }
    const entry = this.pending.get(wr.id);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(wr.id);
    entry.resolve(wsResponseToHttp(wr));
  }

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    this.rejectAllPending("agent websocket closed");
  }

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    this.rejectAllPending("agent websocket error");
  }

  private rejectAllPending(message: string): void {
    const entries = [...this.pending.values()];
    this.pending.clear();
    for (const entry of entries) {
      clearTimeout(entry.timer);
      entry.resolve(jsonResponse(502, { error: message }));
    }
  }
}
