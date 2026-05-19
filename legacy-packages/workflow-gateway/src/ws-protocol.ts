/** Wire format for HTTP-over-WebSocket proxy between gateway Durable Object and local serve. */

export type WsRequest = {
  id: string;
  method: string;
  path: string;
  headers: Record<string, string>;
  body: string | null;
};

export type WsResponse = {
  id: string;
  status: number;
  headers: Record<string, string>;
  body: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Parse and validate a JSON payload as {@link WsRequest}. */
export function parseWsRequestJson(raw: string): WsRequest | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const id = parsed.id;
  const method = parsed.method;
  const path = parsed.path;
  const headers = parsed.headers;
  const body = parsed.body;
  if (!isNonEmptyString(id) || !isNonEmptyString(method) || !isNonEmptyString(path)) {
    return null;
  }
  if (!isRecord(headers)) {
    return null;
  }
  const headerRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") {
      return null;
    }
    headerRecord[k] = v;
  }
  if (body !== null && typeof body !== "string") {
    return null;
  }
  return { id, method, path, headers: headerRecord, body: body === null ? null : body };
}

/** Parse and validate a JSON payload as {@link WsResponse}. */
export function parseWsResponseJson(raw: string): WsResponse | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return null;
  }
  if (!isRecord(parsed)) {
    return null;
  }
  const id = parsed.id;
  const status = parsed.status;
  const headers = parsed.headers;
  const respBody = parsed.body;
  if (!isNonEmptyString(id) || typeof status !== "number" || !Number.isFinite(status)) {
    return null;
  }
  if (!isRecord(headers)) {
    return null;
  }
  const headerRecord: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (typeof v !== "string") {
      return null;
    }
    headerRecord[k] = v;
  }
  if (typeof respBody !== "string") {
    return null;
  }
  return { id, status: Math.trunc(status), headers: headerRecord, body: respBody };
}
