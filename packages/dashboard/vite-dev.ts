import type { IncomingMessage } from "node:http";
import type { Plugin } from "vite";
import { createApi } from "./server/api.ts";

function buildRequest(req: IncomingMessage, body: string | null): Request {
  const url = `http://${req.headers.host ?? "localhost"}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (typeof value === "string") headers.set(key, value);
    else if (Array.isArray(value)) for (const v of value) headers.append(key, v);
  }
  return new Request(url, { method: req.method ?? "GET", headers, body });
}

async function readBody(req: IncomingMessage): Promise<string | null> {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString();
}

export function elysiaPlugin(): Plugin {
  const api = createApi();

  return {
    name: "elysia-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api")) return next();

        const body = await readBody(req);
        const request = buildRequest(req, body);
        const response = await api.handle(request);

        res.statusCode = response.status;
        response.headers.forEach((value, key) => {
          res.setHeader(key, value);
        });
        res.end(await response.arrayBuffer());
      });
    },
  };
}
