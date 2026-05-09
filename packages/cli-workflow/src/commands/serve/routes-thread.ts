import { join } from "node:path";
import { createCasStore, getContentMerklePayload } from "@uncaged/workflow-cas";
import { FORK_BRANCH_ROLE, walkStateFramesNewestFirst } from "@uncaged/workflow-execute";
import { END } from "@uncaged/workflow-runtime";
import { getGlobalCasDir } from "@uncaged/workflow-util";
import { Hono } from "hono";

import { pathExists } from "../../fs-utils.js";
import type { ResolvedThreadRecord } from "../../thread-scan.js";
import {
  listHistoricalThreads,
  listRunningThreads,
  resolveThreadRecord,
} from "../../thread-scan.js";
import { cmdKill, cmdPause, cmdResume } from "../thread/control.js";
import { cmdRun } from "../thread/run.js";

async function buildThreadDetailRecords(
  storageRoot: string,
  resolved: ResolvedThreadRecord,
): Promise<unknown[]> {
  const cas = createCasStore(getGlobalCasDir(storageRoot));
  const frames = await walkStateFramesNewestFirst(cas, resolved.head);
  const chronological = [...frames].reverse();

  const records: unknown[] = [
    {
      type: "thread-start",
      role: null,
      content: `workflow: ${resolved.bundleHash ?? "unknown"}`,
      timestamp: null,
      threadId: resolved.threadId,
      bundleHash: resolved.bundleHash,
      head: resolved.head,
      start: resolved.start,
      source: resolved.source,
    },
  ];

  for (const fr of chronological) {
    if (fr.payload.role === FORK_BRANCH_ROLE) {
      continue;
    }
    if (fr.payload.role === END) {
      const returnCode = fr.payload.meta.returnCode;
      const summary = fr.payload.meta.summary;
      if (typeof returnCode === "number" && typeof summary === "string") {
        records.push({ type: "workflow-result", role: null, content: summary, timestamp: null, returnCode });
      }
      continue;
    }
    const payloadText = await getContentMerklePayload(cas, fr.payload.content);
    const content =
      payloadText !== null
        ? payloadText
        : `(content not in CAS; contentHash=${fr.payload.content})`;
    records.push({
      type: "role",
      role: fr.payload.role,
      contentHash: fr.payload.content,
      content,
      meta: fr.payload.meta,
      timestamp: fr.payload.timestamp,
    });
  }

  return records;
}

export function createThreadRoutes(storageRoot: string): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const nameFilter = c.req.query("workflow") ?? null;
    const rows = await listHistoricalThreads(storageRoot, nameFilter);
    const threads = await Promise.all(
      rows.map(async (r) => {
        const runningPath = join(storageRoot, "logs", r.hash, `${r.threadId}.running`);
        const isRunning = await pathExists(runningPath);
        const status = r.source === "history" ? "completed" : isRunning ? "running" : "active";
        return {
          threadId: r.threadId,
          workflow: r.workflowName,
          hash: r.hash,
          startedAt: new Date(r.activityTs).toISOString(),
          status,
        };
      }),
    );
    return c.json({ threads });
  });

  app.get("/running", async (c) => {
    const rows = await listRunningThreads(storageRoot);
    return c.json({ threads: rows });
  });

  app.get("/:threadId", async (c) => {
    const threadId = c.req.param("threadId");
    const resolved = await resolveThreadRecord(storageRoot, threadId);
    if (resolved === null) {
      return c.json({ error: `thread not found: ${threadId}` }, 404);
    }
    const records = await buildThreadDetailRecords(storageRoot, resolved);
    return c.json({ threadId, records });
  });

  app.post("/", async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }

    const name = body.workflow;
    const prompt = body.prompt;
    const maxRounds = typeof body.maxRounds === "number" ? body.maxRounds : 10;

    if (typeof name !== "string" || typeof prompt !== "string") {
      return c.json({ error: "workflow (string) and prompt (string) are required" }, 400);
    }

    const result = await cmdRun(storageRoot, name, prompt, maxRounds);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ threadId: result.value.threadId }, 201);
  });

  app.post("/:threadId/kill", async (c) => {
    const threadId = c.req.param("threadId");
    const result = await cmdKill(storageRoot, threadId);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  app.post("/:threadId/pause", async (c) => {
    const threadId = c.req.param("threadId");
    const result = await cmdPause(storageRoot, threadId);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  app.post("/:threadId/resume", async (c) => {
    const threadId = c.req.param("threadId");
    const result = await cmdResume(storageRoot, threadId);
    if (!result.ok) {
      return c.json({ error: result.error }, 400);
    }
    return c.json({ ok: true });
  });

  return app;
}
