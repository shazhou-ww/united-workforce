import { Hono } from "hono";
import { cors } from "hono/cors";

import {
  AGENT_SOCKET_INTERNAL_PROXY_PATH,
  AGENT_SOCKET_INTERNAL_STATUS_PATH,
  AgentSocket,
} from "./agent-socket.js";
import type { WsRequest } from "./ws-protocol.js";

export { AgentSocket };

type Env = {
  Bindings: {
    ENDPOINTS: KVNamespace;
    GATEWAY_SECRET: string;
    DASHBOARD_API_KEY: string;
    AGENT_SOCKET: DurableObjectNamespace<AgentSocket>;
  };
};

type EndpointRecord = {
  name: string;
  url: string;
  agentToken: string;
  registeredAt: number;
  lastHeartbeat: number;
};

const TTL_SECONDS = 300; // 5 min — offline if no heartbeat

const app = new Hono<Env>();

app.use("*", cors());

function checkDashboardAuth(c: {
  req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined };
  env: Env["Bindings"];
}): boolean {
  const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
  const query = c.req.query("key");
  const key = bearer ?? query;
  return key === c.env.DASHBOARD_API_KEY;
}

function isLocalAgentUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  } catch {
    return false;
  }
}

function buildForwardHeaders(raw: Headers, agentToken: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of raw) {
    const lower = key.toLowerCase();
    if (lower === "host" || lower === "authorization") {
      continue;
    }
    if (
      lower === "connection" ||
      lower === "keep-alive" ||
      lower === "proxy-connection" ||
      lower === "transfer-encoding" ||
      lower === "upgrade"
    ) {
      continue;
    }
    out[key] = value;
  }
  if (agentToken !== "") {
    out["X-Agent-Token"] = agentToken;
  }
  return out;
}

function buildDashboardProxyHeaders(raw: Headers, token: string): Headers {
  const headers = new Headers(raw);
  headers.delete("host");
  headers.delete("Authorization");
  if (token !== "") {
    headers.set("X-Agent-Token", token);
  }
  return headers;
}

async function readBodyForWsProxy(method: string, req: Request): Promise<string | null> {
  if (method === "GET" || method === "HEAD") {
    return null;
  }
  const buf = await req.arrayBuffer();
  return buf.byteLength === 0 ? null : new TextDecoder().decode(buf);
}

async function fetchThroughAgentSocket(
  bindings: Env["Bindings"],
  agent: string,
  gateSecret: string,
  wsRequest: WsRequest,
): Promise<Response> {
  const stub = bindings.AGENT_SOCKET.get(bindings.AGENT_SOCKET.idFromName(agent));
  return stub.fetch(
    new Request(`https://do.internal${AGENT_SOCKET_INTERNAL_PROXY_PATH}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gateSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(wsRequest),
    }),
  );
}

async function fetchAgentWithRecordHeaders(
  targetUrl: string,
  method: string,
  forwardRecord: Record<string, string>,
  bodyStr: string | null,
): Promise<Response> {
  const headers = new Headers();
  for (const [k, v] of Object.entries(forwardRecord)) {
    headers.set(k, v);
  }
  return fetch(targetUrl, {
    method,
    headers,
    body: method !== "GET" && method !== "HEAD" ? (bodyStr ?? undefined) : undefined,
  });
}

async function fetchAgentWithDashboardHeaders(
  targetUrl: string,
  method: string,
  headers: Headers,
  rawBody: BodyInit | null | undefined,
): Promise<Response> {
  return fetch(targetUrl, {
    method,
    headers,
    body: method !== "GET" && method !== "HEAD" ? rawBody : undefined,
  });
}

async function fetchAgentSocketStatus(
  env: Env["Bindings"],
  name: string,
): Promise<{ ok: true; connected: boolean } | { ok: false }> {
  try {
    const id = env.AGENT_SOCKET.idFromName(name);
    const stub = env.AGENT_SOCKET.get(id);
    const resp = await stub.fetch(
      new Request(`https://do${AGENT_SOCKET_INTERNAL_STATUS_PATH}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${env.GATEWAY_SECRET}` },
      }),
    );
    if (!resp.ok) {
      return { ok: false };
    }
    const body = (await resp.json()) as { connected: boolean };
    return { ok: true, connected: body.connected };
  } catch {
    return { ok: false };
  }
}

function endpointStatusFromKvAndDo(record: EndpointRecord, doConnected: boolean | null): string {
  if (doConnected === true) {
    return "online";
  }
  if (doConnected === false) {
    if (isLocalAgentUrl(record.url)) {
      return "offline";
    }
    const age = Date.now() - record.lastHeartbeat;
    return age < TTL_SECONDS * 1000 ? "online" : "offline";
  }
  const age = Date.now() - record.lastHeartbeat;
  return age < TTL_SECONDS * 1000 ? "online" : "offline";
}

// ── Health ──────────────────────────────────────────────────────────
app.get("/healthz", (c) => c.json({ ok: true }));

// ── Agent reverse WebSocket (GATEWAY_SECRET query param) ────────────
app.get("/ws/connect", async (c) => {
  const secret = c.req.query("secret");
  const name = c.req.query("name");
  if (name === undefined || name === "") {
    return c.json({ error: "name required" }, 400);
  }
  if (secret !== c.env.GATEWAY_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }
  if (c.req.header("Upgrade") !== "websocket") {
    return c.text("expected WebSocket upgrade", 426);
  }
  const id = c.env.AGENT_SOCKET.idFromName(name);
  const stub = c.env.AGENT_SOCKET.get(id);
  return stub.fetch(c.req.raw);
});

// ── Gateway management (GATEWAY_SECRET auth) ────────────────────────
const gateway = new Hono<Env>();

gateway.post("/register", async (c) => {
  const body = await c.req.json<{
    name?: string;
    url?: string;
    secret?: string;
    agentToken?: string;
  }>();
  const { name, url, secret, agentToken } = body;

  if (!name || !url) {
    return c.json({ error: "name and url required" }, 400);
  }
  if (secret !== c.env.GATEWAY_SECRET) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const existing = await c.env.ENDPOINTS.get<EndpointRecord>(name, "json");
  const now = Date.now();

  const record: EndpointRecord = {
    name,
    url: url.replace(/\/+$/, ""), // strip trailing slash
    agentToken: agentToken ?? existing?.agentToken ?? "",
    registeredAt: existing?.registeredAt ?? now,
    lastHeartbeat: now,
  };

  await c.env.ENDPOINTS.put(name, JSON.stringify(record), {
    expirationTtl: TTL_SECONDS,
  });

  const status = existing ? 200 : 201;
  return c.json({ registered: name }, status);
});

gateway.delete("/register/:name", async (c) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${c.env.GATEWAY_SECRET}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const name = c.req.param("name");
  await c.env.ENDPOINTS.delete(name);
  return c.json({ unregistered: name });
});

// endpoints requires dashboard auth
gateway.get("/endpoints", async (c) => {
  if (!checkDashboardAuth(c)) return c.json({ error: "unauthorized" }, 401);

  const list = await c.env.ENDPOINTS.list();
  const endpoints: Array<{ name: string; url: string; status: string; lastHeartbeat: number }> = [];

  for (const key of list.keys) {
    const record = await c.env.ENDPOINTS.get<EndpointRecord>(key.name, "json");
    if (record) {
      const doStatus = await fetchAgentSocketStatus(c.env, record.name);
      const doConnected = doStatus.ok ? doStatus.connected : null;
      endpoints.push({
        name: record.name,
        url: record.url,
        status: endpointStatusFromKvAndDo(record, doConnected),
        lastHeartbeat: record.lastHeartbeat,
      });
    }
  }

  return c.json(endpoints);
});

app.route("/api/gateway", gateway);

// ── API proxy: /api/agents/:agent/* → WebSocket (preferred) or agent tunnel URL (dashboard auth) ──
app.all("/api/agents/:agent/*", async (c) => {
  if (!checkDashboardAuth(c)) return c.json({ error: "unauthorized" }, 401);
  const agent = c.req.param("agent");
  const record = await c.env.ENDPOINTS.get<EndpointRecord>(agent, "json");

  if (!record) {
    return c.json({ error: "agent not found" }, 404);
  }

  const url = new URL(c.req.url);
  const pathAfterAgent = url.pathname.replace(`/api/agents/${agent}`, "");
  const targetUrl = `${record.url}/api${pathAfterAgent}${url.search}`;
  const proxyPath = `/api${pathAfterAgent}${url.search}`;
  const method = c.req.method;
  const token = record.agentToken ?? "";
  const forwardRecord = buildForwardHeaders(c.req.raw.headers, token);

  const doStatus = await fetchAgentSocketStatus(c.env, agent);
  if (doStatus.ok && doStatus.connected) {
    const bodyStr = await readBodyForWsProxy(method, c.req.raw);
    const wsRequest: WsRequest = {
      id: crypto.randomUUID(),
      method,
      path: proxyPath,
      headers: forwardRecord,
      body: bodyStr,
    };
    const proxyResp = await fetchThroughAgentSocket(c.env, agent, c.env.GATEWAY_SECRET, wsRequest);
    if (proxyResp.status !== 503) {
      return new Response(proxyResp.body, {
        status: proxyResp.status,
        headers: proxyResp.headers,
      });
    }
    try {
      const resp = await fetchAgentWithRecordHeaders(targetUrl, method, forwardRecord, bodyStr);
      return new Response(resp.body, {
        status: resp.status,
        headers: resp.headers,
      });
    } catch (err) {
      return c.json({ error: "agent unreachable", detail: String(err) }, 502);
    }
  }

  const headers = buildDashboardProxyHeaders(c.req.raw.headers, token);
  try {
    const resp = await fetchAgentWithDashboardHeaders(targetUrl, method, headers, c.req.raw.body);
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (err) {
    return c.json({ error: "agent unreachable", detail: String(err) }, 502);
  }
});

// biome-ignore lint/style/noDefaultExport: Cloudflare Workers entry expects default export
export default app;
