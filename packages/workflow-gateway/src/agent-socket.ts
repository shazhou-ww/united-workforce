/** One Durable Object instance per agent name; holds the reverse WebSocket from the agent CLI. */
import { DurableObject } from "cloudflare:workers";

type AgentSocketEnv = {
  GATEWAY_SECRET: string;
};

export const AGENT_SOCKET_INTERNAL_STATUS_PATH = "/internal/agent-socket/status";

export class AgentSocket extends DurableObject<AgentSocketEnv> {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === AGENT_SOCKET_INTERNAL_STATUS_PATH && request.method === "GET") {
      const auth = request.headers.get("Authorization");
      if (auth !== `Bearer ${this.env.GATEWAY_SECRET}`) {
        return new Response(JSON.stringify({ error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }
      const sockets = this.ctx.getWebSockets();
      const connected = sockets.length > 0;
      return new Response(JSON.stringify({ connected, connectedCount: sockets.length }), {
        headers: { "Content-Type": "application/json" },
      });
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

  async webSocketMessage(_ws: WebSocket, _message: string | ArrayBuffer): Promise<void> {}

  async webSocketClose(
    _ws: WebSocket,
    _code: number,
    _reason: string,
    _wasClean: boolean,
  ): Promise<void> {}

  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {}
}
