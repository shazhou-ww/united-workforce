import { Hono } from "hono";
import { cors } from "hono/cors";

type Env = {
  Bindings: {
    ENDPOINTS: KVNamespace;
    GATEWAY_SECRET: string;
    DASHBOARD_API_KEY: string;
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

// ── Dashboard API key auth (skip healthz + register) ─────────────
app.use("/endpoints", async (c, next) => {
  if (!checkDashboardAuth(c)) return c.json({ error: "unauthorized" }, 401);
  await next();
});
app.use("/api/*", async (c, next) => {
  if (!checkDashboardAuth(c)) return c.json({ error: "unauthorized" }, 401);
  await next();
});

function checkDashboardAuth(c: { req: { header: (n: string) => string | undefined; query: (n: string) => string | undefined }; env: Env["Bindings"] }): boolean {
  const bearer = c.req.header("Authorization")?.replace("Bearer ", "");
  const query = c.req.query("key");
  const key = bearer ?? query;
  return key === c.env.DASHBOARD_API_KEY;
}

// ── Health ──────────────────────────────────────────────────────────
app.get("/healthz", (c) => c.json({ ok: true }));

// ── Register / heartbeat ────────────────────────────────────────────
app.post("/register", async (c) => {
  const body = await c.req.json<{ name?: string; url?: string; secret?: string; agentToken?: string }>();
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

// ── Unregister ──────────────────────────────────────────────────────
app.delete("/register/:name", async (c) => {
  const auth = c.req.header("Authorization");
  if (auth !== `Bearer ${c.env.GATEWAY_SECRET}`) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const name = c.req.param("name");
  await c.env.ENDPOINTS.delete(name);
  return c.json({ unregistered: name });
});

// ── List endpoints ──────────────────────────────────────────────────
app.get("/endpoints", async (c) => {
  const list = await c.env.ENDPOINTS.list();
  const endpoints: Array<{ name: string; url: string; status: string; lastHeartbeat: number }> = [];

  for (const key of list.keys) {
    const record = await c.env.ENDPOINTS.get<EndpointRecord>(key.name, "json");
    if (record) {
      const age = Date.now() - record.lastHeartbeat;
      endpoints.push({
        name: record.name,
        url: record.url,
        status: age < TTL_SECONDS * 1000 ? "online" : "offline",
        lastHeartbeat: record.lastHeartbeat,
      });
    }
  }

  return c.json(endpoints);
});

// ── API proxy: /api/:agent/* → agent's tunnel URL ───────────────────
app.all("/api/:agent/*", async (c) => {
  const agent = c.req.param("agent");
  const record = await c.env.ENDPOINTS.get<EndpointRecord>(agent, "json");

  if (!record) {
    return c.json({ error: "agent not found" }, 404);
  }

  // Build target URL: strip /api/:agent prefix, forward the rest
  const url = new URL(c.req.url);
  const pathAfterAgent = url.pathname.replace(`/api/${agent}`, "");
  const targetUrl = `${record.url}/api${pathAfterAgent}${url.search}`;

  const headers = new Headers(c.req.raw.headers);
  headers.delete("host");
  headers.delete("Authorization"); // don't forward dashboard key to agent
  if (record.agentToken) {
    headers.set("X-Agent-Token", record.agentToken);
  }

  try {
    const resp = await fetch(targetUrl, {
      method: c.req.method,
      headers,
      body: c.req.method !== "GET" && c.req.method !== "HEAD" ? c.req.raw.body : undefined,
    });

    // Stream response back
    return new Response(resp.body, {
      status: resp.status,
      headers: resp.headers,
    });
  } catch (err) {
    return c.json({ error: "agent unreachable", detail: String(err) }, 502);
  }
});

export default app;
