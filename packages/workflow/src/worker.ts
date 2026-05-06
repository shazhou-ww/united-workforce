import { mkdir, unlink, writeFile } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

import { type ExecuteThreadIo, executeThread } from "./engine.js";
import { createLogger } from "./logger.js";
import type { WorkflowFn } from "./types.js";

const bootLog = createLogger({ sink: { kind: "stderr" } });

type RunCommand = {
  type: "run";
  threadId: string;
  workflowName: string;
  prompt: string;
  options: { isDryRun: boolean; maxRounds: number };
};

type KillCommand = {
  type: "kill";
  threadId: string;
};

type ControlCommand = RunCommand | KillCommand;

function parseControlPayload(payload: unknown): ControlCommand | null {
  if (payload === null || typeof payload !== "object") {
    return null;
  }
  const rec = payload as Record<string, unknown>;
  const type = rec.type;
  if (type === "kill") {
    const threadId = rec.threadId;
    if (typeof threadId !== "string") {
      return null;
    }
    return { type: "kill", threadId };
  }
  if (type === "run") {
    const threadId = rec.threadId;
    const workflowName = rec.workflowName;
    const prompt = rec.prompt;
    const options = rec.options;
    if (
      typeof threadId !== "string" ||
      typeof workflowName !== "string" ||
      typeof prompt !== "string"
    ) {
      return null;
    }
    if (options === null || typeof options !== "object") {
      return null;
    }
    const optRec = options as Record<string, unknown>;
    const isDryRun = optRec.isDryRun;
    const maxRounds = optRec.maxRounds;
    if (typeof isDryRun !== "boolean" || typeof maxRounds !== "number") {
      return null;
    }
    return {
      type: "run",
      threadId,
      workflowName,
      prompt,
      options: { isDryRun, maxRounds },
    };
  }
  return null;
}

function parseCommandLine(line: string): ControlCommand | null {
  const trimmed = line.trim();
  if (trimmed === "") {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed) as unknown;
  } catch {
    bootLog("S8KQ3WJP", "worker received invalid JSON control line");
    return null;
  }
  return parseControlPayload(parsed);
}

function isWorkflowFnLike(value: unknown): value is WorkflowFn {
  return typeof value === "function";
}

async function readLineFromSocket(socket: Socket): Promise<string | null> {
  return await new Promise((resolve) => {
    let buf = "";
    function onData(chunk: Buffer): void {
      buf += chunk.toString("utf8");
      const nl = buf.indexOf("\n");
      if (nl >= 0) {
        cleanup();
        resolve(buf.slice(0, nl));
      }
    }
    function onEnd(): void {
      cleanup();
      resolve(buf === "" ? null : buf);
    }
    function onError(): void {
      cleanup();
      resolve(null);
    }
    function cleanup(): void {
      socket.off("data", onData);
      socket.off("end", onEnd);
      socket.off("error", onError);
    }
    socket.on("data", onData);
    socket.on("end", onEnd);
    socket.on("error", onError);
  });
}

async function main(): Promise<void> {
  const bundlePath = process.argv[2];
  const storageRoot = process.argv[3];
  const hash = process.argv[4];

  if (
    bundlePath === undefined ||
    storageRoot === undefined ||
    hash === undefined ||
    bundlePath === "" ||
    storageRoot === "" ||
    hash === ""
  ) {
    bootLog("H7XN4MKQ", "worker usage: worker <bundlePath> <storageRoot> <hash>");
    process.exit(2);
    return;
  }

  // Dynamic import required: user bundle path resolved at runtime
  const modUnknown: unknown = await import(pathToFileURL(bundlePath).href);
  const modRec = modUnknown as Record<string, unknown>;
  const defaultExport = modRec.default;
  if (!isWorkflowFnLike(defaultExport)) {
    bootLog(
      "T4BW9YJX",
      "workflow bundle default export must be a function (AsyncGenerator workflow)",
    );
    process.exit(2);
    return;
  }
  const workflowFn = defaultExport;

  const controllers = new Map<string, AbortController>();
  let activeThreads = 0;
  let shutdownTimer: ReturnType<typeof setTimeout> | null = null;

  const workerCtlPath = join(storageRoot, "workers", `${hash}.json`);

  function cancelShutdownTimer(): void {
    if (shutdownTimer !== null) {
      clearTimeout(shutdownTimer);
      shutdownTimer = null;
    }
  }

  function scheduleShutdown(): void {
    cancelShutdownTimer();
    shutdownTimer = setTimeout(() => {
      void unlink(workerCtlPath).catch(() => {});
      process.exit(0);
    }, 150);
  }

  function bumpStart(): void {
    cancelShutdownTimer();
    activeThreads++;
  }

  function bumpDone(): void {
    activeThreads--;
    if (activeThreads <= 0) {
      activeThreads = 0;
      scheduleShutdown();
    }
  }

  async function dispatchCommand(cmd: ControlCommand, socket: Socket | null): Promise<void> {
    if (cmd.type === "kill") {
      const ac = controllers.get(cmd.threadId);
      if (ac !== undefined) {
        ac.abort();
        bootLog("P9XK2WNQ", `kill requested for thread ${cmd.threadId}`);
      }
      socket?.end();
      return;
    }

    bumpStart();

    const threadId = cmd.threadId;
    const runningPath = join(storageRoot, "logs", hash, `${threadId}.running`);
    const dataJsonlPath = join(storageRoot, "logs", hash, `${threadId}.data.jsonl`);
    const infoJsonlPath = join(storageRoot, "logs", hash, `${threadId}.info.jsonl`);

    const io: ExecuteThreadIo = {
      threadId,
      hash,
      dataJsonlPath,
      infoJsonlPath,
    };

    const existing = controllers.get(threadId);
    if (existing !== undefined) {
      existing.abort();
      controllers.delete(threadId);
    }

    const ac = new AbortController();
    controllers.set(threadId, ac);

    try {
      await mkdir(dirname(runningPath), { recursive: true });
      await mkdir(dirname(dataJsonlPath), { recursive: true });
      await writeFile(runningPath, "", "utf8");

      const logger = createLogger({ sink: { kind: "file", path: infoJsonlPath } });

      await executeThread(
        workflowFn,
        cmd.workflowName,
        cmd.prompt,
        { ...cmd.options, signal: ac.signal },
        io,
        logger,
      );
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      bootLog("Q3MN8YKW", `thread ${threadId} failed: ${message}`);
    } finally {
      controllers.delete(threadId);
      await unlink(runningPath).catch(() => {});
      bumpDone();
      socket?.end();
    }
  }

  if (typeof process.send === "function") {
    process.on("message", (msg: unknown) => {
      const cmd = parseControlPayload(msg);
      if (cmd === null) {
        return;
      }
      void dispatchCommand(cmd, null);
    });
  }

  const server = createServer((socket) => {
    void (async () => {
      const line = await readLineFromSocket(socket);
      if (line === null) {
        socket.end();
        return;
      }
      const cmd = parseCommandLine(line);
      if (cmd === null) {
        socket.end();
        return;
      }
      await dispatchCommand(cmd, socket);
    })();
  });

  server.on("error", (err) => {
    bootLog("W8YK4NPX", `worker server error: ${err.message}`);
    process.exit(1);
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });

  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    bootLog("R9XK4MNW", "worker failed to bind TCP address");
    process.exit(1);
    return;
  }

  process.stdout.write(`READY ${addr.port}\n`);

  await new Promise<void>(() => {});
}

void main();
